/**
 * UserAllocation.js
 *
 * @description :: A model definition represents a database table/collection.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

const { TimeUtils, SqlUtils } = require('similie-api-services');
const escape = SqlUtils.escapeUtil();

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    user: {
      model: 'user',
      required: true
    },

    user_schema: {
      model: 'nodeschema'
    },

    inventory: {
      model: 'nodeschema',
      required: true
    },
    // parent ID of the inventory
    item: {
      type: 'integer'
    },

    quantity: {
      type: 'integer',
      defaultsTo: 1
    },

    commonSku: {
      type: 'string',
      required: true
    },

    replenishment: {
      min: -1,
      type: 'integer',
      defaultsTo: -1
    },

    every: {
      maxLength: 8,
      type: 'string',
      in: ['once', 'seconds', 'minutes', 'hours', 'days', 'months', 'years']
    },

    serials: {
      type: 'array'
    },

    meta: {
      type: 'json'
    }
  },

  discriptorParams: function(nodeschema) {
    const schema = (nodeschema || {}).schema;
    const params = [];
    let aString = '';
    _.each(schema, s => {
      if (!s.logistics_parameter && s.unique_identity) {
        params.push(s);
        aString += `, "${s.name}"`;
      }
    });

    return {
      queryAppend: aString,
      params: params
    };
  },

  buildSelectOptions: async function(
    distinctions,
    params,
    language,
    schema,
    via
  ) {
    language = language || Translates.fallbackLanguage;
    const send = [];
    const order = {};
    const distinct = {};
    _.each(distinctions, d => {
      distinct[Model.getId(d)] = d;
    });
    let first = false;
    for (let i = 0; i < _.size(distinctions); i++) {
      const distinction = distinctions[i];
      distinction.__description = '';
      if (!_.size(params)) {
        distinction.__meta = {
          via: via,
          param: 'sku',
          index: 0,
          source: i,
          name: 'sku', /// YOU NEED TO FIX
          schema: NodeSchema.getId(schema)
        };
        distinction.__description = distinction.sku;
      }

      for (let j = 0; j < _.size(params); j++) {
        const param = params[j];
        const content = distinction[param.name];
        const between = i > 0 && !first ? ', ' : '';
        distinction.__meta = {
          via: via,
          param: param.label || param.name,
          index: j,
          source: i,
          name: param.name,
          schema: NodeSchema.getId(schema)
        };
        switch (param.type) {
          case 'variable':
            const _var = await Variable.findOneById(content);
            if (!_var) {
              continue;
            }
            const text = _var.getLanguageValue(language);
            order[_var.order] = Model.getId(distinction);
            distinction.__description += between + text;
            first = true;
            break;
          default:
            distinction.__description += content + text;
            first = true;
        }
      }
    }

    for (const v in order) {
      const id = order[v];
      send.push(distinct[id]);
    }
    return _.size(send) ? send : distinctions;
  },

  nodeThroughParams: async function(nodeParams, item, schema, language) {
    const node = await Node.findOneById(item, schema);
    const send = [];
    if (!node) {
      return send;
    }

    for (let i = 0; i < _.size(nodeParams); i++) {
      const nP = nodeParams[i];
      const nsId = nP.node;
      const nodeP = node[nP.name];

      if (!nodeP || !nodeP.count || !nsId || nP.unique_identity) {
        continue;
      }
      const nSchema = await NodeSchema.findOneById(nsId);
      if (!nSchema) {
        continue;
      }
      const descriptors = this.discriptorParams(nSchema);
      const values = await this.selectDistinctValues(
        descriptors.queryAppend,
        nSchema
      );

      if (!_.size(values)) {
        continue;
      }

      const varibles = await this.buildSelectOptions(
        values,
        descriptors.params,
        language,
        nsId,
        nP.name
      );
      if (!_.size(varibles)) {
        continue;
      }
      send.push(varibles);
    }
    return send;
  },

  selectDistinctValues: async function(queryAppend, schema) {
    const distinction = `
    SELECT DISTINCT ("sku") as "sku", "id"${queryAppend} 
    from ${SqlUtils.knex().tableNameForQuery(schema)};
    `;

    try {
      const models = await Model.queryAsync(distinction);
      return models.rows;
    } catch (e) {
      sails.log.error(e);
      return [];
    }
  },

  validSerialParams: function(nodeschema) {
    const validParams = [];
    const schema = (nodeschema || {}).schema;
    _.each(schema, s => {
      if (s.active && !s.unique_value && s.type === 'node' && s.serializable) {
        validParams.push(s);
      }
    });
    return validParams;
  },

  allocationQueryGenLight: function() {
    const query = `SELECT
		"ua".*,
		json_build_object ( 'completed_on', "trans"."completed_on", 'description', "trans"."description", 'transaction_id', "trans"."transaction_id" ) AS "last_allocation"
	FROM
		"userallocation" "ua"
		LEFT JOIN (
		SELECT DISTINCT ON
			( "pos"."scan", "po"."client" ) *,
			"pos"."scan" AS "sku",
			"pos"."schema" AS "inventory"
		FROM
			"pointofsale" "po"
			INNER JOIN "postransaction" "pos" ON ( "po"."id" = "pos"."pointofsale" )
		WHERE
			"po"."client" IS NOT NULL
			AND "pos"."fullfilled" IS TRUE
		ORDER BY
			"pos"."scan",
			"po"."client",
			"po"."completed_on" DESC
		) "trans" ON ( "trans"."client" = "ua"."user" AND "trans"."inventory" = "ua"."inventory" AND "trans"."sku" = "ua"."commonSku" )
`;
    return query;
  },

  allocationQueryGen: function() {
    const query = `SELECT
    "ua".*,
    to_json ( "u".* ) AS "client",
    to_json ( "ns".* ) AS "inventory_schema",
    json_build_object ( 'completed_on', "trans"."completed_on", 'description', "trans"."description", 'transaction_id', "trans"."transaction_id" ) AS "last_allocation"
  FROM
    "userallocation" "ua"
    LEFT JOIN (
      SELECT DISTINCT ON
      ( "pos"."scan", "po"."client" ) *,
       "pos"."scan" AS "sku",
       "pos"."schema" AS "inventory"
    FROM
      "pointofsale" "po"
      INNER JOIN "postransaction" "pos" ON ( "po"."id" = "pos"."pointofsale" )
    WHERE
      "po"."client" IS NOT NULL
      AND "pos"."fullfilled" IS TRUE
    ORDER BY
      "pos"."scan",
      "po"."client",
      "po"."completed_on" DESC
    ) "trans" ON ( "trans"."client" = "ua"."user" AND "trans"."inventory" = "ua"."inventory" AND "trans"."sku" = "ua"."commonSku" )
    JOIN "nodeschema" "ns" ON ( "ua"."inventory" = "ns"."id" )
    JOIN "user" "u" ON ( "ua"."user" = "u"."id" )`;
    return query;
  },

  getStationSumQuery: function(id, stations, schema) {
    const helpers = Module._helpers.logistics();
    const logParams = helpers.logParams(schema.schema);
    const query = escape(
      `SELECT COALESCE(SUM("%s"), 0 )::INT as "sum" FROM "%s"."%s" WHERE
    ("id" = %s AND "copy_of" IS NULL OR "copy_of" IS NOT NULL AND "copy_of" = %s   )
    AND "station" %s;`,
      logParams('quantity'),
      schema.domain_schema,
      schema.name,
      id,
      id,
      SqlUtils.setInString(stations)
    );
    return query;
  },

  geAlloctStationSumFromNode: async function(nodeCache, stations) {
    if (!_.isUndefined(nodeCache.total_quantity)) {
      return;
    }
    const node = nodeCache.item;
    const id = node.copy_of || node.id;
    stations = _.isArray(stations) ? stations : [stations];
    const query = this.getStationSumQuery(id, stations, nodeCache.schema);
    const results = await Model.queryAsync(query);
    const sums = results.rows;
    const sum = (sums.pop() || {}).sum;
    nodeCache.total_quantity = sum;
  },

  applySerialCacheItems: async function(serials, objectHold, item, quantity) {
    quantity = quantity || 1;
    objectHold.serials = objectHold.serials || {};
    const serialHold = {};
    const itemID = Model.getId(item);
    const schema = NodeSchema.getId(objectHold.schema);

    for (let i = 0; i < _.size(serials); i++) {
      const serial = serials[i];
      const meta = serial.__meta;
      const key = serial[meta.name] || serial.sku;
      objectHold.serials[key] = objectHold.serials[key] || {
        quantity: 0,
        current: 0,
        nodeserials: {},
        items: {}
      };
      if (objectHold.serials[key].items[itemID]) {
        continue;
      }
      objectHold.serials[key].items[itemID] = true;
      objectHold.serials[key].quantity += quantity;
      if (!serialHold[key]) {
        objectHold.serials[key].description = serial.__description;
        serialHold[key] = true;
        const search = {
          via_param: meta.via,
          possessed_by_node: serial.id,
          possessed_by_schema: meta.schema,
          owned_by_node: Model.getId(item),
          owned_by_schema: schema
        };
        const ns = await NodeSerial.find().where(search);
        _.each(ns, n => {
          if (!objectHold.serials[key].nodeserials[n.id]) {
            objectHold.serials[key].current += (n || {}).quantity || 0;
            objectHold.serials[key].nodeserials[n.id] = true;
          }
        });
      }
    }
  },

  setSerials: async function(allocation, cache, stations) {
    const serials = _.isString(allocation.serials)
      ? JSON.parse(allocation.serials)
      : allocation.serials;
    const quantity = allocation.quantity || 1;
    const schema = cache.schema;
    const item = cache.item;
    const copy_of = item.copy_of || item.id;
    for (let i = 0; i < _.size(stations); i++) {
      const station = stations[i];
      let searchNode = {
        ...item
      };
      if (Station.getId(item.station) != station) {
        const found = await Node.findNodes(
          {
            where: {
              copy_of: copy_of,
              station: station
            }
          },
          schema
        );
        if (!_.size(found)) {
          continue;
        }
        searchNode = found.pop();
      }
      await this.applySerialCacheItems(serials, cache, searchNode, quantity);
    }
  },

  stripSchemas: function(cache) {
    for (const sId in cache) {
      const sCache = cache[sId];
      for (const iId in sCache) {
        if (iId === '__schema') {
          continue;
        }
        delete sCache[iId].schema;
      }
    }
  },

  setAllocationCache: async function(allocations, stations) {
    const cache = {};
    for (let i = 0; i < _.size(allocations); i++) {
      const a = allocations[i];
      const schema = NodeSchema.getId(a.inventory_schema);
      cache[schema] = cache[schema] || {};
      const item = Model.getId(a.item);
      cache[schema].__schema = _.cloneDeep(a.inventory_schema);

      if (_.isString(a.inventory_schema.schema)) {
        const sc = [...JSON.parse(a.inventory_schema.schema)];
        a.inventory_schema.schema = [...sc];
        cache[schema].__schema.schema = [...sc];
      }

      if (!cache[schema][item]) {
        const node = await Node.findOneById(item, a.inventory_schema);
        if (!_.size(node)) {
          continue;
        }
        cache[schema][item] = {
          item: node,
          schema: _.cloneDeep(a.inventory_schema)
        };
      }
      await this.setSerials(a, cache[schema][item], stations);
      await this.geAlloctStationSumFromNode(cache[schema][item], stations);
    }

    return cache;
  },

  mergeDetails: function(details, mergeElements) {
    for (const nsId in mergeElements) {
      const merge = mergeElements[nsId];
      for (const nId in merge) {
        const elements = merge[nId];
        details[nsId][nId].station_quantities =
          details[nsId][nId].station_quantities || {};
        for (const sId in elements.stations) {
          const quantity = elements.stations[sId];
          if (quantity != null) {
            details[nsId][nId].station_quantities[sId] =
              details[nsId][nId].station_quantities[sId] || 0;
            details[nsId][nId].station_quantities[sId] += quantity;
          } else {
            details[nsId][nId].station_quantities[sId] = quantity;
          }
        }
      }
    }
  },

  applySumsToCache: async function(allocationCache, stations) {
    const cache = {};
    for (const ssID in allocationCache) {
      cache[ssID] = cache[ssID] || {};
      const alloc = allocationCache[ssID];
      const schema = alloc.__schema;
      for (const nId in alloc) {
        if (nId === '__schema') {
          continue;
        }
        const a = alloc[nId];
        // const schema = a.schema;
        const item = a.item;
        cache[ssID][nId] = cache[ssID][nId] || {};
        cache[ssID][nId].stations = {};
        for (let i = 0; i < _.size(stations); i++) {
          const station = stations[i];
          const sID = Station.getId(station);
          const local = {
            item: item,
            schema: schema
          };
          cache[ssID][nId].stations[sID] = null;
          const ss = await Station.getStationSchema(sID, true);

          if (ss) {
            const hasNode = await StationSchema.hasNode(ss, schema);
            if (hasNode) {
              await this.geAlloctStationSumFromNode(local, [sID]);
              cache[ssID][nId].stations[sID] = local.total_quantity || null;
              // if (append) {
              cache[ssID][nId].total_quantity = local.total_quantity;
              // }
            }
          }
        }
      }
    }
    return cache;
  },

  applyQuantities: function(quantities, cache) {
    _.each(quantities, q => {
      if (cache[q.inventory] && cache[q.inventory][q.item]) {
        cache[q.inventory][q.item].totals = {
          ...q
        };
      }
    });
  },

  applyStationItems: function() {
    //
  },

  setItemArray: function(items) {
    const sendItems = [];

    _.each(items, i => {
      sendItems.push(i);
    });

    return sendItems;
  },

  bindUserCountsToStation: function(stations, members) {
    const userStations = {};
    _.each(members, u => {
      const station = Station.getId(u.station);
      if (station) {
        userStations[station] = userStations[station] || 0;
        userStations[station]++;
      }
    });

    _.each(stations, (s, sID) => {
      const count = userStations[sID] || 0;
      s.member_counts = count;
    });
  },

  userAllocationReportGenerator: async function(
    users,
    stations,
    allocationCache,
    params
  ) {
    if (_.size(users)) {
      const query = UserAllocation.userAllocations(users); // `${allocation} WHERE "u"."id" ${SqlUtils.setInString(users)}`

      const results = await Model.queryAsync(query);
      const allocations = results.rows;
      if (!_.size(allocations) && _.size(allocationCache)) {
        return await this.applySumsToCache(allocationCache, stations, true);
      }
      const _allocationCache = await this.setAllocationCache(
        allocations,
        stations
      );
      const quantityQuery = this.decorateUserAllocationsQuery(
        this.userAllocationsLight(users, params.date)
      );
      const countResults = await UserAllocation.queryAsync(quantityQuery);
      const quantities = countResults.rows;
      this.applyQuantities(quantities, _allocationCache);
      this.stripSchemas(_allocationCache);
      return _allocationCache;
    } else if (_.size(allocationCache)) {
      return await this.applySumsToCache(allocationCache, stations);
    }
    return {};
  },

  usersFromStationLight: async function(stations) {
    const query = escape(
      `SELECT "user" as "id", "station" as "station" 
      FROM "requisition" 
      WHERE 
        "station" %s AND 
        "primary" IS TRUE AND 
        "archived" IS FALSE AND 
        "personnel" IS TRUE;
        `,
      SqlUtils.setInString(stations)
    );
    const results = await Model.queryAsync(query);
    return results.rows;
  },

  usersfromStations: async function(stations) {
    const reqs = await Requisition.find().where({
      station: stations,
      personnel: true,
      archived: false,
      primary: true,
      user: { '!': null }
    });
    const users = _.pluck(reqs, 'user');
    return {
      requisitions: reqs,
      users: users
    };
  },

  userAllocations: function(users, date) {
    const query = this.userAllocationDueHeaderQuery(
      escape(
        this.allocationQueryGen() + ` WHERE "u"."id" %s`,
        SqlUtils.setInString(users)
      ),
      date
    );
    return query;
  },

  userAllocationDueHeaderQuery: function(from, date) {
    const dateString = date /* ? `'${SqlUtil.convertToDate(date, true)}'::TIMESTAMP` */
      ? // [sg] TimeUtils
        `'${TimeUtils.sqlFormattedDate(date)}'::TIMESTAMP`
      : 'now()';
    return `SELECT
    ("last_allocation"->>'completed_on')::timestamp AS "last_allocation_date",
    CASE WHEN "replenishment"::INT > 0 THEN  ${dateString} - format('%s %s', "replenishment", "every")::INTERVAL
     WHEN "replenishment"::INT < 0 THEN "createdAt"::timestamp
     END  AS "last_due",
    CASE WHEN "replenishment"::INT > 0 THEN COALESCE((${dateString} - format('%s %s', "replenishment","every" )::INTERVAL) > ("last_allocation"->>'completed_on')::timestamp, true)
     WHEN "replenishment"::INT < 0 THEN ("last_allocation"->>'completed_on')::timestamp IS NULL
     END  AS "is_due",
    ("last_allocation"->>'description')::TEXT AS "description",
    *
    FROM (${from}) JOINED`;
  },

  userAllocationWithSubUsers: function(item, inventory, date) {
    const itemID = Model.getId(item);
    const invID = Model.getId(inventory);
    const where = escape(
      this.allocationQueryGenLight() + ` WHERE "ua"."user" IN (%s)`,
      escape(
        `SELECT
       "u"."id"
     FROM
       "user" u
       JOIN "userallocation" "ua" ON ( "u"."id" = "ua"."user" )
     WHERE
       "item" = %s
       AND "inventory" = %s `,
        itemID,
        invID
      )
    );

    const query = `${this.userAllocationDueHeaderQuery(where, date)} ${escape(
      `WHERE  "item" = %s AND "inventory" = %s`,
      itemID,
      invID
    )}`;

    return query;
  },

  getStationFromMembers: async function(users, stations) {
    const userStations = {};
    if (!_.size(stations)) {
      return userStations;
    }

    const stationHold = {};
    _.each(stations, s => {
      stationHold[s.id] = s.station;
    });

    for (let i = 0; i < _.size(users); i++) {
      const user = users[i];
      const uId = User.getId(user);
      userStations[uId] = stationHold[uId];
    }
    return userStations;
  },

  formatUserQuery: async function(params) {
    const invID = Model.getId(params.inventory);
    const itemID = Model.getId(params.item);
    let dueAppend = '';
    if (_.size(params.scope) === 1 && params.scope[0] === 'due') {
      dueAppend = '"formatted"."is_due" IS TRUE';
    } else if (_.size(params.scope) === 1 && params.scope[0] === 'not-due') {
      dueAppend = '"formatted"."is_due" IS FALSE';
    }
    const query = this.userAllocationWithSubUsers(itemID, invID, params.date);
    let stationUsers;
    let stationMemberships;
    if (_.size(params.stations)) {
      stationMemberships = await this.usersFromStationLight(params.stations);
      stationUsers = _.filter(_.pluck(stationMemberships, 'id'), sm => !!sm);
    }

    const where = dueAppend || _.size(stationUsers) ? 'WHERE' : '';
    const formatted = `
      SELECT "user" as "id", "last_allocation_date" 
      FROM (${query}) "formatted" ${where} ${dueAppend} ${
      _.size(stationUsers)
        ? escape(
            ` ${dueAppend ? 'AND' : ''} "formatted"."user" %s`,
            SqlUtils.setInString(stationUsers)
          )
        : ''
    }`;
    return {
      query: formatted,
      memberships: stationMemberships
    };
  },
  getUsersFromFormatQuery: async function(query, req) {
    const limit = Utils.limit(req);
    const skip = Utils.skip(req);
    const results = await Model.queryAsync(query);
    const rows = results.rows;
    const userIds = [];
    const lastAllocations = {};
    for (let i = 0; i < _.size(rows); i++) {
      const row = rows[i];
      const id = Model.getId(row);
      if (id) {
        userIds.push(id);
        lastAllocations[id] = row.last_allocation_date;
      }
    }
    const users = await User.find()
      .limit(limit)
      .skip(skip)
      .where({
        id: userIds
      })
      .populate('schema')
      .sort({
        first_name: 'ASC',
        middle_name: 'ASC',
        last_name: 'ASC'
      });

    return {
      last_allocations: lastAllocations,
      members: users,
      count: _.size(userIds)
    };
  },

  getItemUsers: async function(req) {
    const params = Utils.params(req);

    const invID = Model.getId(params.inventory);
    const errors = this.errorMessages();
    if (!invID) {
      throw new Error(errors.INVENTORY_ID_REQUIRED);
    }

    const itemID = Model.getId(params.item);
    if (!itemID) {
      throw new Error(errors.ITEM_ID_REQUIRED);
    }

    const format = await this.formatUserQuery(params);
    const queryResults = await this.getUsersFromFormatQuery(format.query, req);

    return {
      ...queryResults,
      station: await this.getStationFromMembers(
        queryResults.members,
        format.memberships
      )
    };
  },

  errorMessages: function() {
    return {
      ...{
        INVALID_INVENTORY_ITEM: 'Invalid inventory item',
        ITEM_ID_REQUIRED: 'Item ID is required',
        INVENTORY_TYPE_INVALID: 'This inventory type is invalid',
        INVENTORY_ID_REQUIRED: 'An inventory ID is required',
        STATION_REQUIRED_FOR_REPORT:
          'A station ID parameter is required to generate a report',
        USERSCHEMA_ID_NOT_FOUND: 'error.USERSCHEMA_ID_NOT_FOUND'
      }
    };
  },

  userAllocationsLight: function(users, date) {
    const query = `${this.userAllocationDueHeaderQuery(
      escape(
        this.allocationQueryGenLight() + ` WHERE "ua"."user"  %s`,
        SqlUtils.setInString(users)
      ),
      date
    )}`;

    return query;
  },

  decorateUserAllocationsQuery: function(query) {
    const decorated = `
    SELECT
      count (*)::INT as "total",
      count (*) filter (where "is_due")::INT as "is_due",
      count (*) filter (where "is_due" IS FALSE)::INT as "is_not_due",
      "item",
      "inventory"
    FROM ( %s	) COUNTS
    GROUP BY 4, 5`;
    return escape(decorated, query);
  },

  mostCommonAssignments: async function(req) {
    const criteria = Utils.params(req);

    const userID = criteria.user;
    let sql = escape(
      `SELECT COUNT(*) as "assigned_count", "inventory", "item", "commonSku" FROM "userallocation" WHERE "user_schema" = %s GROUP BY 2,3,4 ORDER BY "assigned_count" DESC`,
      criteria.user_schema
    );

    if (userID) {
      const inject = escape(
        ` WHERE "commonSku" NOT IN (SELECT "commonSku" AS "commonSku" FROM "userallocation" WHERE "user"=%s) AND `,
        userID
      );
      sql = sql.replace(' WHERE ', inject);
      // countQyery = escape("SELECT COUNT(%s) c", inject);
    }

    const countQyery = `SELECT COUNT(*) FROM (${sql}) c`;

    const limit = Utils.limit(req);
    const skip = Utils.skip(req);

    let extraQuery = '';
    if (limit) {
      extraQuery += escape(`LIMIT %s`, limit);
    }

    if (skip) {
      extraQuery += escape(`OFFSET %s`, skip);
    }

    const query = `${sql} ${extraQuery}`;
    const assigments = await Model.queryAsync(query);

    const cQuery = await Model.queryAsync(countQyery);
    const counts = cQuery.rows.pop();
    const send = {
      assignments: assigments.rows,
      count: parseInt(counts.count),
      max: limit,
      skip: skip
    };
    return send;
  },

  common: async function(req, siteConfig) {
    const cAssign = await this.mostCommonAssignments(req);
    const join = await this.collectSchemas(cAssign.assignments);
    await this.applyNodes(join);
    const name = 'labels.MOST_COMMON';
    const pages = Math.ceil(cAssign.count / cAssign.max);
    const posItems = {
      [name]: [],
      __meta: {
        [name]: {
          count: cAssign.count,
          max: pages,
          page: cAssign.skip
        }
      },
      __max: cAssign.max || cAssign.count
    };

    const helpers = Module._helpers.logistics();

    for (let i = 0; i < _.size(cAssign.assignments); i++) {
      const allocate = cAssign.assignments[i];
      const count = allocate.assigned_count;
      const invent = Model.getId(allocate.inventory);
      const inventItem = Model.getId(allocate.item);
      const node = (join[invent] || {}).items[inventItem] || null;
      const schema = join[invent].schema;
      const logParams = helpers.logParams(schema.schema);
      const nodeChange = {
        ...node,
        [logParams('quantity')]: count
      };
      const item = await PointOfSale.buildItemForPosView(
        nodeChange,
        schema,
        siteConfig
      );
      posItems[name].push(item);
      const localName = schema.title || schema.name;
      posItems.__meta[localName] = {
        count: -1,
        page: -1,
        schema: NodeSchema.getId(schema)
      };
    }
    return posItems;
  },

  checkForId: function(req, sql) {
    const params = Utils.params(req);
    if (!params) {
      return sql;
    }
    sql = sql.replace('("id") =', '("ua"."id") =');
    return sql;
  },

  collectSchemas: async function(allocations) {
    const join = {};

    for (let i = 0; i < _.size(allocations); i++) {
      const allocate = allocations[i];
      const invent = Model.getId(allocate.inventory);
      const inventItem = Model.getId(allocate.item);
      if (!join[invent]) {
        const schema = await NodeSchema.findOneById(invent);
        if (!schema) {
          continue;
        }
        join[invent] = {
          schema: schema,
          nodes: []
        };
      }
      const schema = join[invent].schema;
      allocate.inventory_schema = schema;
      // now add the nodes
      if (_.indexOf(join[invent].nodes, inventItem) === -1) {
        join[invent].nodes.push(inventItem);
      }
    }
    return join;
  },

  applyNodes: async function(schemaJoin) {
    for (const id in schemaJoin) {
      const payload = schemaJoin[id];
      const nodes = await Node.findNodes(
        {
          where: {
            id: payload.nodes
          }
        },
        payload.schema
      );
      payload.items = {};
      _.each(nodes, n => {
        payload.items[Model.getId(n)] = n;
      });
    }
  },
  /*
   * We use this to set the item node.
   */
  setNodes: async function(allocations) {
    const join = await this.collectSchemas(allocations);
    await this.applyNodes(join);
    for (let i = 0; i < _.size(allocations); i++) {
      const allocate = allocations[i];
      const invent = Model.getId(allocate.inventory);
      const inventItem = Model.getId(allocate.item);
      const node = (join[invent] || {}).items[inventItem] || null;
      allocate.inventory_item = node;
    }
    return allocations;
  }
};
