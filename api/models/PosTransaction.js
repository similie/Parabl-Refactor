/**
 * PosTranslation.js
 *
 * @description :: A model definition.  Represents a database table/collection/etc.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

const { SqlUtils } = require('similie-api-services');

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    pointofsale: {
      required: true,
      model: 'pointofsale'
    },

    scan: {
      required: true,
      type: 'string'
    },

    description: {
      type: 'string'
    },

    station: {
      model: 'station'
    },

    schema: {
      model: 'nodeschema'
    },

    quantity: {
      type: 'integer'
    },

    unit_cost: {
      type: 'float',
      defaultsTo: 0
    },

    retail_cost: {
      type: 'float',
      defaultsTo: 0
    },

    total_retail_cost: {
      type: 'float',
      defaultsTo: 0
    },

    total_cost: {
      type: 'float',
      defaultsTo: 0
    },

    node: {
      type: 'integer'
    },

    has_price_override: {
      type: 'boolean',
      defaultsTo: false
    },

    price_override: {
      type: 'float',
      defaultsTo: 0
    },

    price_override_by: {
      type: 'integer'
    },

    requires_serial: {
      type: 'boolean',
      defaultsTo: false
    },

    is_return: {
      type: 'boolean',
      defaultsTo: false
    },

    fullfilled: {
      type: 'boolean',
      defaultsTo: false
    },

    serials: {
      type: 'json'
    },

    chain_code: {
      type: 'uuid'
    },

    assignment: {
      model: 'assetassignment'
    },

    station_asset: {
      model: 'stationasset'
    },

    workorder: {
      model: 'workorder'
    },

    requisition: {
      model: 'requisition'
    },

    start_quantity: {
      type: 'integer',
      defaultsTo: 0
    },

    out_quantity: {
      type: 'integer',
      defaultsTo: 0
    },

    in_quantity: {
      type: 'integer',
      defaultsTo: 0
    },

    last_quantity: {
      type: 'integer',
      defaultsTo: 0
    },

    meta: {
      type: 'json'
    }
  },

  cleanupConstructedSerials: async function(transaction) {
    const serials = transaction.serials;
    const serialHold = [];
    const cache = {};
    const is_return = transaction.quantity < 0;
    if (transaction.fullfilled) {
      return;
    }

    for (const key in serials) {
      const serial = serials[key];
      const items = serial.items;

      for (const sku in serial.nodeserial) {
        const s = serial.nodeserial[sku];
        if (s.volitile && is_return) {
          const sID = NodeSerial.getId(s.serial);
          if (sID && !cache[sID]) {
            cache[sID] = true;
            serialHold.push(sID);
          }
        } else if (!is_return) {
          s.quantity = NodeSerial.getCountByScan(sku, items);
          await NodeSerial.increment(s.serial, s.quantity);
        }
      }
    }
    if (_.size(serialHold)) {
      const foundSerials = await NodeSerial.find().where({ id: serialHold });
      await NodeSerial.garbageCollect(foundSerials);
    }
  },

  serialCheck: async function(nodeserial) {
    const nsId = NodeSerial.getId(nodeserial);
    if (!nsId) {
      throw new Error('errors.INVALID_SERIAL_ID');
    }

    const serialCheck = await NodeSerial.findOneById(nsId);
    return serialCheck;
  },

  serialBuilder: async function(transaction, param_name, scan) {
    const holdSerial = _.clone(transaction.serials[param_name]) || {};
    const serialHold = ((holdSerial || {}).nodeserial || {})[scan];
    const serialCheck = await this.serialCheck(serialHold.serial);
    if (!serialCheck) {
      const _serial = await NodeSerial.transactionSerial(
        transaction,
        holdSerial,
        scan
      );
      serialHold.serial = NodeSerial.getId(_serial);
      serialHold.node = NodeSerial.getId(serialHold.node);
      serialHold.volitile = true;
      transaction.serials[param_name].nodeserial[scan] = serialHold;
    }

    return transaction.serials[param_name].nodeserial[scan];
  },

  wantsRounding: function() {
    return false;
  },

  singleSerialDestroy: async function(transaction, serial, scan) {
    if (transaction.quantity > 0) {
      await this.setSerialIncrements(transaction, serial.param_name, scan);
    }
    transaction.serials[serial.param_name] = serial;
    transaction.quantity = transaction.quantity +=
      transaction.quantity > 0 ? -1 : 1;
    await PosTransaction.saveAsync(transaction);
    return transaction;
  },

  setSerialIncrements: async function(
    transaction,
    param_name,
    scan,
    with_quantity
  ) {
    NodeSerial.setAllSerialCountsOnTransaction(transaction);
    const serialHold = await this.serialBuilder(transaction, param_name, scan);
    const is_return = transaction.quantity < 0;
    //  we don't want this on returns
    const quantity = with_quantity ? serialHold.count : 1;
    if (is_return) {
      await NodeSerial.increment(serialHold.serial, quantity);
    } else {
      await NodeSerial.decrement(serialHold.serial, quantity);
    }
  },

  incrementSerialsForCompleteTransaction: async function(transaction) {
    const serials = transaction.serials;
    for (const key in serials) {
      const serial = serials[key];
      for (const sku in serial.nodeserial) {
        await this.setSerialIncrements(transaction, key, sku, true);
      }
    }
  },

  resetSerials: async function(transaction, param_name) {
    const serial = (transaction.serials || {})[param_name];
    for (const sku in serial.nodeserial) {
      const validate = await this.serialBuilder(transaction, param_name, sku);
      if (!validate) {
        throw new Error('Serial Generatation Failed');
      }
    }
  },

  getSumTotal: async function(transaction) {
    const escape = SqlUtils.escapeUtil();
    const sId = Station.getId(transaction.station);
    const scId = StationSchema.getId(transaction.schema);
    const nId = Model.getId(transaction.node);
    const query = escape(
      `SELECT SUM("quantity") from "postransaction"  WHERE "station" = %s AND "schema"= %s AND "node" = %s AND "fullfilled" IS FALSE;`,
      sId,
      scId,
      nId
    );

    const result = await Model.queryAsync(query);
    const row = result.rows.pop();
    return parseInt(row.sum);
  },

  subtract: function(transaction) {
    const quantity = parseInt(transaction.quantity || 0);
    const last_quantity = parseInt(transaction.last_quantity || 0);
    const value = quantity - last_quantity;
    transaction.last_quantity = quantity;
    return value;
  },

  serialChange: async function(serials, func) {
    for (const key in serials) {
      const serial = serials[key];
      const nodeserial = serial.nodeserial;
      const items = serial.items;
      for (const sku in nodeserial) {
        const count = NodeSerial.getCountByScan(sku, items);
        const trans = nodeserial[sku];
        await NodeSerial[func](trans.serial, count);
      }
    }
  },

  setTransactionQuantity: function(elements, params, method) {
    const transaction = elements.transaction;
    const node = elements.node;
    const schema = elements.schema;
    const helpers = Module._helpers.logistics();
    const logParams = helpers.logParams(schema.schema);
    const serviceParam = logParams('service_item');

    if ((method === 'PUT' || method === 'POST') && !node[serviceParam]) {
      const q = transaction.quantity;
      transaction.quantity =
        q && params.quantity === 1 && !params.direct
          ? q + params.quantity
          : params.quantity || 0;

      if (transaction.quantity < 0) {
        throw new Error('BEACH STREET');
      }
    } else {
      transaction.quantity =
        params.quantity && !_.isNaN(parseInt(params.quantity))
          ? parseInt(params.quantity)
          : 1;
    }
  },

  setRetailCost: function(elements) {
    const transaction = elements.transaction;
    const node = elements.node;
    const schema = elements.schema;
    const ROUND = false;
    const helpers = Module._helpers.logistics();
    const logParams = helpers.logParams(schema.schema);
    const unitCost = logParams('unit_cost');
    const retailCost = logParams('retail_cost');
    const retail_cost = transaction.has_price_override
      ? transaction.retail_cost || 0
      : node[retailCost] || 0;
    transaction.unit_cost = node[unitCost] || 0;
    transaction.retail_cost = retail_cost;
    const u_cost = transaction.unit_cost * 100 * transaction.quantity;
    const r_cost = retail_cost * 100 * transaction.quantity;
    transaction.total_cost = Utils.fixValue(
      u_cost / 100.0, // reduce float multiplication error
      ROUND,
      2
    );
    transaction.total_retail_cost = Utils.fixValue(r_cost / 100.0, ROUND, 2);
  },

  transactionalContext: async function(params, pos) {
    const is_return = params.quantity < 0;
    const transaction = await PosTransaction.findOne({
      pointofsale: PointOfSale.getId(pos),
      scan: params.scan,
      is_return: is_return
    });
    return transaction;
  },

  alterNodeValues: async function(elements, params) {
    const transaction = elements.transaction;
    const node = elements.node;
    const schema = elements.schema;
    const helpers = Module._helpers.logistics();
    const logParams = helpers.logParams(schema.schema);
    const qParam = logParams('quantity');
    const outParam = logParams('quantity_outgoing');
    const inParam = logParams('quantity_incoming');
    const serviceParam = logParams('service_item');
    const errors = PointOfSale.errorMessages();

    if (!node[serviceParam]) {
      if (params.quantity > 0) {
        const value = this.subtract(transaction);
        node[qParam] -= value;
        node[outParam] += value;
        if (node[qParam] < 0) {
          throw new Error(errors.NO_SUB_ZERO_VALUE);
        }
      } else {
        const value = this.subtract(transaction);
        node[inParam] -= value;
      }
    }
  },

  subtractables: function(transaction) {
    transaction.total_cost *= -1;
    transaction.quantity *= -1;
    transaction.last_quantity = transaction.quantity;
  },

  returnSetUp: function(transaction, node, station, posReturn) {
    this.subtractables(transaction);
    transaction.node = Model.getId(node);
    transaction.total_retail_cost =
      transaction.quantity * transaction.retail_cost;
    transaction.total_cost = transaction.quantity * transaction.unit_cost;
    transaction.is_return = true;
    transaction.fullfilled = false;
    transaction.pointofsale = PointOfSale.getId(posReturn);
    transaction.station = station;
    transaction.meta = {
      original_min: transaction.quantity
    };
  },

  incrementSerials: async function(transaction) {
    const func = transaction.is_return ? 'decrement' : 'increment';
    const serials = transaction.serials;
    return this.serialChange(serials, func);
  },

  stripReturnedSerials: async function(transaction, parentTransaction) {
    const serials = parentTransaction.serials;
    for (const key in serials) {
      transaction.serials[key].returned_serials =
        transaction.serials[key].returned_serials || [];
      transaction.serials[key].returned_serials.length = 0;
      for (let i = 0; i < _.size(serials[key].returned_serials); i++) {
        const serial = serials[key].returned_serials[i];
        const nextIndex = transaction.serials[key].items.indexOf(serial);

        if (serial !== -1) {
          transaction.serials[key].items.splice(nextIndex, 1);
        }
      }
      try {
        await this.resetSerials(transaction, key);
      } catch (e) {
        sails.log.error(e);
      }
    }
  },

  revertReturnedSerials: async function(transaction, posParent) {
    if (!_.size(transaction.serials) || !transaction.is_return) {
      return;
    }
    const original = await PosTransaction.findOne({
      chain_code: transaction.chain_code,
      pointofsale: PosTransaction.getId(posParent)
    });
    for (const key in transaction.serials) {
      const returntedItems = transaction.serials[key].items;
      _.each(returntedItems, sku => {
        _.remove(original.serials[key].returned_serials, s => s === sku);
      });
    }
    await PosTransaction.saveAsync(original);
  },

  returnSerials: async function(transaction, posParent) {
    if (!_.size(transaction.serials) || !transaction.is_return) {
      return;
    }

    const original = await PosTransaction.findOne({
      chain_code: transaction.chain_code,
      pointofsale: PosTransaction.getId(posParent)
    });

    for (const key in transaction.serials) {
      const returntedItems = transaction.serials[key].items;
      original.serials[key].returned_serials =
        original.serials[key].returned_serials || [];
      original.serials[key].returned_serials.push(...returntedItems);
    }
    await PosTransaction.saveAsync(original);
  },

  buildCompleteState: async function(transaction, pos) {
    // throw new Error("KILL THIS TRANSACTION");
    try {
      await this.returnSerials(transaction, pos.parent);
    } catch (e) {
      sails.log.error(e);
      await this.revertReturnedSerials(transaction, pos.parent);
      throw new Error('There was an error processing returned serials');
    }

    try {
      await this.consumeSerials(transaction, pos.client);
    } catch (e) {
      sails.log.error(e);
      await this.revertReturnedSerials(transaction, pos.parent);
      throw new Error('There was an error reverting serials');
    }
  },

  finish: async function(transaction) {
    transaction.fullfilled = true;
    const saved = await PosTransaction.update(
      {
        id: PosTransaction.getId(transaction)
      },
      {
        fullfilled: true
      }
    );
    return saved;
  },

  resetAlarms: async function(node, schema, pos, req, res) {
    Node.resetAlarms(node);
    const saved = await Node.updateOrCreate()({
      params: node,
      schema: schema
    });
    Modules.node(req, {
      locals: {
        domain: Model.getId((pos.station || {}).domain),
        schema: schema,
        device: res.locals.device,
        siteData: res.locals.siteData
      }
    })(node);
    return saved;
  },

  completeNonServiceItems: async function(
    transaction,
    pos,
    node = {},
    logParams
  ) {
    let hasReturn = false;
    if (!node[logParams('service_item')]) {
      if (transaction.quantity <= 0 && pos.parent) {
        hasReturn = true;
        pos.parent.meta = pos.parent.meta || {};
        pos.parent.meta.returns = pos.parent.meta.returns || {};
        pos.parent.meta.returns[transaction.chain_code] =
          pos.parent.meta.returns[transaction.chain_code] || 0;
        pos.parent.meta.returns[transaction.chain_code] += Math.abs(
          transaction.quantity
        );
      }
      if (!transaction.is_return) {
        node[logParams('quantity_outgoing')] -= transaction.quantity;
      } else {
        node[logParams('quantity')] += Math.abs(transaction.quantity);
        node[logParams('quantity_incoming')] += transaction.quantity;
      }
    }
    return hasReturn;
  },

  consumeSerials: async function(transaction, client) {
    // const start = Date.now();
    const _serials = transaction.serials;
    const is_return = transaction.is_return;
    // const helpers = Module._helpers.logistics();
    // let casualties = false;
    const hasRq = await Requisition.assignRequisitionThroughPos(
      transaction,
      client
    );
    if (hasRq) {
      return;
    }

    for (const key in _serials) {
      // sails.log.debug("POS CHECKPOINT 4.2.0", Date.now() - start);
      const _serial = _serials[key];
      _serial.casualties = [];

      let scopedValues = {};
      try {
        if (is_return) {
          await this.incrementSerialsForCompleteTransaction(transaction);
        }
        const nodeSerialElements = await NodeSerial.restoreLeaveOrTerminate(
          _serial
        );
        scopedValues = {
          ...nodeSerialElements.scope
        };
      } catch (e) {
        sails.log.debug(e);
        await NodeSerial.revertNodeSerial(_serial);
        throw new Error('There was an error altering serialized nodes');
      }

      for (const sku in scopedValues) {
        const scope = scopedValues[sku];
        const serial = scope.serial;
        const sId = Model.getId(serial);

        if (sId && !transaction.assignment) {
          await StationAsset.assetRegister(
            serial,
            scope.node,
            transaction,
            client
          );
        }

        if (is_return) {
          if (transaction.assignment) {
            const aa = await AssetAssignment.returnAsset(transaction, serial);
            if (transaction.station_asset && aa) {
              await StationAsset.assignTransactionSerial(transaction, serial);
            }
          }
        } else if (!transaction.assignment) {
          await NodeSerial.garbageCollect(serial, _serial.casualties);
        }
      }

      if (_.size(_serial.casualties)) {
        await PosTransaction.saveAsync(transaction);
      }
    }
  },

  setSerialiser: async function(searchSchema) {
    const serialized = _.where(searchSchema.schema, {
      serializable: true
    });

    const serial_items = {};
    for (let j = 0; j < _.size(serialized); j++) {
      const serial = serialized[j];
      const ns = await NodeSchema.findOneById(serial.node);
      serial_items[serial.name] = {
        name: serial.name,
        schema: ns,
        required: serial.required
      };
    }

    return serial_items;
  },

  transactionSerials: function(serial_items, node) {
    const serials = {};
    for (const sName in serial_items) {
      const serial = serial_items[sName];
      const items = node[sName];
      for (const id in items) {
        const value = items[id];
        if (value) {
          serials[sName] = {
            id: NodeSchema.getId(serial.schema),
            param_name: sName,
            name: (serial.schema || {}).name,
            title: (serial.schema || {}).title,
            items: []
          };
          break;
        }
      }
    }
    return serials;
  },

  setWaitingParent: function(pos, is_return) {
    return async err => {
      if (err) {
        sails.log.error(err);
      }
      if (is_return && pos.parent) {
        const watingParent = await PointOfSale.findOneById(
          PointOfSale.getId(pos.parent)
        );
        if (watingParent.waiting) {
          const trans = await PosTransaction.find({
            pointofsale: PointOfSale.getId(pos),
            is_return: true
          });
          watingParent.waiting = !!_.size(trans);
          if (!watingParent.waiting) {
            watingParent.dependents.remove(PointOfSale.getId(pos));
            pos.parent = null;
            await PointOfSale.saveAsync(pos);
          }
          await PointOfSale.saveAsync(watingParent);
        }
      }
    };
  },

  beforeCreate: async function(values, next) {
    const pt = await PosTransaction.find({
      scan: values.scan,
      pointofsale: values.pointofsale,
      is_return: values.is_return || false
    });

    if (!values.chain_code) {
      values.chain_code = Tracker.buildRandomId('uuid');
    }

    if (_.size(pt)) {
      return next('errors.SCAN_MUST_BE_UNIQUE');
    }
    next();
  },

  beforeUpdate: async function(values, next) {
    // const pt = await PosTransaction.findOne({
    //     scan: values.scan,
    //     pointofsale: values.pointofsale
    // });

    // if (!pt) {
    //     return next('errors.TRANSACTION_NOT_FOUND');
    // }
    next();
  }
};
