/**
 * Station.js
 *
 * @description :: TODO: You might write a short summary of how this model works and what it represents here.
 * @docs        :: http://sailsjs.org/#!documentation/models
 */

const { TimeUtils, SqlUtils } = require('similie-api-services');
const { CommonCharts } = require('../model-utilities/charting/charting');
const {
  StationEventBoundary
} = require('../model-utilities/station/station-event-boundary');
const {
  StationReports
} = require('../model-utilities/station/station-reports');
const SailsExtensions = require('../services/SailsExtensions');
const {
  StationTracker
} = require('../model-utilities/station/station-tracker');

const escape = SqlUtils.escapeUtil();
const tz = TimeUtils.constants.timeZone;
const now_ = TimeUtils.constants.now_;
const Format = TimeUtils.constants.formats;
const fourK = '4000';
const DISTANCE_THRESHOLD = process.env.DISTANCE_THRESHOLD || fourK;

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  transaction_entity: true,
  attributes: {
    station_id: {
      type: 'string'
      //  unique: true
    },

    serial_number: {
      type: 'string',
      unique: true
    },

    local_name: {
      type: 'string'
    },

    registration_id: {
      type: 'string'
    },

    code: {
      type: 'string'
    },

    geo: {
      type: 'geometry'
    },

    station_state: {
      model: 'variable'
    },

    station_type: {
      // type: 'string',
      model: 'stationschema',
      required: true
    },

    district: {
      model: 'district'
    },

    tags: {
      collection: 'tag'
    },

    files: {
      collection: 'sysfile'
    },

    parents: {
      type: 'array'
    },

    archived: {
      type: 'boolean',
      defaultsTo: false
    },

    schema: {
      type: 'json'
    },

    alerts: {
      type: 'json'
    },

    domain: {
      model: 'domain',
      defaultsTo: null
    },

    settings: {
      type: 'json'
    },

    word_address: {
      type: 'json'
    },

    address: {
      type: 'json'
    },

    meta: {
      type: 'json'
    },

    scannable_id: {
      unique: true,
      type: 'string'
    },

    organizational: {
      type: 'boolean',
      defaultsTo: false
    },

    members_only: {
      type: 'boolean',
      defaultsTo: false
    },

    has_facilities: {
      type: 'boolean',
      defaultsTo: false
    },

    state_key: {
      model: 'statekeys'
    },

    toJSON: function() {
      const station = this.toObject();
      station.tags = station.tags || [];
      station.tags = _.pluck(station.tags, 'id');
      delete station.geo;
      return station;
    },

    pullDistricts: function() {
      return District.pullRegions(this.code);
    }
  },

  applyPointToGeoJson: function(stationPoint, row = null) {
    if (!row) {
      return;
    }
    Array.isArray(stationPoint.geography.features) &&
      stationPoint.geography.features.forEach(feature => {
        feature.properties.ews = {
          early_warning: true,
          early_warnings: row
        };
      });
  },

  applyEventsToFilteredStations: function(stationPoints = [], rows = []) {
    if (!rows.length) {
      return;
    }
    const rowCache = {};
    _.each(rows, r => {
      rowCache[r.station] = rowCache[r.station] || [];
      rowCache[r.station].push(r);
    });
    for (const stationPoint of stationPoints) {
      Array.isArray(stationPoint.geography.features) &&
        stationPoint.geography.features.splice(1);
      this.applyPointToGeoJson(
        stationPoint,
        rowCache[this.getId(stationPoint)]
      );
    }
  },

  storyModules: function(identity, context = {}) {
    const modules = {
      getSimpleStationPoints: async function() {
        const stations = context.stations || context.station || [];
        if (!_.size(stations)) {
          return [];
        }
        return Geo.getSimpleStationPoints(stations);
      },
      getAssetPivotItems: function() {
        const charting = new CommonCharts(identity, context);
        const assetPivot = charting.assetPivot;
        return assetPivot.render();
      },
      getItemCounter: function() {
        const charting = new CommonCharts(identity, context);
        const itemCounter = charting.itemCounter;
        return itemCounter.render();
      },
      getInventoryTypeCounter: function() {
        const charting = new CommonCharts(identity, context);
        const inventoryTypeCounter = charting.inventoryTypeCounter;
        return inventoryTypeCounter.render();
      },
      getMissionReadiness: function() {
        const charting = new CommonCharts(identity, context);
        const missionReadiness = charting.missionReadiness;
        return missionReadiness.render();
      }
    };
    const module = modules[identity];
    if (!module) {
      throw new Error(`Station Story Module ${identity} not found`);
    }
    return module;
  },

  breakdownPullQueryByDomain: function(where = {}, index = 0) {
    if (!Array.isArray(where.domain)) {
      return;
    }
    let localQuery = '';
    for (let i = 0; i < where.domain.length; i++) {
      const domain = where.domain[i];
      localQuery += escape(
        `${i > 0 ? ' OR ' : ''}  "domain" %s `,
        domain ? `= ${this.getId(domain)}` : 'IS NULL'
      );
    }
    const query = escape(
      `${index === 0 ? ' WHERE ' : ' AND '} (%s) `,
      localQuery
    );
    return query;
  },

  breakdownPullQueryByInString: function(where, index = 0) {
    const copy = { ...where };
    let query = '';

    for (const key in copy) {
      const value = copy[key];
      if (!Array.isArray(value)) {
        continue;
      }
      query += escape(
        `${index === 0 ? ' WHERE ' : ' AND '} %s `,
        SqlUtils.setInString(where[key])
      );
      delete where[key];
    }
    return query;
  },

  gurdNotCorrectNotTypeArray: function(value) {
    return (
      typeof value !== 'object' ||
      !value['!'] ||
      !Array.isArray(value['!']) ||
      !value['!'].length
    );
  },

  setNotInIdObject: function(where, index = 0) {
    let query = '';
    const items = {
      ...where
    };
    for (const key in items) {
      const value = items[key];
      if (this.gurdNotCorrectNotTypeArray(value)) {
        continue;
      }
      query += escape(
        `${index === 0 ? ' WHERE ' : ' AND '} "id" NOT %s `,
        SqlUtils.setInString(value['!'])
      );
      delete where[key];
      index++;
    }
    return query;
  },

  buildMergeQueryForLinkedStations: function(
    where = {},
    ids = [],
    restrictedId = [],
    req
  ) {
    const limit = SailsExtensions.limit(req);
    const skip = SailsExtensions.skip(req);
    const sort = SailsExtensions.sort(req);
    const merge = _.merge(where, {
      domain: ids,
      archived: false,
      id: {
        '!': restrictedId
      }
    });
    return {
      limit: limit,
      skip: skip,
      sort: sort || { local_name: 'ASC' },
      where: {
        ...merge
      }
    };
  },

  buildRestrictedIdsForDomainsQuery: async function(req) {
    const params = req.params.all();
    const parent = params.parent;
    const stationID = params.id;
    const no_assets = params.no_assets || false;
    let ancestry;
    let current = [];
    if (parent) {
      ancestry = await this.ancestors(params.id, no_assets);
      const children = await this.children(params.id, no_assets);
      current = _.map(children, c => parseInt(c.id));
    } else {
      ancestry = await this.children(params.id, no_assets);
      const station = await this.findOne(params.id);
      current = _.map(station.parents, c => parseInt(c));
    }
    const restricted = _.pluck(ancestry, 'id');
    let restrictedId = _.map(restricted, f => parseInt(f));
    if (!_.size(restrictedId)) {
      restrictedId.push(stationID);
    }
    restrictedId = _.union(restrictedId, current);
    return restrictedId;
  },

  setNoDomainQuery: async function(where = {}, restrictedId = [], req) {
    const params = req.params.all();
    const noAssets = params.no_assets || false;
    const limit = SailsExtensions.limit(req);
    const skip = SailsExtensions.skip(req);
    const sort = SailsExtensions.sort(req);
    where.id = {
      '!': restrictedId
    };
    where.archived = false;
    if (noAssets) {
      const ss = await StationSchema.find().where({ is_asset: true });
      const sids = _.pluck(ss, 'id');
      if (_.size(sids)) {
        where.station_type = { '!': sids };
      }
    }
    const bindIds = await Domain.findBoundedDomainIds();
    where.domain = bindIds.map(d => this.getId(d));
    where.domain.push(null);
    return this.pullStationsByDomain({
      where: where,
      sort: sort || { local_name: 'ASC' },
      limit: limit || 100,
      skip: skip
    });
  },

  addedSkipSortAndLimit: function(queryObj = {}) {
    let query = '';
    if (queryObj.sort) {
      query += ` ${SqlUtils.buildSort(queryObj.sort)} `;
    }

    if (queryObj.skip) {
      query += escape(` OFFSET %s `, queryObj.skip);
    }

    if (queryObj.limit) {
      query += escape(` LIMIT %s `, queryObj.limit);
    }
    return query;
  },

  pullQueryStringForDomains: function(queryObj = {}) {
    const where = Object.assign({}, queryObj.where || {});
    const escape = SqlUtils.escapeUtil();
    let index = 0;
    let query = 'SELECT "id" FROM "station" ';
    if (where.or) {
      index++;
      query += escape(`WHERE (%s) `, SqlUtils.generateOrQueryString(where.or));
      delete where.or;
    }

    if (Array.isArray(where.domain)) {
      query += this.breakdownPullQueryByDomain(where, index);
      index++;
      delete where.domain;
    }
    const addInStrings = this.breakdownPullQueryByInString(where, index);
    if (addInStrings) {
      query += addInStrings;
      index++;
    }
    const addNotInStrings = this.setNotInIdObject(where, index);
    if (addNotInStrings) {
      query += addNotInStrings;
      index++;
      delete where.id;
    }

    const whereString = SqlUtils.buildWhereString(where);
    if (whereString) {
      query += escape(`${index === 0 ? ' WHERE ' : ' AND '} %s `, whereString);
    }
    query += this.addedSkipSortAndLimit(queryObj);
    return query;
  },

  pullStationIdsWithCommonTagsQueryString: async function(query) {
    const results = await this.queryAsync(query);
    const rows = results.rows;
    if (!rows.length) {
      return [];
    }
    return rows.map(r => this.getId(r));
  },

  pullStationsByDomain: async function(queryObj = {}) {
    try {
      const query = this.pullQueryStringForDomains(queryObj);
      const results = await this.pullStationIdsWithCommonTagsQueryString(query);
      if (!results.length) {
        return [];
      }
      return this.find()
        .where({ id: results })
        .populateAll();
    } catch (e) {
      sails.log.error('Station.pullStationsByDomain', e.message);
    }
    // fallback to old method
    return this.find(queryObj).populateAll();
  },

  getStationSchema: async function(station, fullSchema = false) {
    const sID = Station.getId(station);
    const qType = fullSchema ? `"ss".*` : `"ss"."id"::INT`;

    const query = escape(
      `SELECT ${qType} as "id" FROM "station" "s" JOIN "stationschema" "ss" ON "s"."station_type" = "ss"."id"  WHERE s."id" = %s;`,
      sID
    );
    const results = await StationSchema.queryAsync(query);
    const stationSchema = results.rows.pop();
    if (fullSchema) {
      stationSchema.schema = JSON.parse(stationSchema.schema);
      return stationSchema;
    }
    const ssID = (stationSchema || {}).id;
    if (!ssID) {
      return null;
    }
    return await StationSchema.findOneById(ssID).populateAll();
  },

  async siteThroughStation(station) {
    const stationSchema = await this.getStationSchema(station);
    if (!stationSchema) {
      return null;
    }
    return Site.thisSiteAsync(stationSchema.domain);
  },

  ewsMapQuery: function(stationIds) {
    if (!_.size(stationIds)) {
      throw new Error('No stations from processing');
    }
    return `
    SELECT
      ew.name,
      ew.station,
      ews.target as "node",
      ew.node as "schema",  
      ew.parameters,
      ew.color,
      ews.id as "ews",
      ew.id as "event",
      ews.triggered_time,
      ews.trigger_values
    from "earlywarning" ew
          JOIN "ews" ews ON(ews.early_warning = ew.id)
          WHERE
            ew.active = true
            AND ews."event_category" = 'earlywarning'
            AND ews.expired = true
            AND ews.perform = true
            AND (ew.passive IS NULL OR ew.passive = false)
            AND ews.triggered_time IS NOT NULL

            AND (
            ((ew.timeout IS NOT NULL AND ew.timeout > 0) AND EXTRACT(EPOCH FROM NOW()::TIMESTAMP WITH TIME ZONE AT TIME ZONE '${tz}')
            - EXTRACT(EPOCH FROM ews.triggered_time::TIMESTAMP WITH TIME ZONE AT TIME ZONE '${tz}') <= (ew.timeout * 60) )
              OR ((ew.timeout IS NULL OR ew.timeout = 0) AND EXTRACT(EPOCH FROM NOW()::TIMESTAMP WITH TIME ZONE AT TIME ZONE '${tz}')
              -- we want to timeout the event after 24 hours
              - EXTRACT(EPOCH FROM ews.triggered_time::TIMESTAMP WITH TIME ZONE AT TIME ZONE '${tz}') <= (24 * 60 * 60))
             )

            AND ew.station ${SqlUtils.setInString(stationIds)}
            ORDER BY ews.triggered_time DESC;
        `;
  },

  _processors: [
    {
      name: 'stationLineageTracker',
      process: async function(job) {
        const data = job.data;
        // sails.log.debug("Jobs.stationLineageTracker::PROCESSING", data);
        let result;
        try {
          result = await Station.stationLineageTracker(data);
        } catch (e) {
          sails.log.error('Jobs.stationLineageTracker::ERROR CATCH', e);
        }
        return result;
      },

      stats: Utils.stats({
        completed: function() {
          // sails.log.debug("Jobs.lineageTracker::COMPLETE::", result);
        },
        failed: function(job, err) {
          sails.log.error('Jobs.lineageTracker::ERR::', err);
        }
      })
    },
    {
      name: 'stationEventBoundary',
      process: async function(job) {
        const data = job.data;
        sails.log.debug('Jobs.stationEventBoundary::PROCESSING', data);
        const fragment = await Station.stationEventBoundary(data);
        return fragment;
      },

      stats: Utils.stats({
        completed: function(job, result) {
          sails.log.debug('Jobs.stationEventBoundary::COMPLETE::', result);
        },
        failed: function(job, err) {
          sails.log.error('Jobs.stationEventBoundary::ERR::', err);
        }
      })
    }
  ],

  getDriver: async function(station, language) {
    /*
    @todo:::: implement driver logic
    */

    const unknown = await Variable.findOne({
      key: Translates.translateIdentity,
      identity: 'unknown_driver_value'
    });
    language = language || Translates.fallbackLanguage;
    const value = ((unknown || {}).value || {})[language] || 'Unknown Driver';
    return value;
  },

  triangulate: async function(potentials, point) {
    let id;
    if (_.size(potentials) === 1) {
      id = potentials[0].id || potentials[0].station;
    } else if (_.size(potentials) > 1 && _.size(point)) {
      // search on point
      const stations = [];
      _.each(potentials, p => {
        const id = p.id || p.station;
        if (id) {
          stations.push(id);
        }
      });
      // we only need these stations
      const filter = `
      AND "id" ${SqlUtils.setInString(stations)}
      `;
      const closest = await Geo.findClosestStation(point, filter);
      if (_.size(closest)) {
        id = closest[0].id || closest[0].station;
      } else {
        let primary = _.where(potentials, {
          primary: true
        });
        if (!_.size(primary)) {
          primary = potentials[0];
        }
        id = primary[0].id || primary[0].station;
      }
    } else if (_.size(potentials) > 1 && !_.size(point)) {
      let primary = _.where(potentials, {
        primary: true
      });

      if (!_.size(primary)) {
        primary = potentials[0];
      }
      id = primary[0].id || primary[0].station;
    }

    if (!id) {
      throw new Error({
        error: 'No potential stations found'
      });
    }

    return await Station.findOneById(id);
  },

  stationEventBoundary: async function(payload) {
    Utils.itsRequired(payload.register)(
      Utils.setErrorCode(Const.code.BAD_REQUEST)
    );
    Utils.itsRequired(payload.context)(
      Utils.setErrorCode(Const.code.BAD_REQUEST)
    );

    const eventBoundary = new StationEventBoundary(payload);
    const events = await eventBoundary.run();
    return events;
  },

  stationLineageTracker: async function(data = {}) {
    Utils.itsRequired(data.station)(Utils.setErrorCode(Const.code.BAD_REQUEST));
    Utils.itsRequired(data.node)(Utils.setErrorCode(Const.code.BAD_REQUEST));
    Utils.itsRequired(data.schema)(Utils.setErrorCode(Const.code.BAD_REQUEST));
    const ancestors = await this.ancestors(this.getId(data.station));
    const ns = await NodeSchema.findOneById(data.schema);
    const node = await Node.findOneById(data.node, ns);
    const aSize = _.size(ancestors);

    if (aSize <= 1) {
      return false;
    }
    const testFragments = [];
    // we start with one because we want
    for (let i = 1; i < aSize; i++) {
      const ancestor = ancestors[i];
      const aId = Station.getId(ancestor);
      if (!aId) {
        continue;
      }
      const station = await Station.findOneById(aId).populateAll();
      if (!station.station_type.has_event_boundary) {
        continue;
      }

      const payload = {
        register: data.station,
        context: data,
        station: station,
        node: node,
        ns: ns
      };

      const fragments = await Station.stationEventBoundary(payload);
      if (!fragments) {
        continue;
      }

      testFragments.push(fragments);
    }
    return testFragments;
  },

  ancestors: async function(station, no_assets, shallow = false) {
    const queryType =
      Utils.isNumeric(station) || !_.isString(station)
        ? `s."id" = ${Station.getId(station)}`
        : `s."station_id" = '${station}'`;
    const query = escape(
      `	with recursive rel_tree as (
        select s."id", s."local_name", s."station_id", s."station_type", s."parents", 1 as level, array[s."id"] as "path_info"
        from station s
        WHERE %s
        union all
        select c."id", c.local_name, c.station_id, c.station_type, c.parents, p.level + 1, p.path_info||c."id"
        from station c
        ${
          no_assets
            ? `JOIN "stationschema" ss ON (ss."id" = c."station_type")`
            : ''
        }
        join rel_tree p on (REPLACE(REPLACE (p.parents::text, '[', '{' ), ']', '}'))::int[] @> (ARRAY[]::int[] || c.id::int)
          WHERE p.id <> c.id
          ${no_assets ? `AND (ss.is_asset IS NULL OR ss.is_asset = false)` : ''}
          AND path_info::int[] ${
            shallow ? '<@' : '@>'
          } (ARRAY[]::int[] || p.id::int) AND p.level < 20 AND "c"."archived" IS FALSE 
        )
        select id, local_name, station_id, station_type, level
        from rel_tree
        order by path_info ASC;`,
      queryType
    );
    const ancestry = await Station.queryAsync(query);
    return ancestry.rows;
  },

  stationDetails: async function(stations = []) {
    const ids = stations.map(s => this.getId(s));
    const query = `SELECT "ss"."id" as "station_type", "ss"."name", "ss"."icon", "ss"."color", "s"."id" as "station"
    FROM "station" "s" JOIN "stationschema" "ss" ON ("s"."station_type" = "ss"."id")
    WHERE "s"."id" ${SqlUtils.setInString(ids)}
    `;
    const results = await this.queryAsync(query);
    return results.rows;
  },

  children: async function(station, no_assets, shallow = false) {
    const queryType = Utils.isNumeric(station)
      ? `s."id" = ${Station.getId(station)}`
      : `s."station_id" = '${station}'`;
    const query = escape(
      `with recursive rel_tree as (
        select s."id", s."local_name", s."station_id", s."station_type", s."parents", 1 as level, array[s."id"] as path_info
        from station s
        WHERE %s
        union all
        select c.id, c.local_name, c.station_id, c.station_type, c.parents, p.level + 1, p.path_info||c.id
        from station c
        ${
          no_assets
            ? `JOIN "stationschema" ss ON (ss."id" = c."station_type")`
            : ''
        }
          join rel_tree p on (REPLACE(REPLACE (c.parents::text, '[', '{' ), ']', '}'))::int[] @> (ARRAY[]::int[] || p.id::int)
          WHERE p."id" <> c."id"
          ${no_assets ? `AND (ss.is_asset IS NULL OR ss.is_asset = false)` : ''}
          AND path_info::int[] ${
            shallow ? '<@' : '@>'
          } (ARRAY[]::int[] || p.id::int) AND p.level < 20 AND "c"."archived" IS FALSE 
        )
        select id, local_name, station_id, station_type, "level"
        from rel_tree
        order by "level" ASC;`,
      queryType
    );
    const ancestry = await Station.queryAsync(query);
    return ancestry.rows;
  },

  commonStationTags: async function(stationModel) {
    Utils.itsRequired(stationModel)(Utils.setErrorCode(Const.code.BAD_REQUEST));
    const stationId = this.getId(stationModel);

    if (!stationId) {
      return null;
    }

    const stationComplete = await Station.findOneById(stationId).populate(
      'tags'
    );
    const tags = stationComplete.tags;

    if (!_.size(tags)) {
      return [];
    }

    const model_name = 'station';
    const qCompoents = Utils.queryCollection(
      {
        key: 'tags',
        model: 'tag'
      },
      model_name
    );

    const q = 'SELECT %s as id, %s as tag FROM %s where %s %s';
    const query = escape(
      q,
      qCompoents.model_row,
      qCompoents.collection_row,
      qCompoents.table,
      qCompoents.collection_row,
      SqlUtils.setInString(tags)
    );
    const common = await Station.queryAsync(query);
    const commonStations = common.rows;
    const ids = _.pluck(commonStations, 'id');
    return _.unique(ids);
  },

  boundaryQuery: async function(params, where) {
    if (!params.boundary) {
      return;
    }
    const boundary = _.isString(params.boundary)
      ? JSON.parse(params.boundary)
      : params.boundary;
    const ids = await Geo.findStationsWithinBounds(boundary);
    if (_.size(ids)) {
      where.id = _.pluck(ids, 'id');
    }
  },

  hasNodeSchema: async function(station, schema) {
    const hasSchema = false;
    const s = await Station.findOneById(Station.getId(station));
    if (!s) {
      return hasSchema;
    }
    const nodes = await StationSchema.getNodes(s.station_type);
    return _.contains(nodes, NodeSchema.getId(schema));
  },

  getStationVariables: async function(domain) {
    const station_stateVars = await Variable.find().where({
      domain: null,
      // or: [{ domain: null }, { domain: Domain.getId(domain) }],
      key: 'station_state'
    });

    const vars = {};
    _.each(station_stateVars, function(sVar) {
      if (sVar.domain === Domain.getId(domain)) {
        vars[sVar.identity] = {
          id: sVar.id,
          domain: true
        };
      } else if (!(vars[sVar.identity] || {}).domain) {
        vars[sVar.identity] = {
          id: sVar.id,
          domain: false
        };
      }
    });

    return vars;
  },

  buildThemedStations: async function(
    name,
    verified,
    themes,
    domain,
    parent,
    pool
  ) {
    const stations = [];
    const vars = await Station.getStationVariables();
    const station_state = verified
      ? (vars.registered_state || {}).id
      : (vars.draft_state || {}).id;
    /**
     * @TODO [sg] Check. Moved this out of the for-loop to save time
     * generating a new date object for every variable in the list
     */
    const initiatedDate = TimeUtils.formattedDate(now_, Format.Date.full);
    const themeSize = _.size(themes);
    for (let i = 0; i < themeSize; i++) {
      const theme = themes[i];
      const station = {
        station_type: theme.id,
        local_name: name || `Intiated ${initiatedDate}`,
        // [sg]local_name: name || `Intiated ${moment().tz(tz).format('LL')}`,
        station_state: station_state,
        domain: Domain.getId(domain),
        parents: [],
        meta: {}
        // need the variables
      };

      if (parent) {
        station.parents.push(parent);
      }

      if (pool) {
        pool.station_state = station_state;
      }

      stations.push(station);
    }
    return stations;
  },

  formatAssetQuery: async function(where, schema) {
    let stations;
    const stationId = where.station;
    if (
      stationId === -1 &&
      _.size(schema.parents) &&
      !schema.falseDomainMatch
    ) {
      stations = await Station.find({
        id: schema.parents
      });
    } else if (stationId > 0) {
      stations = await Station.findLinks(where.station);
    }
    if (_.size(stations)) {
      delete where.station;
      where.station = {
        in: _.union(_.pluck(stations, 'id'), [stationId])
      };
    }
    return stations;
  },

  findLinks: async function(stationObj) {
    Utils.itsRequired(stationObj)();
    const stationId = this.getId(stationObj);
    // let station = await Station.findOneById(stationId);
    const query =
      "SELECT * FROM station WHERE \"parents\" IS NOT NULL AND STRING_TO_ARRAY( REPLACE( REPLACE(\"parents\", ']', ''), '[', ''), ',' )::int[] @> '{%s}';";
    const stations = await Station.queryAsync(escape(query, stationId));
    return stations.rows;
  },

  global: async function() {
    const global = {
      id: -1
    };
    return global;
  },

  isOneStationObject(stations) {
    return !_.isArray(stations) && _.isObject(stations);
  },

  setStationForDecoration(stations) {
    return this.isOneStationObject(stations) ? [stations] : stations;
  },

  decorate: async function(stations, withoutGeo) {
    const theseStations = this.setStationForDecoration(stations);
    for (let i = 0; i < theseStations.length; i++) {
      const station = theseStations[i];
      await decorations(station, withoutGeo);
    }
    return this.isOneStationObject(stations)
      ? theseStations.pop()
      : theseStations;
  },

  labels: function() {
    const labels = {
      station_id: 'labels.STATION_ID',
      local_name: 'labels.LOCAL_NAME',
      point: 'labels.GEO_POINT',
      location: 'labels.LOCATION',
      station_state: 'labels.STATION_STATE',
      station_type: 'labels.STATION_TYPE',
      district: 'labels.DISTRICT',
      archived: 'labels.ARCHIVED'
    };

    return _.clone(labels);
  },

  beforeValidate: function(station, next) {
    Geo.setGeo(station, err => {
      if (err) {
        return next(err);
      }
      Variable.pullImports(station, next);
    });
  },

  schema: function() {
    const schema = [
      {
        key: 'id',
        label: 'labels.ID',
        type: 'integer'
      },

      {
        key: 'station_id',
        label: 'labels.STATION_ID',
        type: 'string'
      },

      {
        key: 'local_name',
        label: 'labels.LOCAL_NAME',
        type: 'string'
      },

      {
        key: 'code',
        label: 'labels.CODE',
        type: 'string'
      },

      {
        key: 'station_state',
        label: 'labels.STATION_STATE',
        type: 'variable'
      },

      // {
      //   key: 'station_type',
      //   label: 'labels.STATION_TYPE',
      //   type: 'variable'
      // },

      {
        key: 'tags',
        label: 'labels.STATION_TAGS',
        type: 'tags'
      },

      {
        key: 'geography',
        label: 'labels.GEOGRAPHY',
        type: 'geometry'
      },

      {
        key: 'alerts',
        label: 'labels.ALERTS',
        type: 'json'
      }
    ];

    return _.clone(schema);
  },

  set_geo_string: function(stations, cb) {
    if (!_.size(stations)) {
      return cb(null, stations);
    }

    const query =
      'SELECT ST_AsText(geo) as geo, id from station where id in (%s);';
    const ids = _.pluck(stations, 'id');
    Station.query(escape(query, ids), (err, results) => {
      if (err) {
        sails.log.error(err);
        return cb(err);
      }

      const rows = results.rows;
      // super inefficient
      _.each(rows, r => {
        const station = _.where(stations, {
          id: r.id
        })[0];

        if (station) {
          station.geography = r.geo;
        }
      });

      cb(null, stations);
    });

    // select ST_AsText(geo), id from station where id in (3,5,74,43);
  },

  getRoleForStation: async function(stationContents, user) {
    let userRole = null;
    const membership = await Requisition.findOne({
      user: User.getId(user),
      station: Station.getId(stationContents),
      archived: false
    });
    if (!_.size(membership)) {
      const primaryStation = await Requisition.findOne(
        this.getMembershipsQueryForRequisitions(user)
      );
      if (_.size(primaryStation)) {
        const children = await Station.children(
          Station.getId(primaryStation.station)
        );
        const validChild = _.filter(
          children,
          c => c.id === Station.getId(stationContents)
        );

        if (_.size(validChild)) {
          userRole = primaryStation.role;
        }
      }
    } else if (membership) {
      userRole = membership.role;
    }
    return userRole !== null ? userRole : user.role;
  },

  generateIdQuery: function(stationIdTracker, domain) {
    if (this.getId(stationIdTracker)) {
      return { id: this.getId(stationIdTracker) };
    }
    const query = {
      prefix: stationIdTracker.prefix,
      domain: this.getId(domain)
    };
    if (stationIdTracker.postfix) {
      query.postfix = stationIdTracker.postfix;
    }
    if (stationIdTracker.decimal) {
      query.decimal = stationIdTracker.decimal;
    }
    return query;
  },

  getQueryTracker: async function(stationIdTracker, domain) {
    const query = this.generateIdQuery(stationIdTracker, domain);
    let trackers = await StationIdTracker.find().where(query);
    if (!trackers.length) {
      const tacker = await StationIdTracker.create(query);
      trackers = tacker ? [tacker] : null;
    }
    return trackers;
  },

  filterTrackers: function(trackers = [], domain = null) {
    let track = trackers[0];
    const limit = _.size(trackers);
    for (let i = 1; i < limit; i++) {
      const tracker = trackers[i];
      if (
        track.count < tracker.count &&
        this.getId(track.domain) === this.getId(domain)
      ) {
        track = tracker;
        break;
      }
    }
    return track;
  },

  /**
   * @description Formats the id for a new station
   *
   * @param {Object} prefix - the station prefix
   * @param {String} preString - intermediate code to append
   * @param {Boolean} bypass - don't create the id
   * @param {Float} decimal - determines how many zeros
   * @param {Function} cb - callback
   *
   */
  generateID: async function(stationIdTracker, domain = null, bypass = false) {
    if (bypass) {
      return bypass;
    }
    const trackers = await this.getQueryTracker(stationIdTracker, domain);
    if (!_.size(trackers)) {
      throw new Error('Something has gone wrong creating this station');
    }

    const st = new StationTracker(this.filterTrackers(trackers));
    const stationID = await st.formatId();
    return stationID;
  },

  getMembershipAncestry: async function(memberships) {
    const access = [];
    const contains = {};
    // we will only give trickle access where primary station is true
    const stations = _.pluck(
      _.where(memberships, { primary: true }),
      'station'
    );
    const sizeOfStations = _.size(stations);
    for (let i = 0; i < sizeOfStations; i++) {
      const stationId = stations[i];
      if (contains[stationId]) {
        continue;
      }
      const children = await this.children(stationId);
      const _stations = _.pluck(children, 'id');
      _.each(_stations, s => {
        contains[s] = true;
      });
    }

    _.each(memberships, m => {
      const id = Station.getId(m.station);
      if (!contains[id]) {
        contains[id] = true;
      }
    });

    _.each(contains, (s, id) => {
      if (s && !_.isNaN(id)) {
        access.push(parseInt(id));
      }
    });

    return access;
  },

  getMemberships: async function(user) {
    const uId = User.getId(user);
    const reqs = await Requisition.find().where({
      user: uId
    });
    const ancestry = await this.getMembershipAncestry(reqs);
    if (!_.size(ancestry)) {
      return [];
    }
    const stations = await Station.find()
      .where({ id: ancestry })
      .populateAll();
    return stations;
  },

  getMembershipsQueryForRequisitions: function(user) {
    return {
      user: User.getId(user),
      archived: false
    };
  },

  getOrganizationalIdQuery: function(organization) {
    const escape = SqlUtils.escapeUtil();
    const query = `SELECT
    "s"."id"
  FROM
    "station" "s"
    LEFT JOIN "stationorg" "so" ON ( "s"."id" = "so"."station" )
    JOIN "organization" "o" ON ("so"."organization" = "o"."id")
    WHERE "o"."id" %s`;
    const userQuery = `${
      Array.isArray(organization)
        ? `${SqlUtils.setInString(organization)}`
        : `= ${Organization.getId(organization)}`
    }`;
    return escape(query, userQuery);
  },

  getOrganizationalIds: async function(user) {
    if (!Reflect.has(user, 'organization') || !_.size(user.organization)) {
      return [];
    }
    const query = this.getOrganizationalIdQuery(user.organization);
    const results = await Model.queryAsync(query);
    const rows = results.rows;
    return rows.map(r => Station.getId(r));
  },

  stationHasOrganizationalUser: async function(station, user) {
    if (!Reflect.has(user, 'organization')) {
      return false;
    }
    const escape = SqlUtils.escapeUtil();
    const query =
      this.getOrganizationalIdQuery(user.organization) +
      escape(` AND "station" = %s`, Station.getId(station));
    const results = await Model.queryAsync(query);
    const rows = results.rows || [];
    return rows.length > 0 ? user.role : false;
  },

  applyAccessToQuery: async function(access = [], where) {
    if (!access.length) {
      return;
    }
    where.or = where.or || [];
    where.or.push({
      members_only: true,
      id: access
    });
  },

  buildOrForNonMemebers: function(where) {
    where.or = where.or || [];
    where.or.push(
      {
        members_only: false
      },
      {
        members_only: null
      }
    );
  },

  setMembership: async function(user, where) {
    const memberships = await Requisition.find().where(
      this.getMembershipsQueryForRequisitions(user)
    );
    const access = await this.getMembershipAncestry(memberships); // [];
    this.buildOrForNonMemebers(where);
    this.applyAccessToQuery(access, where);
    const orgIds = await this.getOrganizationalIds(user);
    this.applyAccessToQuery(orgIds, where);
  },

  afterDestroy: function(values, next) {
    Activity.createActivity(values, 'station_archived');
    next();
  },

  afterCreate: function(values, next) {
    Activity.createActivity(values, 'station_creation');
    StateKeys.registerState(values, 'station', 'station_type');
    if (values.geo) {
      sails.sockets.blast('station-point-alteration', {
        id: values.id
      });
    }
    next();
  },

  beforeUpdate: function(station, next) {
    this.withinDistrict(station, next);
  },

  pullStationId: async function(stationSchema, domain) {
    const station_id = stationSchema.station_id;
    const stationID = await this.generateID(station_id, domain);
    return stationID;
  },

  beforeCreate: async function(values, next) {
    /*
     * Also need a way to import a  station type string
     */
    const station = await Station.findOne({
      station_id: values.station_id,
      domain: Domain.getId(values.domain)
    });

    if (_.size(station)) {
      return next('This station idendity already exists for this domain');
    }

    const type_id = this.getId(values.station_type);
    if (!type_id) {
      return next('errors.STATION_TYPE_REQUIRED');
    }

    values.scannable_id = Node.createToken();
    // we do this because seeding isn't syncronous
    if (Site.isInTestMode() && values.station_id) {
      return next();
    }
    const stationschema = await sails.models.stationschema
      .findOne({
        id: type_id,
        active: true
      })
      .populate('station_id');
    if (!stationschema || !stationschema.station_url) {
      return next('errors.CORRECT_STATION_TYPE_REQUIRED');
    }

    try {
      const sId = await this.pullStationId(stationschema, values.domain);
      values.station_id = sId;
      return this.withinDistrict(values, next);
    } catch (err) {
      return next(err);
    }
  },

  cloneStationWithoutCode: function(values) {
    const station = Object.assign({}, values);
    delete station.code;
    return station;
  },

  compareStationCodeToValues: function(station = {}, values = {}) {
    return station.code === values.code && station.geo === values.geo;
  },

  sendPointAlteration: function(station) {
    const sId = this.getId(station);
    if (!sId) {
      return;
    }
    sails.sockets.blast('station-point-alteration', {
      id: sId
    });
  },

  buildStationForDistricts: async function(values) {
    const sId = this.getId(values);
    const station = sId
      ? await Station.findOneById(sId)
      : this.cloneStationWithoutCode(values);
    return station;
  },

  hasNoGeo: function(values) {
    return !values || !values.code || !values.geo;
  },

  itsOutsideGivenBoundary: function(its = {}) {
    return !its.inside && !its.crossing && its.distance > DISTANCE_THRESHOLD;
  },

  withinDistrict: async function(values, next) {
    // is we don't have a district, or the district is either number or object, return
    if (this.hasNoGeo(values)) {
      return next();
    }

    const meta = values.meta || {};
    if (meta.ignore_geo_restrictions) {
      delete meta.ignore_geo_restrictions;
      return next();
    }

    try {
      const station = await this.buildStationForDistricts(values);
      if (this.compareStationCodeToValues(station, values)) {
        return next();
      }

      this.sendPointAlteration(station);
      const regions = await District.pullRegions(values.code);
      const smallest = District.findSmallestForGeo(regions);
      const boundary = regions[smallest] || {};
      const inside = values.geo;
      const outside = boundary.geo;
      if (!inside || !outside) {
        return next();
      }
      const itsBoundary = await Geo.geoPullBoundaryData(inside, outside);
      if (this.itsOutsideGivenBoundary(itsBoundary)) {
        return next(
          'error.STATION_MUST_BE_WITHIN_DISTRICT_BOUNDARY_(' +
            itsBoundary.distance +
            ')'
        );
      }
      next();
    } catch (e) {
      sails.log.error('Station.withinDistrict::ERROR', e);
      return next(e);
    }
  },

  csvIdentity: function() {
    return ['station_id'];
  },

  pullDistricts: function(station) {
    return District.pullRegions(station.p_code);
  },

  reports: async function(dependents) {
    const stationReports = new StationReports(dependents);
    try {
      const reporting = await stationReports.fullfillStationReport();
      return reporting;
    } catch (e) {
      sails.log.error(e);
      return stationReports.reportingTemplate;
    }
  },

  setSpecialState: async function(station, identity, dontSave = false) {
    const stationschema = await this.getStationSchema(station, true);
    const [variable] = await Variable.find().where({
      key: 'station_state',
      identity: identity,
      domain: Domain.getId(stationschema.domain)
    });

    if (!variable) {
      return;
    }
    const meta = variable.meta || {};
    const category = meta.category;
    if (!category) {
      return;
    }

    const stationUrl = stationschema.station_url;
    const catSplit = (category || '').split(',');
    if (catSplit.indexOf(stationUrl) === -1) {
      return;
    }
    station.station_state = this.getId(variable);
    if (dontSave) {
      return;
    }
    return this.saveAsync(station);
  }
};

async function decorations(station, withoutGeo) {
  if (withoutGeo) return station;
  await Geo.pullGeoJson(station, 'geo');
  const links = (await Station.findLinks(station)) || [];
  const linkIds = links.map(l => l.id);
  station.meta.links = linkIds.filter(l => !!l);
  return station;
}
