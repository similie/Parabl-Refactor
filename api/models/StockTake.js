/**
 * StockTake.js
 *
 * @description :: A model definition.  Represents a database table/collection/etc.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */
const { TimeUtils, SqlUtils } = require('similie-api-services');
const TimePeriod = TimeUtils.constants.ENUMS.timePeriods;
const tz = TimeUtils.constants.timeZone;
const now_ = TimeUtils.constants.now_;

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    schema: {
      model: 'nodeschema'
      // required: true
    },
    schemas: {
      collection: 'nodeschema',
      required: true
    },
    station: {
      model: 'station',
      required: true
    },

    owner: {
      model: 'user'
    },

    variance: {
      type: 'float'
    },

    accountable_variance: {
      type: 'integer'
    },

    approved_by: {
      model: 'user'
    },

    scheduled_by: {
      model: 'user'
    },

    start_date: {
      type: 'datetime'
    },

    end_date: {
      type: 'datetime'
    },

    snapshot: {
      type: 'json'
    },

    active: {
      type: 'boolean',
      defaultsTo: false
    },

    inprogress: {
      type: 'boolean',
      defaultsTo: false
    },

    entered: {
      type: 'boolean',
      defaultsTo: false
    },

    counted: {
      type: 'boolean',
      defaultsTo: false
    },

    reconciled: {
      type: 'boolean',
      defaultsTo: false
    },

    stale: {
      type: 'boolean',
      defaultsTo: false
    },

    expired: {
      type: 'boolean',
      defaultsTo: false
    },

    scannable_id: {
      type: 'string'
    },

    contributors: {
      collection: 'user'
    },

    regional_build: {
      type: 'boolean'
    },

    meta: {
      type: 'json'
    }
  },

  findLastStockTake: async function(st = {}) {
    const _station = this.getId(st.station);
    const lastSt = await this.find()
      .where({
        station: _station,
        reconciled: true,
        id: { '!': this.getId(st) }
      })
      .limit(1)
      .sort({ createdAt: 'DESC' });
    return lastSt.pop();
  },

  searchAndApplyVariances: async function(st = {}) {
    const endDate = st.snapshot.start_time;
    if (!endDate) {
      return;
    }

    const lastStockTake = await this.findLastStockTake(st);
    if (!lastStockTake) {
      return;
    }
    const lastEndDate = lastStockTake.snapshot.end_time;
    if (!lastEndDate) {
      return;
    }

    const variants = await PurchaseOrder.findVariantPurchaseOrdersBetween(
      st.station,
      lastEndDate,
      endDate,
      true
    );
    st.accountable_variance = variants.total || 0;
    st.meta = st.meta || {};
    st.meta.variant_items = variants.items;
  },

  applyItemToFreezer: function(st = {}, item = {}, schema = {}) {
    const helpers = Module._helpers.logistics();
    const logParams = helpers.logParams(schema.schema);
    const schemaId = NodeSchema.getId(schema);
    const sku = item[logParams('sku')];
    const skuCache = [
      {
        sku: sku,
        schema: schemaId,
        node: item.id,
        name: logParams('name'),
        nameDetails: item[logParams('name')],
        sum: item.quantity
      }
    ];
    st.snapshot[schemaId] = st.snapshot[schemaId] || {};
    st.snapshot[schemaId].freezer_count =
      st.snapshot[schemaId].freezer_count || 0;
    st.snapshot[schemaId].freezer_cache =
      st.snapshot[schemaId].freezer_cache || [];
    st.snapshot[schemaId].freezer_count++;
    st.snapshot[schemaId].freezer_cache.push(...skuCache);
  },

  getInventoryClone: async function(req) {
    const params = req.params.all();
    if (!params.id) {
      throw new Error('Stocktake ID required');
    }

    if (!params.sku) {
      throw new Error('A SKU is required for cloning');
    }

    const st = await this.findOneById(params.id).populate('schemas');

    if (!st) {
      throw new Error('Stocktake not found');
    }

    const schemas = st.schemas;
    const helpers = Module._helpers.logistics();
    const clones = [];
    for (let i = 0; i < schemas.length; i++) {
      const schema = schemas[i];
      const parent = await helpers.getItemParent(params.sku, schema);
      if (!parent) {
        continue;
      }
      const station = Station.getId(st.station);
      const clone = helpers.cloneInventory(parent, schema);
      clone.station = station;
      try {
        const created = await Node.updateOrCreate()({
          params: clone,
          schema: schema
        });
        clones.push(created);
        this.applyItemToFreezer(st, created, schema);
        await StockTake.saveAsync(st);
      } catch (e) {
        sails.log.error(e);
        continue;
      }
    }

    return {
      clones: clones,
      snapshot: st.snapshot
    };
  },

  getVarianceQuery: function() {
    const variance_query = `SELECT * FROM
    (
    SELECT
    sc."stocktake" as "stocktake",
    st."station" as "station",
    SUM( sc."count" ) :: INTEGER AS "count",
    ROUND((SUM( sc."count" ) * freezer.unit )::NUMERIC, 2) AS total,
    sc."item",
    sc."sku",
    sc."item_name",
    sc."schema",
    COALESCE(freezer.unit, 0) as "unit_cost",
    COALESCE(freezer.quantity, 0) as "start_quantity",
    COALESCE(defrost.quantity, 0) as "end_quantity",
    (COALESCE(SUM( sc."count" ) :: INTEGER, 0) - (COALESCE(freezer.quantity, 0) - (COALESCE(freezer.quantity, 0) - COALESCE(defrost.quantity, 0))) ) as "delta",
    (COALESCE(freezer.unit, 0) *  ABS((COALESCE(SUM( sc."count" ) :: INTEGER, 0) - (COALESCE(freezer.quantity, 0) - (COALESCE(freezer.quantity, 0) - COALESCE(defrost.quantity, 0))) )))::numeric as delta_cost,
    COALESCE(freezer."currency", 'USD' )  as "currency",
    COALESCE(sv.confirmed, FALSE) as "confirmed",
    sv."explanation"
    FROM
    "stockcount" sc
    JOIN stocktake st ON (sc."stocktake" = st.id)
    LEFT JOIN stockfreeze freezer ON (freezer.stocktake = sc."stocktake" AND freezer.stage = 'start' AND freezer.sku = sc.sku AND freezer."schema" = sc."schema")
    LEFT JOIN stockfreeze defrost ON (defrost.stocktake = sc."stocktake" AND defrost.stage = 'end' AND defrost.sku = sc.sku AND defrost."schema" = sc."schema")
    LEFT JOIN stockvarianceconfirm sv ON (sc.stocktake = sv."stocktake" AND sc.sku = sv.sku AND sv."schema" = sc."schema")

    WHERE sc."stocktake" = %s %s

    GROUP BY
    sc."stocktake",
    st."station",
    sc."item",
    sc."sku",
    sc."item_name",
    sc."schema",
    freezer."quantity",
    defrost."quantity",
    freezer."unit",
    freezer."currency",
    sv."confirmed",
    sv."explanation"
    ) c

    WHERE c."delta" <> 0
    %s
    ORDER BY c."sku" ASC`;
    return variance_query;
  },

  sumQuery: function(st, sku, schema) {
    const escape = SqlUtils.escapeUtil();
    let q = escape(
      `SELECT sum("count")::integer as "count", SUM("total") as total, "item", "sku", "item_name", "schema" FROM "stockcount" where "stocktake" = %s group by "item", "sku", "item_name", "schema" ORDER BY "sku" ASC;`,
      StockTake.getId(st)
    );
    if (sku) {
      q = escape(
        `SELECT sum("count")::integer as "count", SUM("total") as total, "item", "sku", "item_name", "schema" FROM "stockcount" where "stocktake" = %s AND "sku" = %L AND "schema" = %s group by "item", "sku", "item_name", "schema";`,
        StockTake.getId(st),
        sku,
        schema
      );
    }
    return q;
  },

  varianceQuery: function(st, sku, extras) {
    const escape = SqlUtils.escapeUtil();
    extras = extras || '';
    let q;
    if (sku) {
      q = escape(
        `${this.getVarianceQuery()}`,
        StockTake.getId(st),
        `AND "sku" = '${sku}'`,
        extras
      );
    } else {
      q = escape(`${this.getVarianceQuery()}`, StockTake.getId(st), '', extras);
    }

    return q;
  },

  harmonize: async function(stationId) {
    Utils.itsRequired(stationId)(Utils.setErrorCode(Const.code.BAD_REQUEST));
    const station = await Station.findOneById(stationId);
    Utils.itsRequired(station)(Utils.setErrorCode(Const.code.BAD_REQUEST));
    const stationType = await StationSchema.findOneById(
      StationSchema.getId(station.station_type)
    ).populate('nodes');
    // we find pos transactions
    const inventory = _.where(stationType.nodes, {
      is_inventory: true
    });
    const schemas = {};
    _.each(inventory, s => {
      const sId = NodeSchema.getId(s);
      schemas[sId] = { schema: s, nodes: {} };
    });

    const invCache = {
      out: {},
      in: {}
    };
    const helpers = Module._helpers.logistics();
    const buildAttributes = [
      { cache: 'out', param: 'quantity_outgoing' },
      { cache: 'in', param: 'quantity_incoming' }
    ];
    // shotcut array iterators
    const sizeInventory = _.size(inventory);
    let sizeBuildAttributes = _.size(buildAttributes);
    for (let i = 0; i < sizeInventory; i++) {
      const inv = inventory[i];
      for (let j = 0; j < sizeBuildAttributes; j++) {
        const build = buildAttributes[j];
        const logParams = helpers.logParams(inv.schema);
        invCache[build.cache][Station.getId(inv)] =
          invCache[build.cache][Station.getId(inv)] || {};
        const nodes = await Node.findNodes(
          {
            where: {
              __available__: true,
              station: stationId,
              [logParams(build.param)]: { '!': 0 }
            }
          },
          inv
        );
        const sId = NodeSchema.getId(inv);
        const sizeNodes = _.size(nodes);
        for (let k = 0; k < sizeNodes; k++) {
          const node = nodes[k];
          schemas[sId].nodes[Model.getId(node)] = node;
          invCache[build.cache][Station.getId(inv)][Model.getId(node)] =
            node[logParams(build.param)];
        }
      }
    }

    const reconciledCache = {
      out: {},
      in: {}
    };

    const verifyAttributes = [
      { cache: 'out', param: 'from' },
      { cache: 'in', param: 'to' }
    ];

    const states = PurchaseOrder.states();
    const sizeVerifyAttrs = _.size(verifyAttributes);
    for (let i = 0; i < sizeVerifyAttrs; i++) {
      const verify = verifyAttributes[i];
      const po_s = await PurchaseOrder.find().where({
        [verify.param]: station.station_id, // out
        locked: false,
        or: [
          { state: states.APPROVED },
          { state: states.PROCESSING },
          { state: states.SHIPPED },
          { state: states.RECEIVED }
        ]
      });
      const sizePo_s = _.size(po_s);
      for (let j = 0; j < sizePo_s; j++) {
        const po = po_s[j];
        const sizePoItems = _.size(po.items);
        for (let k = 0; k < sizePoItems; k++) {
          const _item = po.items[k];
          const sId = _item.schema;
          const schema =
            schemas[sId].schema || (await NodeSchema.findOneById(sId));

          const logParams = helpers.logParams(schema.schema);
          let item;
          if (verify.cache === 'in') {
            const node = await Node.findOneById(_item.id, schema);
            if (node.station !== stationId) {
              const nodes = await Node.findNodes(
                {
                  where: {
                    station: stationId,
                    __available__: true,

                    [logParams('sku')]: _item.sku
                  }
                },
                schema
              );

              const sizeNodes = _.size(nodes);
              for (let l = 0; l < sizeNodes; l++) {
                const n = nodes[l];
                if (
                  po.scope === 'internal' &&
                  (!n || (n && n.id === node.id))
                  // ((n.copy_of && n.copy_of !== copy_of) ||
                  //   (n.copy_of === copy_of && copy_of) ||
                  //   (!n.copy_of && n.id !== copy_of))
                ) {
                  continue;
                }
                item = n;
              }

              if (!item) {
                continue;
              }

              schemas[sId].schema = schema;
              schemas[sId].nodes = schemas[sId].nodes || {};
              schemas[sId].nodes[item.id] = item;
            } else {
              item = node;
            }
          } else {
            item = _item;
          }

          reconciledCache[verify.cache][item.schema] =
            reconciledCache[verify.cache][item.schema] || {};
          reconciledCache[verify.cache][item.schema][item.id] =
            reconciledCache[verify.cache][item.schema][item.id] || 0;
          reconciledCache[verify.cache][item.schema][item.id] += _item.quantity;
        }
      }
    }

    const pos = await PointOfSale.find({
      complete: false,
      waiting: false,
      station: stationId
    }).populate('transactions');

    const sizePos = _.size(pos);
    let sizePosTransactions = 0;
    for (let i = 0; i < sizePos; i++) {
      const _pos = pos[i];
      sizePosTransactions = _.size(_pos.transactions);
      for (let j = 0; j < sizePosTransactions; j++) {
        const trans = _pos.transactions[j];
        reconciledCache.out[trans.schema] =
          reconciledCache.out[trans.schema] || {};
        reconciledCache.out[trans.schema][trans.node] =
          reconciledCache.out[trans.schema][trans.node] || 0;
        reconciledCache.out[trans.schema][trans.node] += trans.quantity;
      }
    }

    for (const direction in invCache) {
      for (const schema in invCache[direction]) {
        for (const node in invCache[direction][schema]) {
          reconciledCache[direction][schema] =
            reconciledCache[direction][schema] || {};
          if (!reconciledCache[direction][schema][node]) {
            reconciledCache[direction][schema][node] = 0;
          }
        }
      }
    }

    sizeBuildAttributes = _.size(buildAttributes); // already declared.
    for (let i = 0; i < sizeBuildAttributes; i++) {
      const build = buildAttributes[i];
      const cache = reconciledCache[build.cache];

      for (const schema in cache) {
        const inv = schemas[schema].schema;
        const logParams = helpers.logParams(inv.schema);
        for (const node in cache[schema]) {
          let _node = schemas[schema].nodes[node];
          const quantity = cache[schema][node];
          if (!_node) {
            _node = await Node.findOneById(node, inv);
            if (!_node) {
              continue;
            }
          }
          const nQuanity = _node[logParams(build.param)];
          const delta = nQuanity - quantity;
          if (delta !== 0 && _node && quantity >= 0) {
            _node[logParams(build.param)] = quantity;
            await Node.updateOrCreate()({
              params: _node,
              schema: inv
            });
          }
        }
      }
    }

    return {
      reconciled: reconciledCache,
      inventory: invCache
    };
  },

  regionalBuild: async function(stocktake = {}) {
    if (!stocktake.regional_build) {
      return;
    }

    const _station = await Station.getId(stocktake.station);
    const station = await Station.findOneById(_station);
    const children = await Station.children(station.station_id);
    const schemas = _.pluck(stocktake.schemas, 'id');
    const startDate = stocktake.start_date;
    const endDate = stocktake.end_date;

    _.remove(children, c => c.station_id === station.station_id);

    const sizeChildren = _.size(children);
    for (let i = 0; i < sizeChildren; i++) {
      const child = children[i];

      const station = Station.getId(child);
      const avialableSchemas = [];
      for (let j = 0; j < _.size(schemas); j++) {
        const schema = schemas[j];
        if (await Station.hasNodeSchema(station, schema)) {
          avialableSchemas.push(schema);
        }
      }
      if (!_.size(avialableSchemas)) {
        continue;
      }

      const stock = {
        schemas: _.clone(avialableSchemas),
        station: Station.getId(station),
        active: false,
        start_date: startDate,
        end_date: endDate
        // this would cause it to casade to all their
        // children too. This may have considerable consequences
        // regional_build: true
      };
      await StockTake.create(stock);
    }
  },

  setActive: async function(inactive) {
    const station = Station.getId(inactive.station);
    const other_active = await StockTake.find({
      station: station,
      // schema: schema,
      stale: false,
      active: true
    });

    const sizeOtherActive = _.size(other_active);
    for (let k = 0; k < sizeOtherActive; k++) {
      const oa = other_active[k];
      oa.stale = true;
      oa.active = false;
      // sails.log.debug(`Setting StockTake with id ${oa.id} to inactive`);
      await StockTake.saveAsync(oa);
    }
    // inactive.instantiate = true;
    inactive.active = true;
    // delete inactive.station_state;
    try {
      await StockTake.saveAsync(new StockTake._model(inactive));
    } catch (e) {
      sails.log.error(e);
    }
    // inactive.initiate_email_verb = true;
    sails.sockets.blast(`stock-take-instatiation-${station}`, inactive);
  },

  stockTakeTimer: async function() {
    // let minutes = 3;
    // let milisecDelay = minutes * 60 * 1000;
    // let current = moment().tz(tz);
    // let now = current.subtract(minutes, "minutes");
    let query = `SET timezone='${tz}';SELECT * from "stocktake" WHERE active = false AND stale = false AND ("start_date")::TIMESTAMP <= (now())::TIMESTAMP AND ("end_date")::TIMESTAMP > (now())::TIMESTAMP`;
    let found = await Model.queryAsync(query);
    const inactivePools = found.rows;
    const limitInactivePools = _.size(inactivePools);
    for (let i = 0; i < limitInactivePools; i++) {
      const inactive = inactivePools[i];
      await StockTake.setActive(inactive);
    }

    query = `SET timezone='${tz}';SELECT * from "stocktake" WHERE active = true AND expired = false AND ("end_date")::TIMESTAMP <= (now())::TIMESTAMP `;
    found = await Model.queryAsync(query);
    const expirationPools = found.rows;
    const limitExpirationPools = _.size(expirationPools);
    for (let i = 0; i < limitExpirationPools; i++) {
      const active = expirationPools[i];
      if (validateStaleActiveStocktake(active)) {
        const station = Station.getId(active.station);
        active.active = false;
        active.expired = true;
        try {
          await StockTake.saveAsync(new StockTake._model(active));
          sails.sockets.blast(`stock-take-expiration-${station}`, active);
        } catch (e) {
          sails.log.error(e);
        }
      }
    }
  },

  inventoryCleaner: async function(st) {
    return await StockTake.harmonize(Station.getId(st.station));
  },

  _processors: [
    {
      name: 'inventoryCleanup',
      process: async function(job) {
        return await StockTake.inventoryCleaner(job.data);
      },

      stats: Utils.stats({
        completed: function() {
          // sails.log.debug('All Surveys managed');
        },
        failed: function(job, err) {
          console.error('JOB inventoryCleanup ERROR::', err);
          // Utils.sendexcelMessage(err, job.data);
        },
        stalled: function(job) {
          sails.log.debug('JOB inventoryCleanup ERROR::', job);
        }
      })
    },

    {
      name: 'stockInstantiator',
      process: async function() {
        return await StockTake.stockTakeTimer();
      },

      stats: Utils.stats({
        completed: function() {
          // sails.log.debug('All Surveys managed');
        },
        failed: function(job, err) {
          console.error('JOB stockInstantiator ERROR::', err);
          // Utils.sendexcelMessage(err, job.data);
        },
        stalled: function(job) {
          sails.log.debug('JOB stockInstantiator ERROR::', job);
        }
      })
    }
  ],

  _timers: [
    {
      interval: 'minute',
      name: 'stock_take_initiator',
      action: function() {
        return {
          do: function() {
            // add a delay of 4 moniutes
            // for midnight to work
            Jobs.stockInstantiator.add();
          }
        };
      }
    }
  ],

  // beforeUpdate: async function(values, next) {
  //   next();
  // },

  beforeCreate: async function(values, next) {
    const station = Station.getId(values.station);
    const schema = NodeSchema.getId(values.schema);
    const currentDate = TimeUtils.isoFormattedDate('');

    const active = await StockTake.find({
      where: {
        or: [{ active: true }, { start_date: { '>=': currentDate } }],
        stale: false,
        station: station,
        schema: schema
      }
    });

    if (_.size(active)) {
      return next('You cannot generate another active stocktake');
    }

    values.scannable_id = Node.createToken();
    next();
  },

  afterCreate: async function(values, next) {
    const st = await StockTake.findOneById(StockTake.getId(values)).populate(
      'schemas'
    );

    await this.regionalBuild(st);
    next();
  }
};

function validateStaleActiveStocktake(st) {
  // we give 1 day of no action before we expire the stocktake
  const expiry = TimeUtils.date(now_).minus(1, TimePeriod.minutes);
  const expired = TimeUtils.date(st.updatedAt).isBefore(expiry);
  const hasSomeActivity = hasActivity(st);
  return expired || !hasSomeActivity;
}

function hasActivity(st) {
  return st.inprogress || st.entered || st.counted || st.reconciled;
}
