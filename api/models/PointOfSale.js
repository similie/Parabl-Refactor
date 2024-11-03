/**
 * PointOfSale.js
 *
 * @description :: A model definition.  Represents a database table/collection/etc.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */
// @TODO: Refactor to CommonUtils in similie-api-services module
const Utils = require('../services/Utils');

const { TimeUtils, SqlUtils, CommonUtils } = require('similie-api-services');
const tz = TimeUtils.constants.timeZone;
const now_ = TimeUtils.constants.now_;
const TimePeriod = TimeUtils.constants.ENUMS.timePeriods;
const PosController = require('../controllers/PointOfSaleController');
const SailsExtensions = require('../services/SailsExtensions');

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    transaction_id: {
      type: 'string',
      maxLength: 20
      //  required: true
    },

    schema: {
      model: 'nodeschema'
    },

    station: {
      model: 'station'
    },

    client: {
      model: 'user'
    },

    client_type: {
      type: 'string'
    },

    transactions: {
      collection: 'postransaction',
      through: 'pos_tran'
    },

    total_cost: {
      type: 'float',
      defaultsTo: 0
    },

    total_retail_cost: {
      type: 'float',
      defaultsTo: 0
    },

    sales_tax: {
      type: 'float',
      defaultsTo: 0
    },

    final_cost: {
      type: 'float',
      defaultsTo: 0
    },

    pending_approval: {
      type: 'boolean',
      defaultsTo: false
    },

    approved: {
      type: 'boolean',
      defaultsTo: false
    },

    approved_by: {
      model: 'user'
    },

    complete: {
      type: 'boolean',
      defaultsTo: false
    },

    waiting: {
      type: 'boolean',
      defaultsTo: false
    },

    return_block: {
      type: 'boolean',
      defaultsTo: false
    },

    parent: {
      model: 'pointofsale'
    },

    available: {
      type: 'boolean',
      defaultsTo: true
    },

    dependents: {
      collection: 'pointofsale',
      through: 'pos_dep',
      via: 'dependent'
    },

    has_price_overrides: {
      type: 'boolean',
      defaultsTo: false
    },

    in_focus: {
      type: 'boolean',
      defaultsTo: false
    },

    price_overrides: {
      type: 'json'
    },

    completed_on: {
      type: 'datetime'
    },

    tender: {
      type: 'array'
    },

    tax_rate: {
      type: 'float'
    },

    currency_multiplier: {
      type: 'integer',
      min: 0
    },

    owner: {
      model: 'user'
    },

    meta: {
      type: 'json'
    },

    files: {
      collection: 'sysfile'
    },

    workorder: {
      model: 'workorder'
    },

    getSettings: async function() {
      const pos = this.toObject();
      if (_.isObject(pos.station)) {
        return ((pos.station || {}).settings || {}).pos || {};
      }
      const station = await Station.findOneById(Station.getId(pos.station));
      return (station.settings || {}).pos || {};
    }
  },

  getSerializableSerialsFromSchema: function(schema) {
    const serials = _.where(schema.schema, {
      type: 'node',
      serializable: true
    });
    return serials;
  },

  pullSerialItemsForProducts: function(node, schema) {
    const serials = this.getSerializableSerialsFromSchema(schema);
    if (!_.size(serials)) {
      return null;
    }

    let _ser;
    _.each(serials, s => {
      if ((node[s.name] || {}).count) {
        _ser = _ser || {};
        _ser[s.name] = {
          count: (node[s.name] || {}).count || 0,
          unique: s.unique_identity
        };
      }
    });
    return _ser;
  },

  convertNodeItemsToProducts: async function(nodes, schema, siteData) {
    const helpers = Module._helpers.logistics();
    const logParams = helpers.logParams(schema.schema);
    const send = [];
    for (let i = 0; i < _.size(nodes); i++) {
      const n = nodes[i];
      const _res = {
        id: n.id,
        sku: n[logParams('sku')],
        description: n[logParams('name')],
        retail_cost: n[logParams('retail_cost')],
        src: await Utils.getFirstImage(n.files, siteData),
        quantity: n[logParams('quantity')],
        service_item: n[logParams('service_item')],
        schema: n.schema
      };
      const serials = this.pullSerialItemsForProducts(n, schema);
      if (_.size(serials)) {
        _res.serialized = serials;
      }
      send.push(_res);
    }

    return send;
  },

  getSearchForQuery: function(search, schema) {
    const escape = SqlUtils.escapeUtil();
    const helpers = Module._helpers.logistics();
    const logParams = helpers.logParams(schema.schema);
    return escape(
      ` AND ("${logParams('name')}" ILIKE '%%%s%%' OR "${logParams(
        'sku'
      )}" ILIKE '%%%s%%' )`,
      search,
      search
    );
  },

  getCountsByQuery: async function(query, schema) {
    const result = await Node.countNodes(query, schema);
    const total = result.pop() || { count: 0 };
    return parseInt(total.count);
  },

  getAllItemForSchemaCount: async function(schema, req) {
    const params = SailsExtensions.params(req);
    const table = SqlUtils.knex().tableNameForQuery(schema);
    const escape = SqlUtils.escapeUtil();
    let query = escape(
      `SELECT COUNT("id")::INTEGER as "count" FROM %s WHERE
      ${
        params.station
          ? escape('station = %s', params.station)
          : '"copy_of" IS NULL'
      }`,
      table
    );

    if (params.search) {
      query += this.getSearchForQuery(params.search, schema);
    }
    const results = await Model.queryAsync(query);
    const rows = results.rows;
    const value = rows.pop() || {};
    return value.count || 0;
  },

  getAllItemForSchema: async function(schema, req) {
    const params = SailsExtensions.params(req);
    const limit = SailsExtensions.limit(req);
    const skip = SailsExtensions.skip(req);
    const sort = SailsExtensions.sort(req);
    const escape = SqlUtils.escapeUtil();

    if (schema.derivative_statement === '__APPLICATION_ENTITY__') {
      return [];
    }

    const helpers = Module._helpers.logistics();
    const logParams = helpers.logParams(schema.schema);
    const table = SqlUtils.knex().tableNameForQuery(schema);

    let query = escape(
      `SELECT
    "n".*,
    "g"."total_quantity"
  FROM
    %s "n"
    LEFT JOIN ( SELECT SUM ( "%s" ) AS "total_quantity", "id" FROM %s GROUP BY 2 ) "g" ON ( "n"."id" = "g"."id" ) 
  WHERE
     ${
       params.station
         ? escape('station = %s', params.station)
         : '"copy_of" IS NULL'
     }`,
      table,
      logParams('quantity'),
      table
    );

    if (params.search) {
      query += this.getSearchForQuery(params.search, schema);
    }

    if (sort) {
      query += ` ${SqlUtils.buildSort(sort)}`;
    } else if (logParams('name')) {
      query += ` ${SqlUtils.buildSort({ [logParams('name')]: 'ASC' })}`;
    }

    if (limit) {
      query += ` LIMIT ${limit}`;
    }

    if (skip) {
      query += ` OFFSET ${skip};`;
    }
    const results = await Model.queryAsync(query);
    return results.rows;
  },

  getSumQuery: function() {
    return `SELECT
    ROUND( SUM ( "total_cost" ) :: NUMERIC, 2 ) AS "total_cost",
    ROUND( SUM ( "total_retail_cost" ) :: NUMERIC, 2 ) AS "total_retail_cost",
    ROUND(( SUM ( "total_retail_cost" ) * %s ) :: NUMERIC, 2 ) AS "sales_tax",
    ROUND( (( SUM ( "total_retail_cost" ) * %s ) + SUM ( "total_retail_cost" )) :: NUMERIC, 2 ) AS "final_cost"
  FROM
    "postransaction"
  WHERE
    "pointofsale" = %s`;
  },

  getNodeSchemaSettingsThroughReq: async function(req) {
    const params = req.params.all();
    const ns = await NodeSchema.findOneById(params.schema);
    const settings = ns.applications;
    return settings;
  },

  transactionCosts: async function(pos, settings) {
    const sales_tax = ((settings || {}).tax_rate || 0) / 100;
    const escape = SqlUtils.escapeUtil();
    const query = escape(
      this.getSumQuery(),
      sales_tax,
      sales_tax,
      PointOfSale.getId(pos)
    );
    const costs = await Model.queryAsync(query);
    return costs.rows.pop();
  },

  applyTransactionCosts: async function(pos, application, settings) {
    const costs = await this.transactionCosts(pos, settings);
    _.extend(application, costs);
  },

  resetSession: function(req) {
    const params = req.params.all();
    req.session.posTransaction = {};
    req.session.posTransaction[params.station] =
      req.session.posTransaction[params.station] || {};
  },

  checkForwardUserChange: async function(pos, params) {
    let changePos = false;
    if (pos && !_.isUndefined(params.client)) {
      pos.client = params.client;
      changePos = true;
    }

    if (pos && !_.isUndefined(params.client_type)) {
      pos.client_type = params.client_type;
      changePos = true;
    }

    if (changePos) {
      await PointOfSale.saveAsync(pos);
    }

    if (!params.scan) {
      return false;
    }
    return true;
  },

  posThroughReq: async function(req) {
    const params = req.params.all();
    let pos;
    if (params.id) {
      pos = await PointOfSale.findOneById(+params.id);
    } else {
      pos = await PointOfSale.create({
        station: parseInt(params.station),
        schema: parseInt(params.schema),
        owner: User.getId(req.user),
        client: params.client,
        client_type: params.client_type,
        workorder: params.workorder ? +params.workorder : null
        // waiting: true
      });
    }

    return pos;
  },

  finializeTransactionalRemoval: async function(elements, settings, pos) {
    const transaction = elements.transaction;
    const node = elements.node;
    const schema = elements.schema;
    pos.transactions.remove(PosTransaction.getId(transaction));
    await PointOfSale.applyTransactionCosts(pos, pos, settings);
    await PointOfSale.saveAsync(pos);
    await Node.updateOrCreate()({
      params: node,
      schema: schema
    });
    Node.blast(node, schema, 'update');
  },

  increaseTransactionalNodeElements: async function(transaction, station) {
    const helpers = Module._helpers.logistics();
    const s = await NodeSchema.findOneById(transaction.schema);
    const logParams = helpers.logParams(s.schema);
    // we need to find this based on the station
    let node;

    const originalNode = await Node.findOneById(transaction.node, s);
    if (!originalNode[logParams('service_item')]) {
      if (station === transaction.station) {
        node = originalNode;
      } else {
        const nodes = await Node.findNodes(
          {
            where: {
              [logParams('sku')]: transaction.scan,
              station: station,
              __available__: true
            }
          },
          s
        );
        if (_.size(nodes)) {
          node = nodes.pop();
        } else {
          node = Node.clone(originalNode, s);
          node[logParams('quantity')] = 0;
          node[logParams('quantity_outgoing')] = 0;
          node[logParams('quantity_incoming')] = 0;
          node.station = station;
          // node.domain = Domain.getId(res.locals.domain);
        }
      }
      // node[logParams('quantity')] -= transaction.quantity;
      node[logParams('quantity_incoming')] += transaction.quantity;
      node = await Node.updateOrCreate()({
        params: node,
        schema: s
      });
    }

    return node;
  },

  reduceTransactionalNodeElements: async function(transaction) {
    const quantity = transaction.quantity || 0;
    const helpers = Module._helpers.logistics();
    const searchSchema = await NodeSchema.findOneById(transaction.schema);
    const logParams = helpers.logParams(searchSchema.schema);
    const node = await Node.findOneById(transaction.node, searchSchema);
    helpers.logParams(searchSchema.schema);
    const qParam = logParams('quantity');
    const outParam = logParams('quantity_outgoing');
    const inParam = logParams('quantity_incoming');
    const serviceParam = logParams('service_item');
    if (!node[serviceParam]) {
      if (quantity > 0) {
        node[qParam] += quantity;
        node[outParam] -= quantity;
      } else {
        node[inParam] -= Math.abs(quantity);
      }
    }
    return {
      transaction: transaction,
      quantity: quantity,
      schema: searchSchema,
      logParams: logParams,
      node: node
    };
  },

  getSearchSchema: async function(settings, params) {
    const searchField = [];
    const helpers = Module._helpers.logistics();
    let searchSchema;
    let nodes;
    _.each(settings.inventory, (i, id) => {
      if (i) {
        searchField.push(id);
      }
    });

    const schemas = await NodeSchema.find().where({ id: searchField });
    for (let i = 0; i < _.size(schemas); i++) {
      const schema = schemas[i];

      if (!schema) {
        continue;
      }
      const logParams = helpers.logParams(schema.schema);
      const skuParam = logParams('sku');
      const search = {
        where: {
          station: params.station,
          [skuParam]: params.scan
        }
      };
      nodes = await Node.findNodes(search, schema);
      if (!_.size(nodes)) {
        continue;
      }
      searchSchema = schema;
      break;
    }

    if (!searchSchema) {
      throw new Error('Search schema is undefined');
    }

    if (!_.size(nodes)) {
      throw new Error('Scanned item is unavailable');
    }

    return {
      schema: searchSchema,
      nodes: nodes
    };
  },

  buildTransaction: async function(elements, pos, params) {
    let transaction = elements.transaction;
    const logParams = elements.logParams;
    if (!transaction) {
      const serialItems = PosTransaction.transactionSerials(
        elements.serialItems,
        elements.node
      );

      const qParam = logParams('quantity');
      const descParam = logParams('name');
      const outParam = logParams('quantity_outgoing');
      const inParam = logParams('quantity_incoming');

      transaction = await PosTransaction.create({
        pointofsale: PointOfSale.getId(pos),
        scan: params.scan,
        station: Station.getId(pos.station),
        schema: NodeSchema.getId(NodeSchema.getId(elements.schema)),
        node: Model.getId(elements.node),
        description: elements.node[descParam],
        serials: serialItems,
        requires_serial: !!_.size(serialItems),
        requisition: params.requisition,
        workorder: params.workorder,
        quantity: 0,
        start_quantity: elements.node[qParam] || 0,
        out_quantity: elements.node[outParam] || 0,
        in_quantity: elements.node[inParam] || 0
      });
    }

    elements.transaction = transaction;
    return transaction;
  },

  finalizePosTransaction: async function(elements, settings, pos) {
    const transaction = elements.transaction;
    const node = elements.node;
    const schema = elements.schema;
    await PosTransaction.saveAsync(transaction);
    await Node.updateOrCreate()({
      params: node,
      schema: schema
    });

    pos.transactions.add(transaction.id);
    await PointOfSale.applyTransactionCosts(pos, pos, settings);
    await PointOfSale.saveAsync(pos);
    Node.blast(node, schema, 'update');
  },

  nodeQuantitySetup: function(elements) {
    const node = elements.node;
    const logParams = elements.logParams;
    const qParam = logParams('quantity');
    const outParam = logParams('quantity_outgoing');
    const inParam = logParams('quantity_incoming');
    node[qParam] = node[qParam] || 0;
    node[outParam] = node[outParam] || 0;
    node[inParam] = node[inParam] || 0;
  },

  setChainQuantity: function(pos, transaction) {
    const completeQuantity =
      ((pos.meta || {}).returns || {})[transaction.chain_code] || 0;
    transaction.quantity -= completeQuantity;
    return completeQuantity;
  },

  buildPosCloneForReturn: async function(pos, req) {
    const params = req.params.all();
    const station = params.station;

    const clone = SailsExtensions.cloneModel(pos);
    clone.parent = PointOfSale.getId(pos);
    clone.station = station || Station.getId(clone.station);
    const transactions = _.cloneDeep(clone.transactions);
    delete clone.transactions;
    clone.transactions = [];
    clone.complete = false;
    clone.pending_approval = false;
    clone.waiting = false;
    clone.owner = User.getId(req.user);
    clone.approved = false;
    clone.approved_by = null;
    delete clone.transaction_id;
    delete clone.tender;
    const aReturn = await PointOfSale.create(clone);
    return {
      pos: aReturn,
      transactions: transactions
    };
  },

  getSerilizableElements: async function(transaction, params) {
    const serial = params.serial;
    const node = await Node.findOneById(transaction.node, transaction.schema);
    if (!node) {
      throw new Error('errors.VALID_NODE_REQUIRED');
    }

    const serials = await NodeSerial.find()
      .where({
        owned_by_node: Model.getId(node),
        owned_by_schema: NodeSchema.getId(transaction.schema),
        possessed_by_schema: NodeSchema.getId(serial.id),
        via_param: serial.param_name
      })
      .populate('possessed_by_schema');

    if (!_.size(serials)) {
      throw new Error('errors.NO_SERIAL_IDS_FOUND');
    }
    const ids = [];
    _.each(serials, s => {
      if (s.possessed_by_node) {
        ids.push(s.possessed_by_node);
      }
    });
    if (!_.size(ids)) {
      throw new Error('errors.NO_SERIAL_IDENTITIES_DEFINED');
    }

    const serialSchema = serials[0].possessed_by_schema; // await NodeSchema.findOneById(serial.id);
    if (!serialSchema) {
      throw new Error('errors.VALID_SERIALIZABLE_NODE_REQUIRED');
    }
    const helpers = Module._helpers.logistics();
    const logParams = helpers.logParams(serialSchema.schema);

    return {
      logParams: logParams,
      transaction: transaction,
      params: params,
      serials: serials,
      node: node,
      ids: ids,
      schema: serialSchema
    };
  },

  applySeachField: async function(elements) {
    const logParams = elements.logParams;
    const ids = elements.ids;
    const scan = elements.params.scan;
    const serials = elements.serials;
    const serialSchema = elements.schema;

    const searchField = await Node.findNodes(
      {
        where: {
          id: ids,
          [logParams('sku')]: scan,
          __available__: true
        }
      },
      serialSchema
    );
    if (!_.size(searchField)) {
      throw new Error('errors.INVALID_SERIAL_SCAN');
    }
    // here save the scan in the array,
    // then go
    const pNode = searchField[0];
    const nSerial = NodeSerial.getSerialThroughNode(serials, pNode) || {};

    const value = nSerial.quantity;
    if (value <= 0) {
      throw new Error('errors.THIS_ITEM_IS_NO_LONGER_AVAILABLE');
    }
    elements.node = pNode;
    elements.serial = nSerial;
  },

  validateSerialRequest: function(params) {
    const errors = this.errorMessages();
    if (!params.transaction) {
      throw new Error(errors.TRANSACTION_ID_REQUIRED);
    }

    if (!_.size(params.serial) || !(params.serial || {}).id) {
      throw new Error(errors.SERIAL_PARAM_REQUIRED);
    }
    if (!params.scan) {
      throw new Error(errors.SCANNED_SERIAL_REQUIRED);
    }
  },

  constructSerialItem: async function(elements) {
    const errors = this.errorMessages();
    const serial = elements.params.serial;
    const nSerial = elements.serial;
    const scan = elements.params.scan;
    const pNode = elements.node;

    try {
      await NodeSerial.buildPosSerial(serial, nSerial, scan, pNode);
    } catch (e) {
      sails.log.error(e);
      throw new Error(errors.INVALID_SERIAL_NUMBER);
    }
  },

  initScanedNodeSerial: function(transaction, scan, serial) {
    if (
      transaction.serials[serial.param_name].nodeserial &&
      transaction.serials[serial.param_name].nodeserial[scan]
    ) {
      return;
    }

    const nodeSerialHold = serial.nodeserial || {};
    if (!nodeSerialHold) {
      return;
    }

    const nodeSerial = nodeSerialHold[scan];

    if (!nodeSerial) {
      return;
    }

    transaction.serials[serial.param_name].nodeserial =
      transaction.serials[serial.param_name].nodeserial || {};
    transaction.serials[serial.param_name].nodeserial[scan] =
      transaction.serials[serial.param_name].nodeserial[scan] || nodeSerial;
  },

  packageSerialToTransaction: async function(elements) {
    const serial = elements.params.serial;
    const scan = elements.params.scan;
    const transaction = elements.transaction;
    transaction.serials = transaction.serials || {};
    const previousTransaction = transaction.serials[serial.param_name];
    if (previousTransaction) {
      previousTransaction.items = previousTransaction.items || [];
      previousTransaction.items.push(scan);
    } else {
      serial.items.push(scan);
      transaction.serials[serial.param_name] = serial;
    }

    this.initScanedNodeSerial(transaction, scan, serial);
    NodeSerial.setAllSerialCountsOnTransaction(transaction);
    await PosTransaction.saveAsync(transaction);
  },

  validateNotUnique: function(elements) {
    const errors = this.errorMessages();
    const serial = elements.params.serial;
    const scan = elements.params.scan;
    const logParams = elements.logParams;
    const allSerialParams = logParams();

    if (
      (allSerialParams.sku || {}).unique_value &&
      serial.items.indexOf(scan) !== -1
    ) {
      throw new Error(errors.SERIAL_NUMBER_REQUIRED_UNIQUE);
    }
  },

  getPosForTransactions: async function(params) {
    const errors = this.errorMessages();
    if (!params.id) {
      throw new Error(errors.ID_PARAMETER_IS_REQUIRED);
    }
    const pos = await PointOfSale.findOneById(params.id).populateAll();
    if (!pos) {
      throw new Error(errors.INVALID_POS_TRANSACTION);
    }

    if (pos.return_block) {
      throw new Error(errors.RETURN_REQUIRES_ONE_TRANSACTION);
    }
    return pos;
  },

  noAvailableTransactionError: async function(aReturn, pos, res) {
    aReturn.destroy(err => {
      if (err) {
        sails.log.error(err);
      }
    });

    PointOfSale.update(
      {
        id: PointOfSale.getId(pos)
      },
      {
        return_block: true
      }
    ).exec(err => {
      if (err) {
        sails.log.error(err);
      }
    });
    const errors = this.errorMessages();
    return res.send({
      error: errors.RETURN_REQUIRES_ONE_TRANSACTION
    });
  },

  sendErrorWithSession: async function(e, pos, req, res) {
    sails.log.error('PointOfSale.sendErrorWithSession::::', e);
    const _pos = await PointOfSale.findOneById(
      PointOfSale.getId(pos)
    ).populateAll();
    this.setSession(req, _pos);
    res.serverError({ error: (e || {}).message });
  },

  sendPosWithSession: async function(pos, req, res) {
    const _pos = await PointOfSale.findOneById(
      PointOfSale.getId(pos)
    ).populateAll();
    this.setSession(req, _pos);
    return res.send(_pos);
  },

  setPriceOverrides: function(pos, transaction) {
    if (pos.has_price_overrides) {
      delete pos.price_overrides[PosTransaction.getId(transaction)];
      pos.has_price_overrides = !!_.size(pos.price_overrides);
    }
  },

  getNodeElements: async function(pos, params, settings) {
    const helpers = Module._helpers.logistics();
    let transaction = await PosTransaction.findOne({
      pointofsale: PointOfSale.getId(pos),
      scan: params.scan,
      is_return: params.quantity < 0
    });

    let searchSchema;
    let nodes;

    if (transaction && transaction.node) {
      searchSchema = await NodeSchema.findOneById(transaction.schema);
      nodes = [await Node.findOneById(transaction.node, searchSchema)];
    } else {
      transaction = null;
      const elements = await this.getSearchSchema(settings, params);
      nodes = elements.nodes;
      searchSchema = elements.schema;
    }
    const logParams = helpers.logParams(searchSchema.schema);
    const serialItems = await PosTransaction.setSerialiser(searchSchema);

    if (_.size(nodes) !== 1) {
      const errors = this.errorMessages();
      throw new Error(errors.INVALID_TRANSACTION_STATE);
    }

    return {
      schema: searchSchema,
      node: nodes.pop(),
      transaction: transaction,
      serialItems: serialItems,
      logParams: logParams
    };
  },

  buildItemForPosView: async function(node, schema, siteConfig) {
    const helpers = Module._helpers.logistics();
    const logParams = helpers.logParams(schema.schema);
    const item = {
      id: Model.getId(node),
      sku: node[logParams('sku')],
      description: node[logParams('name')],
      retail_cost: node[logParams('retail_cost')],
      src: await Utils.getFirstImage(node.files, siteConfig),
      quantity: node[logParams('quantity')],
      service_item: node[logParams('service_item')],
      schema: node.schema
    };

    return item;
  },

  extractSerials: function(schema) {
    const serials = _.where(schema.schema, {
      type: 'node',
      serializable: true
    });
    return node => {
      const _ser = {};
      _.each(serials, s => {
        if ((node[s.name] || {}).count) {
          _ser[s.name] = {
            count: (node[s.name] || {}).count || 0,
            unique: s.unique_identity
          };
        }
      });
      return _ser;
    };
  },

  searchPagedInventory: function() {
    //
  },

  getInventoryMaxPerNode: function(limiter, limit, size) {
    const maxPerNode = limiter || (limit ? Math.ceil(limit / size) : null);
    return maxPerNode;
  },

  searchAllInventory: async function(req, res) {
    const params = req.params.all();
    const limit = params.limit;
    const page = params.page || 1;
    const potentialInventory = params.inventory;
    const ids = [];
    _.each(potentialInventory, (val, id) => {
      if (val) {
        ids.push(id);
      }
    });
    const nodeschemas = _.size(ids)
      ? await NodeSchema.findById(ids)
      : await NodeSchema.find().where({
          is_inventory: true,
          can_link: false
        });
    const maxPerNode = this.getInventoryMaxPerNode(
      params.limiter,
      limit,
      _.size(nodeschemas)
    );

    const helpers = Module._helpers.logistics();
    const response = {
      __meta: {},
      __max: maxPerNode
    };

    for (let i = 0; i < _.size(nodeschemas); i++) {
      const s = nodeschemas[i];
      const serialExtract = this.extractSerials(s);
      const name = s.name;
      response[name] = [];

      const logParams = helpers.logParams(s.schema);
      const query = {
        limit: maxPerNode,
        skip: maxPerNode * (page - 1),
        sort: {
          [logParams('name')]: 'ASC'
        },
        where: {
          copy_of: null
        }
      };

      if (params.noService) {
        query.where[logParams('service_item')] = false;
      }

      if (params.searchText) {
        Node.textSearchQuery(params.searchText, query.where, s, true);
      }

      const total = await Node.countNodes(query.where, s);
      response.__meta[name] = {};
      response.__meta[name].count = parseInt((total.pop() || {}).count || 0);
      response.__meta[name].schema = Model.getId(s);
      response.__meta[name].page = page;
      response.__meta[name].label = s.title || name;
      const nodes = await Node.findNodes(query, s);
      for (let j = 0; j < _.size(nodes); j++) {
        const node = nodes[j];
        const item = await this.buildItemForPosView(
          node,
          s,
          res.locals.siteData
        );
        const serials = serialExtract(node);
        item.serialized = serials;
        response[name].push(item);
      }
    }
    return res.send(response);
  },

  buildPosOrRejectionForRedirect: function(req) {
    return new Promise((resolve, reject) => {
      PosController.scan(
        req,
        CommonUtils.responseMask((result, values) => {
          //
          if (result === 'ok' || result === 'send') {
            return resolve(values);
          }
          reject(new Error(`[${result}, ${JSON.stringify(values)}]`));
        })
      );
    });
  },

  buildSerilizeOrRejectionForRedirect: function(req) {
    return new Promise((resolve, reject) => {
      PosController.serialize(
        req,
        CommonUtils.responseMask((result, values) => {
          if (result === 'ok' || result === 'send') {
            return resolve(values);
          }
          reject(new Error(`[${result}, ${JSON.stringify(values)}]`));
        })
      );
    });
  },

  parseRedirectErrorPayload(res, error = {}) {
    const errors = this.errorMessages();
    try {
      const failure = error.message;
      const parsedMessage = JSON.parse(failure);
      return res[parsedMessage[0]](parsedMessage[1]);
    } catch {
      return res.serverError({ error: errors.UNKONW_POS_PARSING_ERROR });
    }
  },

  getRedirectAncestory: async function(transaction) {
    const ownerId = transaction.owner;
    const ancestry = await Station.ancestors(ownerId, true);
    const schemas = _.pluck(transaction.items, 'temp_schema');
    let transactionStation;
    let pos;
    for (let i = 0; i < _.size(ancestry); i++) {
      const ancestor = ancestry[i];
      const ownerSchema = await StationSchema.findOneById(
        ancestor.station_type
      ).populate('nodes');

      pos = await this.findPosNode(ownerSchema.nodes, schemas);

      if (pos) {
        transactionStation = ancestor;
        break;
      }
    }
    return { transactionStation, pos };
  },

  setRedirectWorkorderTransaction: async function(transaction, pos) {
    if (!transaction.workorder) {
      return;
    }
    const workorder = await WorkOrder.findOne({
      id: this.getId(transaction.workorder)
    });
    workorder.pos = this.getId(pos);
    await WorkOrder.saveAsync(workorder);
    pos.workorder = this.getId(workorder);
    await PointOfSale.saveAsync(pos);
  },

  iterateSerializeRedirectParams: async function(item, transactions = [], req) {
    const serials = _.cloneDeep(item.serials) || [];
    delete item.serials;
    const [transaction] = _.where(transactions, {
      scan: item.scan
    });

    for (let i = 0; i < _.size(serials); i++) {
      const serial = serials[i];

      serial.transaction = this.getId(transaction);
      req.body = serial;
      await this.buildSerilizeOrRejectionForRedirect(req);
    }
  },

  redirectedTransactions: async function(req, res, transaction) {
    // const ownerId = transaction.owner;
    const errors = this.errorMessages();
    const ancestry = await this.getRedirectAncestory(transaction);
    const pos = ancestry.pos;
    const transactionStation = ancestry.transactionStation;

    if (!pos || !transactionStation) {
      return res.badRequest({ error: errors.INVALID_REQUIRE_PARAMETERS });
    }
    let _posId;
    let _pos;

    for (let i = 0; i < _.size(transaction.items); i++) {
      const item = _.clone(transaction.items[i]);
      item.schema = NodeSchema.getId(pos);
      item.station = Station.getId(transactionStation);

      if (_posId) {
        item.id = +_posId;
      }

      req.body = item;
      try {
        _pos = await this.buildPosOrRejectionForRedirect(req);
      } catch (e) {
        sails.log.error(e);
        return this.parseRedirectErrorPayload(res, e); // res[e.result](e.value);
      }

      if (_pos.id && !_posId) {
        _posId = _pos.id;
      }

      try {
        const transactions = _pos.transactions || [];
        await this.iterateSerializeRedirectParams(item, transactions, req);
      } catch (e) {
        sails.log.error(e);
        return this.parseRedirectErrorPayload(res, e); // res[e.result](e.value);
      }
    }

    await this.setRedirectWorkorderTransaction(transaction, _pos);
    res.send(_pos);
  },

  findPosNode: async function(nodes, schemas) {
    const posNodes = _.where(nodes, {
      is_pos: true
    });

    for (let i = 0; i < _.size(posNodes); i++) {
      const pos = posNodes[i];
      const apps = pos.applications;
      const inventory = apps.inventory;
      const every = [];
      _.each(schemas, s => {
        every.push(inventory[s]);
      });

      if (_.every(every)) {
        return pos;
      }
    }
  },

  setRequestApprovalAsValid: async function(cr) {
    const client = User.getId(cr.requested_by);
    const userCan = await PointOfSale.buildApproval(client);
    const rule = await CostRule.findOneById(CostRule.getId(cr.rule));
    const rTemplate = PointOfSale.buildCan(rule, userCan);
    rTemplate.until_date = cr.expires_on;
    await CostRule.create(rTemplate);
  },

  setSession: function(req, pos) {
    const station = Station.getId(pos.station);
    const schema = Station.getId(pos.schema);
    req.session.posTransaction = req.session.posTransaction || {};
    req.session.posTransaction[station] =
      req.session.posTransaction[station] || {};
    req.session.posTransaction[station][schema] = PointOfSale.getId(pos);
  },

  saveAsync: async function(value) {
    if (!value) {
      return;
    }
    if (value.client && _.isObject(value.client)) {
      value.client = PointOfSale.getId(value.client);
    }
    return Model.saveAsync(value);
  },

  buildCan: function(rule, canClause) {
    const rTemplate = CostRule.oneCanRuleTemplate(rule);
    rTemplate.name = `${rTemplate.name} - ${canClause.for}`;
    rTemplate.query = `${canClause.query} can ${rTemplate.query}`;
    return rTemplate;
  },

  buildApproval: async function(client) {
    const user = await User.findOneById(User.getId(client));
    const rule = await Rule.findOne({ entity: 'pointofsale' });
    const userCan = Utils.parseLocals(`${rule.actors.client.query}`, {
      action: 'is',
      arr: `[${User.getId(user)}]`
    });
    return {
      query: userCan,
      for: User.fullName(user)
    };
  },

  sendForApproval: async function(tender, pos, simulation) {
    /*
     * Creates a request approval
     */
    const userCan = await PointOfSale.buildApproval(pos.client);
    const lastOne = _.size(tender.rejections)
      ? _.size(tender.rejections) - 1
      : 0;
    for (let i = lastOne; i < _.size(tender.rejections); i++) {
      const reject = tender.rejections[i];
      const rule = await CostRule.findOneById(Model.getId(reject));
      if (simulation) {
        const rTemplate = this.buildCan(rule, userCan);
        await CostRule.create(rTemplate);
      } else {
        const request = {
          costcode: reject.costcode,
          statement_of_purpose: tender.statement_of_purpose,
          submittal_files: tender.submittal_files,
          target: PointOfSale.getId(pos),
          model: 'pointofsale',
          rule: Model.getId(reject),
          requested_by: User.getId(pos.client),
          requested_through: User.getId(pos.owner),
          coms: true
        };
        await CostRequest.create(request);
      }
    }
  },

  reject: function() {
    //
  },

  certify: async function(action) {
    return {
      certificate: Tracker.buildRandomId('uuid'),
      time: TimeUtils.isoFormattedDate(now_),
      action: action
    };
  },

  removeOnce: async function(_tender, details) {
    const search = {
      player: PointOfSale.getId(details.client),
      entity: 'user',
      dependent: 'pointofsale',
      on: PointOfSale.getId(details),
      target: 'rule',
      consumed: true
    };
    await Once.update(search, { consumed: false });
  },

  setonce: async function(_tender, details) {
    const search = {
      player: PointOfSale.getId(details.client),
      entity: 'user',
      dependent: 'pointofsale',
      on: PointOfSale.getId(details),
      target: 'rule',
      consumed: false
    };
    await Once.update(search, { consumed: true });
  },

  validateonce: async function(rule, params) {
    const pos = params.pointofsale;
    const validity = Const.rules.ACCEPTED;

    const search = {
      player: PointOfSale.getId(pos.client),
      entity: 'user',
      dependent: 'pointofsale',
      target: 'rule',
      actor: Rule.getId(rule),
      consumed: true
    };

    const hasOnce = await Once.find().where(search);
    if (_.size(hasOnce)) {
      return Const.rules.REJECT;
    }
    search.consumed = false;
    // clean up any unused once items
    await Once.destroy().where(search);
    search.on = PointOfSale.getId(pos);
    // create
    await Once.create(search);

    return validity;
  },

  costCode: async function(params) {
    const errors = this.errorMessages();
    const payment = params.payment;
    const p = params.pointofsale;
    const settings = (p.station.settings || {}).pos || {};

    const cost_code = (payment.meta || {}).cost_code;
    if (!cost_code) {
      throw new Error(errors.VALID_COSTCODE_REQUIRED);
    }

    const station = await Station.findOne({ station_id: cost_code });
    if (
      !station ||
      (_.size(settings.costCodes) && !_.contains(settings.costCodes, cost_code))
    ) {
      throw new Error(errors.COSTCODE_CANNOT_PROCESS);
    }
    /*
     * Here we are going to preted our cost codes are approved
     */
    // const ancestors = await Station.ancestors(cost_code);
    const approved = await CostRule.iterateAncestors(
      cost_code,
      'pointofsale',
      params
    );

    let approval;

    if (payment.token) {
      approval = await CostApproval.verify(payment.token);
      approval.approved = approved;
      approval.amount = payment.value;
      approval.meta = approval.meta || {};
      approval.meta.rejections = approval.meta.rejections || [];
      approval.meta.rejections.push(...(params.rejections || []));
      await CostApproval.saveAsync(approval);
    } else {
      approval = await CostApproval.create({
        approved: approved,
        amount: payment.value,
        meta: {
          rejections: params.rejections
        }
      });
    }
    return approval;
  },

  forCostCode: async function(to, from, tender, details) {
    if (!to || !from) {
      throw new Error(Const.err.NOT_A_COST_CODE_TRANSACTION);
    }
    const domain = ((details || {}).station || {}).domain;
    const site = Site.thisSiteAsync(domain);
    const currency = site.currency || Const.DEFAULT_CURRENCY;
    const amount = CostCode.convertCurrency(tender.value, currency);
    if (amount === null) {
      throw new Error(Const.err.NO_COST_CODE_AMOUNT);
    }

    return {
      from: from,
      to: to,
      amount: amount,
      domain: domain,
      currency: currency,
      entity: 'pointofsale'
    };
  },

  revertForCostcode: async function(tender, details) {
    const to = ((tender || {}).meta || {}).cost_code;
    const from = ((details || {}).station || {}).station_id;
    const cc = this.forCostCode(to, from, tender, details);
    return cc;
  },

  convertForCostcode: async function(tender, details) {
    const from = ((tender || {}).meta || {}).cost_code;
    const to = ((details || {}).station || {}).station_id;
    const cc = this.forCostCode(to, from, tender, details);
    return cc;
  },

  revertCostCode: async function(tender, details) {
    await CostApproval.revert(tender.token);
    await this.removeOnce(tender, details);
    const conversion = await this.revertForCostcode(tender, details);
    sails.log.debug('POS CHECKPOINT 2.1.1', conversion);
    const cc = await CostCode.invoice(conversion);
    return cc;
  },

  finishTransaction: async function(pos, files, req) {
    if (!Site.isInTestMode()) {
      Jobs.completePosTransaction.add(pos);
    }

    const params = req.params.all();
    const applications = pos.schema.applications;
    pos.complete = true;

    // Note: if has parent its mean return transaction, then set return_block to true
    if (pos.parent) {
      pos.return_block = true;
    }

    _.each(files, f => pos.files.add(f));
    pos.tender = params.tender;
    pos.completed_on = new Date();
    pos.tax_rate = ((applications || {}).tax_rate || 0) / 100;

    await PointOfSale.saveAsync(pos);
    req.session.posTransaction = req.session.posTransaction || {};
    req.session.posTransaction[Station.getId(pos.station)] = null;
    pos = await PointOfSale.findOneById(PointOfSale.getId(pos)).populateAll();
    // await pos.setClient();
    return pos;
  },

  renderTransactions: async function(params, pos) {
    const actions = [];
    const completion = [];
    let totalValue = 0;

    for (let i = 0; i < _.size(params.tender); i++) {
      const t = params.tender[i];
      totalValue += parseFloat(t.value || 0);
      try {
        // const a = await PointOfSale.actions(t, pos);
        const action = PointOfSale.actions(t, pos);
        const a = await action();
        _.merge(t, a);
        completion.push((a || {}).certificate != null);
        actions.push(a);
      } catch (e) {
        completion.push(false);
      }
    }
    const errors = this.errorMessages();
    if (totalValue < pos.final_cost) {
      throw new Error(errors.TOTAL_VALUE_LESSTHAN_FINAL);
    }
    const complete = _.every(completion) || !_.size(completion);
    if (!complete) {
      throw new Error(errors.SOME_TRANSACTIONS_FAILED_TO_TENDER);
    }

    return completion;
  },

  finalizeTender: async function(params, pos, files) {
    const completion = await this.renderTransactions(params, pos);
    const errors = this.errorMessages();
    for (let i = 0; i < _.size(params.tender); i++) {
      const t = params.tender[i];
      const finalize = PointOfSale.finish(t, pos);

      try {
        // sails.log.debug("POS CHECKPOINT 2.1", Date.now() - start);
        await finalize();
        // sails.log.debug("POS CHECKPOINT 2.2", Date.now() - start);
        if (t.meta && t.meta.files) {
          files.push(...t.meta.files);
        }
      } catch (e) {
        sails.log.error(e);
        completion.push(false);
      }
    }

    const complete = _.every(completion) || !_.size(completion);
    if (!complete) {
      throw new Error(errors.ERROR_PROCESS_TENDER);
    }

    return complete;
  },

  rollBack: async function(tenders, details) {
    for (let i = 0; i < _.size(tenders); i++) {
      const tender = tenders[i];

      const action = (tender || {}).key;
      switch (action) {
        case 'cash':
          break;
        case 'cheque':
          break;
        case 'credit_card':
          break;
        case 'cost_code':
          await this.revertCostCode(tender, details);
          break;
        case 'payroll':
          break;
        case 'paypal':
          break;
        case 'bank_transfer':
          break;
        case 'invoice':
          break;
      }
    }
    details.approved_by = null;
  },

  finish: function(tender, details) {
    const action = (tender || {}).key;
    const errors = this.errorMessages();
    const actions = {
      cash: () => {
        //
      },
      cheque: () => {
        //
      },
      credit_card: async () => {
        throw new Error(errors.NOT_YET_IMPLEMENTED);
      },
      cost_code: async () => {
        // const start = Date.now();
        if (!tender.token) {
          throw new Error(errors.VALID_TOKEN_REQUIRED);
        }

        let verified;

        try {
          verified = await CostApproval.verify(tender.token);

          const conversion = await PointOfSale.convertForCostcode(
            tender,
            details
          );
          // sails.log.debug("POS CHECKPOINT 2.1.1", Date.now() - start);
          const cc = await CostCode.invoice(conversion);
          // sails.log.debug("POS CHECKPOINT 2.1.2", Date.now() - start);
          if (!cc || !cc.id) {
            throw new Error(errors.VALID_COSTCODE_NOT_GENERATED);
          }
        } catch (e) {
          throw new Error(e);
        }

        verified.consumed = true;
        // sails.log.debug("POS CHECKPOINT 2.1.3", Date.now() - start);
        await this.setonce(tender, details);
        // sails.log.debug("POS CHECKPOINT 2.1.4", Date.now() - start);
        details.approved_by =
          details.approved_by || (tender.meta || {}).manager_approval;
        // sails.log.debug("POS CHECKPOINT 2.1.5", Date.now() - start);
        await CostApproval.saveAsync(verified);
        // sails.log.debug("POS CHECKPOINT 2.1.6", Date.now() - start);
      },
      payroll: async () => {
        throw new Error(errors.NOT_YET_IMPLEMENTED);
      },
      paypal: async () => {
        throw new Error(errors.NOT_YET_IMPLEMENTED);
      },
      bank_transfer: async () => {
        throw new Error(errors.NOT_YET_IMPLEMENTED);
      },
      invoice: () => {
        //
      }
    };

    return (
      actions[action] ||
      (() => {
        return new Promise((resolve, reject) => {
          reject(errors.ACTION_NOT_FOUND);
        });
      })
    );
  },

  actions: function(tender) {
    const errors = this.errorMessages();
    const action = (tender || {}).key;
    const actions = {
      cash: async () => {
        return PointOfSale.certify(action);
      },
      cheque: async () => {
        if (tender.meta.check_number) {
          return PointOfSale.certify(action);
        }
        throw new Error(errors.CHECK_NUMBER_REQUIRED);
      },
      credit_card: async () => {
        throw new Error(errors.NOT_YET_IMPLEMENTED);
      },
      cost_code: async () => {
        if (!tender.token) {
          throw new Error(errors.VALID_TOKEN_REQUIRED);
        }
        const verified = await CostApproval.verify(tender.token);
        if (!verified) {
          throw new Error(errors.VERIFICATION_NOT_EXISTS);
        }
        if (verified.approved) {
          return PointOfSale.certify(action);
        } else {
          throw new Error(errors.CERTIFICATION_NOT_APPROVED);
        }
      },
      payroll: async () => {
        throw new Error(errors.NOT_YET_IMPLEMENTED);
        /*
         * At time of payroll system
         */
      },
      paypal: async () => {
        throw new Error(errors.NOT_YET_IMPLEMENTED);
      },
      bank_transfer: async () => {
        throw new Error(errors.NOT_YET_IMPLEMENTED);
      },
      invoice: async () => {
        //
      }
    };

    return (
      actions[action] ||
      (() => {
        return new Promise((resolve, reject) => {
          reject(errors.ACTION_NOT_FOUND);
        });
      })
    );
  },

  paymentLabels: function() {
    return _.clone([
      'labels.CASH',
      'labels.CHEQUE',
      'labels.COST_CODE',
      'labels.PAYROLL',
      'labels.BANK_TRANSFER',
      'labels.INVOICE'
    ]);
  },

  _timers: [
    {
      interval: Const.timers.DAILY,
      name: 'pos_stale_removal',
      action: function() {
        return {
          do: function() {
            Jobs.removeStalePos.add();
          }
        };
      }
    }
  ],

  _processors: [
    {
      name: 'posTransactionEmail',
      process: async function(job) {
        const data = job.data;

        const varKeys = [
          'labels.QUANTITY',
          'labels.SKU',
          'labels.DESCRIPTION',
          'labels.UNIT_PRICE',
          'labels.SUB_TOTAL',
          'labels.PAYMENT_METHODS',
          'labels.GREETINGS',
          'labels.PAYMENT_DETAILS',
          'labels.TOTAL_COST',
          'labels.TRANSACTION_ID',
          'labels.FINAL_COST',
          'labels.TOTAL_RETAIL_COST',
          'labels.SALES_TAX',
          'labels.TIMESTAMP',
          ...PointOfSale.paymentLabels()
        ];

        const variables = await Variable.find({
          // or: [
          //   { key: 'stystem_translations' }
          // ],
          key: Translates.translateIdentity,
          identity: varKeys
        });

        const varCache = {};
        _.each(variables, v => {
          varCache[v.identity] = v.value;
        });

        const config = await Site.thisSiteAsync(
          Domain.getId(data.station.domain)
        );
        let client;
        if (data.client) {
          client =
            (await Email.findContactCredentials({
              user: data.client,
              user_type: data.client_type
            })) || {};
        }

        const vars = {};
        _.each(varKeys, v => {
          const labels = v.split('.');
          if (varCache[v]) {
            vars[labels[1]] =
              varCache[v][client.preferred_language] ||
              varCache[v][config.default_language] ||
              varCache[v][Translates.fallbackLanguage] ||
              v;
          } else {
            vars[labels[1]] = v;
          }
        });

        const email = data.alt_email || client.email;
        const name = client.name || vars.GREETINGS;

        if (!email) return;

        const fmt = TimeUtils.constants.formats.DateTime.verboseAmPm;
        const completedDate = TimeUtils.formattedDate(data.completed_on, fmt);

        Jobs.sendEmail.add({
          to: {
            address: email,
            name: name
          },
          locals: {
            settings: (data.station.settings || {}).pos || {},
            vars: vars,
            name: name,
            site_name: config.site_name,
            /* [sg] timestamp: m oment(data.completed_on).format('LLLL'), */
            timestamp: completedDate,
            host: Utils.pullHost(config),
            pos: data,
            transaction_id: data.transaction_id,
            money: '$'
          },
          default_language:
            client.preferred_language || config.default_language,
          template: 'receipt',
          variables: Email.variables.receipt.key,
          tags: ['point of sale', 'receipt']
        });

        return email;
      },

      stats: Utils.stats({
        completed: function(job, result) {
          sails.log.debug('Jobs.posTransactionEmail::COMPLETE::', result);
        },
        failed: function(job, err) {
          sails.log.error('Jobs.posTransactionEmail::ERR::', err);
        }
      })
    },

    {
      name: 'completePosTransaction',
      process: async function() {
        /*
         * Here we can do bunches of stuff such as activate an account. Send money else where. Send emails. Unlock accounts, etc
         */
      },

      stats: Utils.stats({
        completed: function(job, result) {
          sails.log.debug('Jobs.completePosTransaction::COMPLETE::', result);
        },
        failed: function(job, err) {
          sails.log.error('Jobs.completePosTransaction::ERR::', err);
        }
      })
    },
    /*
     * This processor looks for users who are still considered offline,
     * but their session has expired. It there is no suession data, we set the
     * user to their offline state
     */

    {
      name: 'removeStalePos',
      process: async function(job, cb) {
        const OneDay = TimeUtils.date(now_).minus(1, TimePeriod.days);
        const pos = await PointOfSale.find({
          complete: false,
          waiting: false,
          // in_focus: false,
          updatedAt: { '<=': OneDay.tz(tz).toISO }
        });

        for (let i = 0; i < _.size(pos); i++) {
          const p = pos[i];
          const id = PointOfSale.getId(p);
          try {
            sails.log.debug('PointOfSale.removeStalePos::::', id);
            await PointOfSale.destroy({ id: id });
          } catch (e) {
            sails.log.error(e);
          }
        }
        cb();
      },

      stats: Utils.stats({
        completed: function() {
          // sails.log.debug('All Users Purged');
        },
        failed: function(job, err) {
          console.error('POS PURGE ERROR::', err);
          // Utils.sendexcelMessage(err, job.data);
        }
      })
    }
  ],

  stillWaiting: async function(parent, deletion) {
    let parentDependents;

    if (_.size(parent.dependents)) {
      parentDependents = parent;
    } else {
      parentDependents = await PointOfSale.findOneById(
        PointOfSale.getId(parent)
      ).populate('dependents');
    }

    let waiting = false;
    _.each(parentDependents.dependents, d => {
      if (!d.complete && PointOfSale.getId(d) !== PointOfSale.getId(deletion)) {
        waiting = true;
      }
    });
    return waiting;
  },

  beforeDestroy: async function(values, next) {
    const pos = await PointOfSale.find()
      .where(
        PointOfSale.getId(
          _.isObject(values) && values.where ? values.where : values
        )
      )
      .populateAll();
    const helpers = Module._helpers.logistics();
    for (let i = 0; i < _.size(pos); i++) {
      for (let j = 0; j < _.size(pos[i].transactions); j++) {
        const transaction = pos[i].transactions[j];
        const s = await NodeSchema.findOneById(transaction.schema);
        if (!s) {
          continue;
        }
        const logParams = helpers.logParams(s.schema);
        const serviceParam = logParams('service_item');
        const node = await Node.findOneById(transaction.node, s);
        if (!node) {
          continue;
        }
        if (!node[serviceParam]) {
          if (transaction.quantity > 0) {
            node[logParams('quantity')] += Math.abs(transaction.quantity || 0);
            node[logParams('quantity_outgoing')] -= transaction.quantity || 0;
          } else {
            node[logParams('quantity_incoming')] += transaction.quantity || 0;
          }
          await await Node.updateOrCreate()({
            params: node,
            schema: s
          });
        }
        await PosTransaction.cleanupConstructedSerials(transaction);

        transaction.destroy(err => {
          if (err) {
            sails.log.err(err);
          }
        });
      }

      const parent = pos[i].parent;
      if (parent) {
        parent.waiting = await PointOfSale.stillWaiting(parent, pos[i]);
        PointOfSale.saveAsync(new PointOfSale._model(parent));
      }
    }

    next();
  },

  beforeCreate: async function(values, next) {
    if (!values.transaction_id) {
      values.transaction_id = await Tracker.findCodeBody('short');
    }
    next();
  },

  errorMessages: function() {
    return {
      ...{
        UNKONW_POS_PARSING_ERROR:
          'A parsing error on this point of sale transaction',
        NO_SUB_ZERO_VALUE: 'warning.ITEM_QUANTITY_CANNOT_FALL_BELOW_ZERO',
        POS_AND_PAYMENT_REQUIRED:
          'Both a point of sale and payment object is required',
        UNSET_ACTION_REQUIRED: 'An unset action is required',
        AT_LEAST_ONE_APPROVAL: 'At least one approval request is required',
        POS_MODEL_REQUIRED: 'A Point of Sale model is requred',
        ERROR_PROCESS_TENDER: 'Error Processing Tender Requests',
        SOME_TRANSACTIONS_FAILED_TO_TENDER:
          'Some tender methods failed to complete',
        TOTAL_VALUE_LESSTHAN_FINAL:
          'The total value is less than the final cost',
        VALID_TRANSACTION_REQUIRED: 'errors.VALID_TRANSACTION_REQUIRED',
        TRANSACTION_ID_REQUIRED: 'A transaction ID is required',
        SERIAL_PARAM_REQUIRED: 'A serial parameter is required',
        SCANNED_SERIAL_REQUIRED: 'A scanned serial number is required',
        INVALID_SERIAL_NUMBER: 'Invalid Serial Number',
        SERIAL_NUMBER_REQUIRED_UNIQUE:
          'This serial is already included. It must be unique',
        ID_PARAMETER_IS_REQUIRED: 'An ID parameter is required',
        INVALID_POS_TRANSACTION: 'Invalid POS transaction',
        RETURN_REQUIRES_ONE_TRANSACTION:
          'A returned entity requires at least one valid transaction',
        INVALID_TRANSACTION_STATE: 'Invalid transaction state',
        NO_SUITABLE_DISTRO: 'No suitable distribution entity found',
        VALID_COSTCODE_REQUIRED: 'A valid cost code is required',
        COSTCODE_CANNOT_PROCESS:
          'This cost code is not avaiable to process this transaction',
        NOT_YET_IMPLEMENTED: 'Not yet impemented',
        VALID_TOKEN_REQUIRED: 'A valid token is required',
        VALID_COSTCODE_NOT_GENERATED: 'A valid costcode was not generated',
        ACTION_NOT_FOUND: 'Action not found',
        CHECK_NUMBER_REQUIRED:
          'Check number required to complete this transaction',
        VERIFICATION_NOT_EXISTS: 'Verification does not exist',
        CERTIFICATION_NOT_APPROVED: 'Certification token has not been approved',
        VALID_POS_OBJECT: 'A valid Point of Sale object is required',
        INVALID_PAYMENT_TYPE: 'Invalid payment type',
        POS_AND_ITEM_REQUIRED: 'Point of sale and item params required',
        INVALID_POS_ID: 'Point of sales ID is not a valid parameter',
        TRANSACTION_ALREADY_PROCESSED:
          'This transaction has already been processed',
        ERROR_PROCESSING_REQUEST: 'There was an error processing this request',
        ERROR_PROCESSING_TRANSACTION:
          'An error occurred while processing this transaction',
        VALID_NODE_SCHEMA_PARAM_REQUIRED:
          'A valid node schema param is required',
        VALID_STATION_PARAM_REQUIRED: 'A valid node station param is required',
        NODE_SCHEMA_IS_INVALID: 'This is an invalid nodeschema',
        STATION_IS_INVALID: 'This is an invalid station',
        PERMISSION_PRICE_OVERRIDE: 'You lack permissions to override a price',
        CHANGE_CONTEXT_REQUIRED: 'Change Context Required',
        TRANSACTION_NOT_FOUND: 'Transaction not found',
        INVALID_REQUIRE_PARAMETERS: 'Invalid Request Params',
        POS_MODEL_NOT_GENERATED: 'Point of sale model was not generated'
      }
    };
  }
};
