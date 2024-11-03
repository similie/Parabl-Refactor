/**
 * StockTakeController
 *
 * @description :: Server-side actions for handling incoming requests.
 * @help        :: See https://sailsjs.com/docs/concepts/actions
 */
const _lo = require('lodash');
const { TimeUtils, SqlUtils } = require('similie-api-services');
const { StocktakePDF } = require('../model-utilities/stocktake/stocktake-pdf');
const now_ = TimeUtils.constants.now_;
const escape = SqlUtils.escapeUtil();

module.exports = {
  buildClone: async function(req, res) {
    try {
      const clone = await StockTake.getInventoryClone(req);
      return res.send(clone);
    } catch (e) {
      return res.badRequest(e.message);
    }
  },

  harmonize: async function(req, res) {
    const params = req.params.all();
    if (!params.id) {
      return res.badRequest({ error: 'warnings.STATION_ID_REQUIRED' });
    }
    try {
      const harmony = await StockTake.harmonize(params.id);
      res.send(harmony);
    } catch (e) {
      res.serverError(e);
    }
  },

  pdf: async function(req, res) {
    const params = req.params.all();
    if (!params.id) {
      return res.badRequest({ error: 'warnings.STOCKTAKE_ID_REQUIRED' });
    }

    const st = await StockTake.findOneById(params.id).populateAll();
    if (!st) {
      return res.badRequest({ error: 'warnings.STOCKTAKE_NOT_FOUND' });
    }

    try {
      const language = Translates.getLanguage(req, res);
      const pdf = new StocktakePDF(st, res.locals.siteData, language);
      const pdfContent = await pdf.build();
      res.set(pdf.downloadHeader);
      pdfContent.pipe(res);
      return pdfContent.end();
    } catch (e) {
      sails.log.error('StockTakeController::pdf:error', e);
      return res.serverError({ error: e.message });
    }
  },

  reconcile: async function(req, res) {
    if (!User.is(req.user, Roles.MANAGER)) {
      return res.forbidden({ error: 'warning.ROLE_NO_PERMITTED' });
    }

    const params = req.params.all();
    if (!params.id) {
      return res.badRequest({ error: 'warnings.STOCKTAKE_ID_REQUIRED' });
    }

    const st = await StockTake.findOneById(params.id).populateAll();

    if (!st) {
      return res.badRequest({ error: 'warnings.STOCKTAKE_NOT_FOUND' });
    }

    const query = StockTake.varianceQuery(st);

    const sc = await StockCount.queryAsync(query);
    const counts = sc.rows;

    // return res.send(st);

    const schemas = st.schemas;
    const ordered = _lo.groupBy(counts, 'schema');
    const helpers = Module._helpers.logistics();
    const station = Station.getId(st.station);
    const stationType = StationSchema.findOneById(
      StationSchema.getId(st.station.station_type)
    );
    const dId = Domain.getId(stationType.domain);
    const site = await Site.thisSiteAsync(dId);
    const currency = site.currency || Const.DEFAULT_CURRENCY;
    const domain = !dId
      ? Domain.defaultElements()
      : await Domain.findOneById(dId);
    const domainCode = Domain.costcodeName(domain);

    for (let i = 0; i < _.size(schemas); i++) {
      const schema = schemas[i];
      const schemaId = NodeSchema.getId(schema);
      const logParams = helpers.logParams(schema.schema);
      const qParam = logParams('quantity');
      const counts = ordered[schemaId];
      const ids = _.pluck(counts, 'item');

      if (!_.size(ids)) {
        continue;
      }

      const countCache = {};
      _.each(counts, c => {
        countCache[c.item] = c;
      });
      const nodes = await Node.findNodes(
        {
          where: {
            id: ids
          }
        },
        schema
      );

      for (let j = 0; j < _.size(nodes); j++) {
        const node = nodes[j];
        node.observer = User.getId(node.observer);
        node.domain = User.getId(node.domain);
        const cache = countCache[node.id];
        Node.resetAlarms(node);

        if (Station.getId(node.station) === station) {
          node[qParam] = cache.count;
          await Node.save(node, schema);
        } else {
          const clone = Node.clone(node); // _.clone(node);
          clone.station = station;
          clone.domain = Domain.getId(dId);
          clone.observer = User.getId(req.user);
          clone[qParam] = cache.count;
          await Node.save(clone, schema);
        }

        Modules.node(req, {
          locals: {
            domain: Model.getId((node || {}).domain),
            schema: schema,
            device: null,
            siteData: res.locals.siteData
          }
        })(node);
      }
    }
    st.reconciled = true;
    st.approved_by = User.getId(req.user);

    // [sg]st.snapshot.reconciled_time = moment().tz(tz).format();
    st.snapshot.reconciled_time = TimeUtils.isoFormattedDate(now_);
    const costcode = st.station.station_id;

    try {
      await CostCode.invoice({
        from: costcode,
        to: domainCode,
        amount: CostCode.convertCurrency(st.variance, currency),
        domain: Domain.getId(dId)
      });
    } catch (e) {
      sails.log.error(e);
      // need a way to revert
    }

    await StockTake.saveAsync(st);
    st.approved_by = _.clone(req.user);

    /*
    WE NEED A MEANS OF SENDING COMS NOW
    */

    Jobs.inventoryCleanup.add(st);

    res.send(st);
  },

  confirm: async function(req, res) {
    if (!User.is(req.user, Roles.RECORDER)) {
      return res.forbidden({ error: 'warning.ROLE_NO_PERMITTED' });
    }

    const params = req.params.all();

    if (!params.id) {
      return res.badRequest({ error: 'warnings.STOCKTAKE_ID_REQUIRED' });
    }

    const stocktake = params.id;
    const st = await StockTake.findOneById(stocktake);

    if (!st) {
      return res.badRequest({ error: 'warnings.STOCKTAKE_NOT_FOUND' });
    }

    // delete params.change;
    delete params.id;
    params.confirmed_by = User.getId(req.user);
    const count = params.count - params.count_hold;
    await StockVarianceConfirm.create(params);
    if (count) {
      const saver = {
        schema: params.schema,
        stocktake: StockTake.getId(st),
        user: User.getId(req.user),
        total: (params.unit_cost || 0) * count,
        item: params.item,
        sku: params.sku,
        count: count,
        item_name: params.item_name
      };
      await StockCount.create(saver);
    }

    const query = escape(
      `SELECT COUNT(*) FROM (${StockTake.varianceQuery(
        StockTake.getId(st),
        null,
        ' AND c.confirmed = false'
      )}) d`
    );

    const sc = await StockCount.queryAsync(query);
    const total = parseInt((sc.rows.pop() || {}).count);
    let scNew = st;
    if (total === 0) {
      st.counted = true;
      const query_o = escape(
        `SELECT SUM(d.delta_cost)::INTEGER, d."currency" as "currency" FROM (${StockTake.varianceQuery(
          StockTake.getId(st)
        )}) d GROUP BY d."currency";`
      );

      const s_c = await StockCount.queryAsync(query_o);
      const sumRow = s_c.rows.pop() || { sum: 0 };
      const varianceTotal = sumRow.sum;
      const currency = sumRow.currency || Const.DEFAULT_CURRENCY;
      const costAdjust = CostCode.parseValue(varianceTotal, currency);
      st.variance = costAdjust;

      const query_u = escape(
        'SELECT DISTINCT("user") from stockcount where "stocktake" = %s;',
        StockTake.getId(st)
      );
      const s_u = await StockCount.queryAsync(query_u);
      const users = s_u.rows || [];
      for (let i = 0; i < _.size(users); i++) {
        const u = users[i];
        st.contributors.add(u.user);
      }
      /*
      LETS GET OUR TOTAL VARIANCE
      */
      await StockTake.searchAndApplyVariances(st);
      await StockTake.saveAsync(st);
      scNew = await StockTake.findOneById(StockTake.getId(st)).populateAll();
    }
    res.send(scNew);
  },

  serial_check: async function(req, res) {
    const params = req.params.all();
    if (!params.id) {
      return res.badRequest({ error: 'warning.VALID_ITEM_ID_REQUIRED' });
    }

    if (!params.schema) {
      return res.badRequest({ error: 'warning.VALID_SCHEMA_ID_REQUIRED' });
    }

    const schema = await NodeSchema.findOneById(params.schema);

    if (!schema) {
      return res.badRequest({ error: 'warning.VALID_SCHEMA_NOT_FOUND' });
    }

    const serials = _.where(schema.schema, {
      type: 'node',
      serializable: true
    });

    if (!_.size(serials)) {
      return res.send(null);
    }

    const node = await Node.findOneById(params.id, schema);

    const counts = {};
    _.each(serials, s => {
      if ((node[s.name] || {}).count) {
        counts[s.name] = {
          count: node[s.name].count,
          node: s.node
        };
      }
    });

    if (_.size(counts)) {
      res.send(counts);
    } else {
      res.send(null);
    }
  },

  account: async function(req, res) {
    // const start = Date.now();
    if (!User.is(req.user, Roles.RECORDER)) {
      return res.forbidden({ error: 'warning.ROLE_NO_PERMITTED' });
    }

    // await checkVariances();
    const params = req.params.all();
    // sails.log.debug("ACCOUNT TIMER::: 1 ", Date.now() - start);
    if (!params.id || _.isNaN(parseInt(params.id))) {
      return res.badRequest({ error: 'warnings.STOCKTAKE_ID_REQUIRED' });
    }
    const st = await StockTake.findOneById(params.id);
    if (!st) {
      return res.badRequest({ error: 'warnings.STOCKTAKE_NOT_FOUND' });
    }
    const query = st.inprogress
      ? StockTake.sumQuery(st)
      : StockTake.varianceQuery(st);
    // ` AND c."confirmed" = ${st.reconciled}`
    const sc = await StockCount.queryAsync(query);
    const counts = sc.rows;
    if (!_.size(counts) && !st.inprogress && st.entered) {
      st.counted = true;
      await StockTake.saveAsync(st);
    }
    // for testing
    // await StockTake.searchAndApplyVariances(st);
    // await StockTake.saveAsync(st);
    // end testing
    // sails.log.debug("ACCOUNT TIMER::: 2 ", query, Date.now() - start);
    res.send(counts);
  },

  accountant: async function(req, res) {
    // const start = Date.now();
    if (!User.is(req.user, Roles.RECORDER)) {
      return res.forbidden({ error: 'warning.ROLE_NO_PERMITTED' });
    }
    // await checkVariances();
    const params = req.params.all();
    if (!params.id) {
      return res.badRequest({ error: 'warnings.STOCKTAKE_ID_REQUIRED' });
    }

    if (!params.sku) {
      return res.badRequest({ error: 'warnings.SKU_PARAM_NOT_FOUND' });
    }
    // sails.log.debug("ACCOUNTANT TIMER::: 1 ", start - Date.now());
    params.count = params.count == null ? 1 : params.count;
    // need to pull schema
    const st = await StockTake.findOneById(params.id)
      .populate('schemas')
      .populate('station');

    if (!st) {
      return res.badRequest({ error: 'warnings.STOCKTAKE_NOT_FOUND' });
    }

    if (!st.active || !st.snapshot) {
      return res.badRequest({ error: 'warnings.STOCKTAKE_NOT_ACTIVE' });
    }

    if (!st.stale) {
      return res.badRequest({ error: 'warnings.STOCKTAKE_ALREADY_STOPPED' });
    }
    let schemas;
    if (params.schema) {
      const schema = await NodeSchema.findOneById(params.schema);
      schemas = [schema];
    } else {
      schemas = st.schemas;
    }

    const stationType = StationSchema.findOneById(
      StationSchema.getId(st.station.station_type)
    );
    const site = await Site.thisSiteAsync(stationType.domain);
    const currency = site.currency || Const.DEFAULT_CURRENCY;

    const station = NodeSchema.getId(st.station);
    const helpers = Module._helpers.logistics();
    const nodePotentials = [];

    for (let i = 0; i < _.size(schemas); i++) {
      const schema = schemas[i];
      const _schema = NodeSchema.getId(schema);
      const logParams = helpers.logParams(schema.schema);
      const qParam = logParams('quantity');
      const skuParam = logParams('sku');
      const unitCost = logParams('unit_cost');
      const serviceItem = logParams('service_item');
      const name = logParams('name');
      const q = {
        where: {
          [skuParam]: params.sku,
          station: station
        }
      };
      if (serviceItem) {
        q.or = [{ [serviceItem]: false }, { [serviceItem]: null }];
      }

      let nodes = await Node.findNodes(q, schema);

      if (!_.size(nodes)) {
        delete q.station;
        nodes = await Node.findNodes(q, schema);
      }

      if (_.size(nodes)) {
        nodePotentials.push({
          schema: _schema,
          quantity_param: qParam,
          sku_param: skuParam,
          unit_cost_param: unitCost,
          service_param: serviceItem,
          name_param: name,
          nodes: nodes
        });
      }
    }

    if (!_.size(nodePotentials)) {
      return res.badRequest({ error: 'warnings.ITEM_DOES_NOT_EXIST' });
    }
    // we will just take the first one
    const nodeCount = [];

    for (let i = 0; i < _.size(nodePotentials); i++) {
      const potential = nodePotentials[i];

      const unitCost = potential.unit_cost_param;
      const name = potential.name_param;
      const schema = potential.schema;
      for (let j = 0; j < _.size(potential.nodes); j++) {
        const node = potential.nodes[j];

        const itemCost = node[unitCost] || 0;
        const cost = CostCode.convertCurrency(itemCost, currency);
        const unitTotal = cost * params.count;

        const saver = {
          schema: schema,
          stocktake: StockTake.getId(st),
          user: User.getId(req.user),
          total: unitTotal,
          item: node.id,
          sku: params.sku,
          count: params.count,
          item_name: node[name]
        };
        await StockCount.create(saver);

        const query = StockTake.sumQuery(st, params.sku, schema); // (st.inprogress ? sumQuery(st, params.sku) : varianceQuery(st, params.sku));

        const sc = await StockCount.queryAsync(query);
        const count = sc.rows;
        sails.sockets.blast(`stock-take-count-${station}`, count, req);
        nodeCount.push(...count);
      }
    }

    if (_.size(nodeCount) <= 1) {
      res.send(nodeCount.pop());
    } else {
      res.send(nodeCount);
    }
  },

  explain: async function(req, res) {
    if (!Utils.leastOne(req.method, 'POST')) {
      return res.badRequest({ error: 'Post requests only' });
    }
    const params = Utils.params(req);
    const explanation = params.explanation;
    delete params.explanation;
    const variance = await StockVarianceConfirm.update(params, {
      explanation
    });
    return res.send(variance);
  },

  end: async function(req, res) {
    if (!User.is(req.user, Roles.RECORDER)) {
      return res.forbidden({ error: 'warning.ROLE_NO_PERMITTED' });
    }

    const params = req.params.all();

    if (!params.id) {
      return res.badRequest({ error: 'warnings.STOCKTAKE_ID_REQUIRED' });
    }

    const st = await StockTake.findOneById(params.id)
      .populate('schemas')
      .populate('station');
    // unit_cost
    if (!st) {
      return res.badRequest({ error: 'warnings.STOCKTAKE_NOT_FOUND' });
    }

    if (!st.active || !st.snapshot) {
      return res.badRequest({ error: 'warnings.STOCKTAKE_NOT_ACTIVE' });
    }

    if (!st.stale) {
      return res.badRequest({ error: 'warnings.STOCKTAKE_ALREADY_STOPPED' });
    }

    if (st.snapshot.freezer_count === null) {
      return res.badRequest({ error: 'errors.STOCKTAKE_FREEZE_NOT_FOUND' });
    }
    // const station = NodeSchema.getId(st.station);
    const stationType = StationSchema.findOneById(
      StationSchema.getId(st.station.station_type)
    );
    const site = await Site.thisSiteAsync(stationType.domain);
    const currency = site.currency || Const.DEFAULT_CURRENCY;
    const helpers = Module._helpers.logistics();
    st.snapshot = st.snapshot || {};
    const sumQ = StockTake.sumQuery(st);
    const _sc = await StockCount.queryAsync(sumQ);
    const sc = _lo.groupBy(_sc.rows, 'schema');
    let cycleSum = 0;
    let endTotal = 0;

    for (let i = 0; i < _.size(st.schemas); i++) {
      const schema = st.schemas[i];
      const schemaId = NodeSchema.getId(schema);
      const logParams = helpers.logParams(schema.schema);
      const qParam = logParams('quantity');
      const skuParam = logParams('sku');
      const unitCost = logParams('unit_cost');
      const freeze = await StockFreeze.find({
        stocktake: StockTake.getId(st),
        stage: 'start',
        schema: schemaId
      });

      if (!_.size(freeze)) {
        continue;
      }
      const nodeIds = _.pluck(freeze, 'node');
      const cones = {};

      _.each(sc[schemaId], s => {
        cones[s.sku] = s;
      });

      _.each(freeze, snow => {
        const cone = cones[snow.sku] || {};
        if (_.size(cone) && snow.node === cone.item) {
          cycleSum += snow.unit * cone.count;
        }
      });

      const nodes = await Node.findNodes(
        {
          where: {
            // station: station,
            // [qParam]: { '>': 0 }
            id: nodeIds
          }
        },
        schema
      );
      const frost = [];
      const freezeObj = {
        schema: schemaId,
        stocktake: st.id,
        // total: 0,
        currency: currency,
        stage: 'end',
        frozen_by: User.getId(req.user)
      };
      for (let j = 0; j < _.size(nodes); j++) {
        const node = nodes[j];

        const itemCost = node[unitCost] || 0;
        const quantity = node[qParam] || 0;
        const cost = CostCode.convertCurrency(itemCost || 0, currency);
        const unitTotal = cost * quantity;
        endTotal += unitTotal;
        const sku = node[skuParam];
        const cone = cones[sku];

        if (!cone) {
          // here something didn't get counted
          await StockCount.create({
            schema: schemaId,
            stocktake: StockTake.getId(st),
            user: User.getId(req.user),
            total: unitTotal,
            item: node.id,
            sku: sku,
            count: 0, // Math.abs(node[qParam]) * -1,
            item_name: node[logParams('name')]
          });
        }

        const ice = {
          node: node.id,
          sku: sku,
          quantity: quantity,
          unit: cost,
          total: unitTotal
        };
        frost.push(_.merge(ice, _.clone(freezeObj)));
      }
      await StockFreeze.create(frost);
    }

    // [sg] const end_time = moment().tz(tz).format();
    const end_time = TimeUtils.isoFormattedDate(now_);
    st.snapshot.end_time = st.snapshot.end_time || end_time;
    st.snapshot.unfrozen_by = User.getId(req.user);
    st.inprogress = false;
    st.entered = true;
    // clear this
    const variance = cycleSum - endTotal;
    const costAdjust = CostCode.parseValue(variance, currency);
    st.variance = costAdjust;

    // [sg] @todo replace with TimeUtils duration between two dates function.
    const snapshotEndMs = new Date(st.snapshot.end_time).valueOf();
    const snapshotStartMs = new Date(st.snapshot.start_time).valueOf();
    st.snapshot.total_time = snapshotEndMs - snapshotStartMs;
    /** [sg]
    st.snapshot.total_time = moment
      .duration(
        new Date(st.snapshot.end_time) - new Date(st.snapshot.start_time)
      )
      .asMilliseconds();
    */
    await StockTake.saveAsync(st);
    // here we should sum the variance
    res.send(st);
  },

  start: async function(req, res) {
    if (!User.is(req.user, Roles.RECORDER)) {
      return res.forbidden({ error: 'warning.ROLE_NO_PERMITTED' });
    }

    const params = req.params.all();

    if (!params.id) {
      return res.badRequest({ error: 'warnings.STOCKTAKE_ID_REQUIRED' });
    }

    const st = await StockTake.findOneById(params.id)
      .populate('schemas')
      .populate('station');
    // unit_cost
    if (!st) {
      return res.badRequest({ error: 'warnings.STOCKTAKE_NOT_FOUND' });
    }

    if (!st.active || st.stale) {
      return res.badRequest({ error: 'warnings.STOCKTAKE_NOT_ACTIVE' });
    }

    const schemas = st.schemas; // NodeSchema.getId(st.schema);
    const station = NodeSchema.getId(st.station);
    const stationType = StationSchema.findOneById(
      StationSchema.getId(st.station.station_type)
    );
    const site = await Site.thisSiteAsync(stationType.domain);
    const currency = site.currency || Const.DEFAULT_CURRENCY;
    const helpers = Module._helpers.logistics();

    for (let i = 0; i < _.size(schemas); i++) {
      const _schema = schemas[i];
      const logParams = helpers.logParams(_schema.schema);
      const qParam = logParams('quantity');
      if (!qParam) {
        return res.serverError({
          error: 'errors.CONTAINS_INVALID_INVENTORY_NODE_ITEMS'
        });
      }
      const skuParam = logParams('sku');
      const unitCost = logParams('unit_cost');
      const serviceItem = logParams('service_item');
      const schema = NodeSchema.getId(_schema);
      const q = {
        where: {
          station: station,
          [qParam]: { '>=': 0 }
        }
      };

      if (serviceItem) {
        q.where.or = [{ [serviceItem]: false }, { [serviceItem]: null }];
      }

      let nodes;
      try {
        nodes = await Node.findNodes(q, _schema);
      } catch (e) {
        console.error(e);
        return res.serverError({ error: e.message });
      }

      const skuCache = [];

      const frost = [];
      const freezeObj = {
        schema: schema,
        stocktake: StockTake.getId(st),
        // total: 0,
        stage: 'start',
        frozen_by: User.getId(req.user),
        currency: currency
        // freezer: {}
      };

      for (let j = 0; j < _.size(nodes); j++) {
        const node = nodes[j];
        const quantity = node[qParam];
        const itemCost = node[unitCost] || 0;
        const cost = CostCode.convertCurrency(itemCost, currency);
        const unitTotal = cost * quantity;
        // freezeObj.total += unitTotal;
        const sku = node[skuParam];
        skuCache.push({
          sku: sku,
          schema: schema,
          node: node.id,
          name: logParams('name'),
          sum: quantity
        });
        const ice = {
          node: node.id,
          sku: sku,
          quantity: quantity,
          unit: cost,
          total: unitTotal
        };
        frost.push(_.merge(ice, _.clone(freezeObj)));
      }

      const freezer = await StockFreeze.create(frost);
      // [sg]const start_time = moment().tz(tz).format();
      const start_time = TimeUtils.isoFormattedDate(now_);
      const snapshot = st.snapshot || {
        start_time: start_time
      };
      snapshot[_schema.id] = {
        freezer_count: _.size(freezer),
        freezer_cache: skuCache
      };
      st.snapshot = snapshot;
    }

    st.stale = true;
    st.inprogress = true;
    await StockTake.saveAsync(st);
    res.send(st);
  },

  reduced: async function(req, res) {
    if (!User.is(req.user, Roles.RECORDER)) {
      return res.forbidden({ error: 'warning.ROLE_NO_PERMITTED' });
    }

    const params = req.params.all();
    if (!params.id) {
      return res.badRequest({ error: 'warnings.STOCKTAKE_ID_REQUIRED' });
    }

    const st = await StockTake.findOneById(params.id).populate('schemas');

    if (!st) {
      return res.badRequest({ error: 'warnings.STOCKTAKE_NOT_FOUND' });
    }

    if (!params.sku) {
      return res.badRequest({ error: 'warnings.SKU_PARAM_NOT_FOUND' });
    }
    const schemas = st.schemas;
    const station = Station.getId(st.station);
    const helpers = Module._helpers.logistics();
    const available = [];
    for (let i = 0; i < _.size(schemas); i++) {
      const schema = schemas[i];
      // const _schema = NodeSchema.getId(schema);
      const logParams = helpers.logParams(schema.schema);
      const qParam = logParams('quantity');
      const serviceItem = logParams('service_item');
      const knexRef = sails.models.knex;
      const model = SqlUtils.knex(knexRef).withSchema(schema);
      const queryString = `"${logParams('sku')}", "${logParams(
        'name'
      )}", "schema", SUM("${qParam}")::integer as "sum"`;
      model.select(knexRef.raw(queryString));
      // AND "station" = %s we need to find this regardless of station
      let services = '';
      if (serviceItem) {
        services = escape(
          `AND ("%s" IS NULL OR "%s" = false)`,
          serviceItem,
          serviceItem
        );
      }

      model.whereRaw(
        knexRef.raw(
          escape(
            `"%s" = %L AND "station" = %s %s`,
            logParams('sku'),
            params.sku,
            station,
            services
          )
        )
      );
      // knex.debug();
      const sqlResult = await model.groupByRaw('1,2,3');
      if (_.size(sqlResult)) {
        available.push(...sqlResult);
      }
    }
    res.send(available);
  },

  pull: async function(req, res) {
    if (!User.is(req.user, Roles.RECORDER)) {
      return res.forbidden({ error: 'warning.ROLE_NO_PERMITTED' });
    }

    const params = req.params.all();

    if (!params.id) {
      return res.badRequest({ error: 'warnings.STOCKTAKE_ID_REQUIRED' });
    }

    const st = await StockTake.findOneById(params.id).populateAll();

    if (!st) {
      return res.badRequest({ error: 'warnings.STOCKTAKE_NOT_FOUND' });
    }

    if (!st.active) {
      return res.badRequest({ error: 'warnings.STOCKTAKE_NOT_ACTIVE' });
    }

    if (!_.size(st.snapshot)) {
      return res.send(st);
    }

    const helpers = Module._helpers.logistics();
    const station = Station.getId(st.station);
    const results = [];
    for (let i = 0; i < _.size(st.schemas); i++) {
      const schema = st.schemas[i];
      const logParams = helpers.logParams(schema.schema);
      const qParam = logParams('quantity');
      const serviceItem = logParams('service_item');
      const knexRef = sails.models.knex;
      const model = SqlUtils.knex(knexRef).withSchema(schema);
      // const allLParams = logParams();
      let services = '';
      if (serviceItem) {
        // [sg] ?? coalesce("%s", false) = false ??
        services = escape(
          `AND ("%s" IS NULL OR "%s" = false)`,
          serviceItem,
          serviceItem
        );
      }

      const queryString = `
        "${logParams('sku')}",
        "${logParams('name')}",
        SUM("${qParam}")::integer as "sum"
      `;

      model.select(knexRef.raw(queryString));
      model.whereRaw(
        knexRef.raw(
          escape(`"%s" > 0 AND "station" = %s %s`, qParam, station, services)
        )
      );
      // knexRef.debug();
      const sqlResult = await model.groupByRaw('1,2');
      results.push(...sqlResult);
    }

    st.snapshot.freezer_cache = results;
    res.send(st);
  }
};
