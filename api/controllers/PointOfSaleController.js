/**
 * PointOfSaleController
 *
 * @description :: Server-side actions for handling incoming requests.
 * @help        :: See https://sailsjs.com/docs/concepts/actions
 */

const SailsExtensions = require('../services/SailsExtensions');

module.exports = {
  // sends a product dataset from {[schemaID]: [ nodeId, nodeId ]}
  itemNest: async function(req, res) {
    const params = req.params.all();
    const send = {};
    for (const schemaId in params) {
      if (!Number.isInteger(parseInt(schemaId))) {
        continue;
      }
      const nodeIds = params[schemaId] || [];
      if (!nodeIds || (Array.isArray(nodeIds) && !nodeIds.length)) {
        continue;
      }
      try {
        const nodeSchema = await NodeSchema.findOneById(schemaId);
        const nodes = await Node.findNodes(
          { where: { id: nodeIds } },
          nodeSchema
        );
        send[schemaId] = await PointOfSale.convertNodeItemsToProducts(
          nodes,
          nodeSchema,
          res.locals.siteData
        );
      } catch {
        continue;
      }
    }
    return res.send(send);
  },

  categories: async function(req, res) {
    const params = Utils.params(req);
    const schemaID = params.id;
    if (!schemaID) {
      return res.badRequest({ error: 'A schema ID is required' });
    }
    let schemas;
    try {
      schemas = await NodeSchema.find().where({ id: schemaID });
    } catch (e) {
      sails.log.error('PointOfSale::categories route:: ', e);
      return res.badRequest(e);
    }

    const send = {
      __meta: {}
    };
    for (let i = 0; i < _.size(schemas); i++) {
      const schema = schemas[i];
      const nodes = await PointOfSale.getAllItemForSchema(schema, req);
      const name = schema.name;
      send.__meta[name] = send.__meta[name] || {};
      send.__meta[name].count = await PointOfSale.getAllItemForSchemaCount(
        schema,
        req
      );
      send.__meta[name].label = schema.title || name;
      // now stuff the items
      send[name] = await PointOfSale.convertNodeItemsToProducts(
        nodes,
        schema,
        res.locals.siteData
      );
    }
    return res.send(send);
  },

  serialize: async function(req, res) {
    const params = req.params.all();
    const method = req.method;

    try {
      PointOfSale.validateSerialRequest(params);
    } catch (e) {
      sails.log.error('SERIAL CHECK ERROR', e);
      return res.badRequest({
        error: e.message
      });
    }
    const errors = PointOfSale.errorMessages();
    const scan = params.scan;
    const serial = params.serial;
    serial.items = serial.items || [];
    const transaction = await PosTransaction.findOneById(
      params.transaction
    ).populate('schema');
    if (!transaction) {
      return res.badRequest({
        error: errors.VALID_TRANSACTION_REQUIRED
      });
    }
    if (Utils.leastOne(method, 'DELETE')) {
      try {
        await PosTransaction.singleSerialDestroy(transaction, serial, scan);
        return res.send(transaction);
      } catch (e) {
        return res.badRequest({ error: e.message });
      }
    }

    try {
      const elements = await PointOfSale.getSerilizableElements(
        transaction,
        params
      );
      PointOfSale.validateNotUnique(elements);
      await PointOfSale.applySeachField(elements);
      await PointOfSale.constructSerialItem(elements);
      await PointOfSale.packageSerialToTransaction(elements);
      res.send(serial);
    } catch (e) {
      sails.log.error(e);
      return res.badRequest({ error: e.message });
    }
  },

  returns: async function(req, res) {
    const params = req.params.all();
    let pos;
    try {
      pos = await PointOfSale.getPosForTransactions(params);
    } catch (e) {
      return res.badRequest({ error: e });
    }
    const station = params.station;
    const priorReturn = await PointOfSale.findOne({
      parent: params.id,
      complete: false
    }).populateAll();

    if (!priorReturn) {
      const replication = await PointOfSale.buildPosCloneForReturn(pos, req);
      const aReturn = replication.pos;
      pos.waiting = true;
      pos.dependents.add(PointOfSale.getId(aReturn));
      let hasOne = false;
      for (let i = 0; i < _.size(replication.transactions); i++) {
        const t = replication.transactions[i];
        const thisStation = Station.getId(aReturn.station);
        const tran = await PosTransaction.findOneById(t);
        const transaction = SailsExtensions.cloneModel(tran);
        await PosTransaction.stripReturnedSerials(transaction, tran);
        if (!(await Station.hasNodeSchema(thisStation, transaction.schema))) {
          continue;
        }
        PointOfSale.setChainQuantity(pos, transaction);
        if (transaction.quantity <= 0) {
          continue;
        }
        hasOne = true;
        const node = await PointOfSale.increaseTransactionalNodeElements(
          transaction,
          station
        );
        PosTransaction.returnSetUp(transaction, node, thisStation, aReturn);
        const createdTransaction = await PosTransaction.create(transaction);
        aReturn.transactions.add(PosTransaction.getId(createdTransaction));
      }

      if (!hasOne) {
        return await PointOfSale.noAvailableTransactionError(aReturn, pos, res);
      }

      await PointOfSale.saveAsync(pos);
      const settings = await pos.getSettings();
      await PointOfSale.applyTransactionCosts(
        PointOfSale.getId(aReturn),
        aReturn,
        settings
      );
      await PointOfSale.saveAsync(aReturn);
      return await PointOfSale.sendPosWithSession(aReturn, req, res);
    } else {
      return await PointOfSale.sendPosWithSession(priorReturn, req, res);
    }
  },

  send_reciept: async function(req, res) {
    const params = req.params.all();
    let pos;
    try {
      pos = await PointOfSale.getPosForTransactions(params);
    } catch (e) {
      return res.badRequest({ error: e });
    }
    pos.alt_email = params.email;
    Jobs.posTransactionEmail.add(pos);
    res.ok();
  },

  tender_approval: async function(req, res) {
    const params = req.params.all();
    const errors = PointOfSale.errorMessages();
    if (!params.pos || !PointOfSale.getId(params.pos)) {
      return res.send({
        error: errors.POS_MODEL_REQUIRED
      });
    }

    if (!_.size(params.approvals)) {
      return res.send({
        error: errors.AT_LEAST_ONE_APPROVAL
      });
    }
    // simulated lets us test automatic approvals in a test env.
    for (let i = 0; i < _.size(params.approvals); i++) {
      const tender = params.approvals[i];
      const simulated = params.simulation && process.env.NODE_ENV === 'test';
      try {
        await PointOfSale.sendForApproval(tender, params.pos, simulated);
      } catch (e) {
        sails.log.error(e);
        return res.send({
          error: e.message
        });
      }
    }

    let pos;

    try {
      pos = await PointOfSale.findOneById(
        PointOfSale.getId(params.pos)
      ).populateAll();
      // await pos.setClient();
    } catch (e) {
      return res.send({
        error: e
      });
    }

    if (!pos) {
      return res.send({
        error: errors.INVALID_POS_TRANSACTION
      });
    }

    pos.pending_approval = true;
    // commented, why?
    await PointOfSale.saveAsync(pos);
    res.send(pos);
  },

  unset: async function(req, res) {
    const params = req.params.all();
    const errors = PointOfSale.errorMessages();
    if (!params.action) {
      return res.badRequest({
        error: errors.UNSET_ACTION_REQUIRED
      });
    }
    let payload;
    switch (params.action) {
      case 'cost_code':
        try {
          payload = await CostApproval.invalidate(params.token);
        } catch (e) {
          return res.serverError(e);
        }
        break;
      case 'credit_card':
        break;
    }

    res.send(payload);
  },

  cost_approval: async function(req, res) {
    const params = req.params.all();
    const pos = params.pos;
    const payment = params.payment;
    const errors = PointOfSale.errorMessages();
    if (!_.size(pos) || !_.size(payment)) {
      return res.badRequest({
        error: errors.POS_AND_PAYMENT_REQUIRED
      });
    }

    const p = await PointOfSale.findOneById(
      PointOfSale.getId(pos)
    ).populateAll(); // .populate('station').populate('schema');

    if (!p) {
      return res.badRequest({
        error: errors.VALID_POS_OBJECT
      });
    }

    let send;
    switch (payment.key) {
      case 'cost_code':
        try {
          const approval = await PointOfSale.costCode({
            pos: pos,
            pointofsale: p,
            payment: payment
          });
          send = {
            rejections: (approval.meta || {}).rejections,
            approved: approval.approved,
            token: approval.issue('7d')
          };
        } catch (e) {
          sails.log.error(e);
          return res.serverError(e);
        }
        return res.send(send);

      case 'credit_card':
        break;
      case 'payroll':
        break;
      default:
        return res.badRequest({
          error: errors.INVALID_PAYMENT_TYPE
        });
    }
    /*
    Conditions for apporval. There are the indidual approvals for users
    and the const code approval credit card approvals. We once approved,
    we can generate a token that is a json web token based on the token id.
    */
    res.send({});
  },

  /*
  Item requests for out-of-stock items
  */
  request: async function(req, res) {
    const params = req.params.all();
    const method = req.method;
    const errors = PointOfSale.errorMessages();
    if (method === 'POST') {
      const pos = params.pos;
      const product = params.product;
      if (!_.size(pos) || !_.size(product)) {
        return res.badRequest({
          error: errors.POS_AND_ITEM_REQUIRED
        });
      }
      const request = await StockNotification.create({
        station: pos.station,
        user: pos.client || User.getId(req.user),
        user_type: pos.client_type || 'user',
        schema: pos.schema,
        description: product.description,
        item: product.sku
      });
      return res.send(request);
    } else if (method === 'DELETE') {
      if (!params.id) {
        return res.badRequest({
          error: errors.ID_PARAMETER_IS_REQUIRED
        });
      }
      const request = await StockNotification.destroy({
        id: params.id
      });
      return res.send(request);
    } else if (method === 'PUT') {
      return res.serverError({
        error: errors.NOT_YET_IMPLEMENTED
      });
    }

    const allActive = await StockNotification.find({
      // station: params.station,
      // schema: params.schema,
      user: params.client || User.getId(req.user),
      user_type: params.client_type || 'user',
      pending: true
    });
    res.send(allActive);
  },

  complete: async function(req, res) {
    const params = req.params.all();
    const errors = PointOfSale.errorMessages();
    if (!params.id) {
      return res.badRequest({
        error: errors.ID_PARAMETER_IS_REQUIRED
      });
    }
    let pos = await PointOfSale.findOneById(params.id).populateAll();

    if (!pos) {
      return res.serverError({
        error: errors.INVALID_POS_ID
      });
    }

    if (pos.complete) {
      return res.badRequest({
        error: errors.TRANSACTION_ALREADY_PROCESSED
      });
    }

    const files = [];
    try {
      await PointOfSale.finalizeTender(params, pos, files);
    } catch (e) {
      return res.badRequest({ error: e });
    }

    /*
        Now we have to adjust the inventory
      */
    let hasReturn = false;
    // let parentTransaction;
    const helpers = Module._helpers.logistics();
    for (let i = 0; i < _.size(pos.transactions); i++) {
      const transaction = pos.transactions[i];
      try {
        const nodeSchema = await NodeSchema.findOneById(transaction.schema);
        if (!nodeSchema) {
          throw new Error(errors.ERROR_PROCESSING_REQUEST);
        }
        const logParams = helpers.logParams(nodeSchema.schema);
        const node = await Node.findOneById(transaction.node, nodeSchema);
        if (!node) {
          throw new Error(errors.ERROR_PROCESSING_REQUEST);
        }

        // sails.log.debug("POS CHECKPOINT 4.2", Date.now() - start);
        hasReturn = await PosTransaction.completeNonServiceItems(
          transaction,
          pos,
          node,
          logParams
        );
        await PosTransaction.buildCompleteState(transaction, pos, node);
        // move down
        await PosTransaction.finish(transaction);
        await PosTransaction.resetAlarms(node, nodeSchema, pos, req, res);
      } catch (e) {
        sails.log.error(e);
        await PointOfSale.rollBack(params.tender, pos);
        return res.badRequest({
          error: errors.ERROR_PROCESSING_REQUEST
        });
      }
      // was here
    }
    if (hasReturn) {
      try {
        pos.parent.waiting = await PointOfSale.stillWaiting(pos.parent, pos);
        pos.parent.return_block = true;
        PointOfSale.saveAsync(new PointOfSale._model(pos.parent));
      } catch (e) {
        sails.log.error(e);
        await PointOfSale.rollBack(params.tender, pos);
        return res.send({
          error: errors.ERROR_PROCESSING_TRANSACTION
        });
      }
    }
    // const settings = (pos.station.settings || {}).pos || {};
    const settings = await pos.getSettings();

    if (settings.auto_email_receipt) {
      Jobs.posTransactionEmail.add(pos);
    }
    pos = await PointOfSale.finishTransaction(pos, files, req);
    if (pos.workorder) {
      await WorkOrder.closeWorkorder(pos, req.user, true);
    }

    res.send(pos);
  },

  products: async function(req, res) {
    const params = req.params.all();
    const errors = PointOfSale.errorMessages();
    const page = params.page || 1;
    if (!_.size(params.pos)) {
      return res.badRequest({
        error: errors.POS_MODEL_REQUIRED
      });
    }
    const schemaID = params.pos.schema;
    const stationID = params.pos.station;
    if (!schemaID) {
      return res.badRequest({
        error: errors.VALID_NODE_SCHEMA_PARAM_REQUIRED
      });
    }
    if (!stationID) {
      return res.badRequest({
        error: errors.VALID_STATION_PARAM_REQUIRED
      });
    }

    if (schemaID === -1) {
      return PointOfSale.searchAllInventory(req, res);
    }

    const schema = await NodeSchema.findOneById(schemaID);
    if (!schema) {
      return res.badRequest({
        error: errors.NODE_SCHEMA_IS_INVALID
      });
    }

    const helpers = Module._helpers.logistics();
    const inventory = (schema.applications || {}).inventory;
    const selectedIventory = params.inventory || {};
    const inventoryIDs = [];
    const p = _.clone(params);
    delete p.pos;
    delete p.inventory;
    delete p.searchText;
    if (!_.size(inventory) && !params.po) {
      return res.send({});
    }

    const station = await Station.findOneById(stationID);
    if (!station) {
      return res.badRequest({
        error: errors.STATION_IS_INVALID
      });
    }
    const ss = await StationSchema.findOneById(station.station_type).populate(
      'nodes'
    );
    const availableNodes = {};

    _.each(ss.nodes, n => {
      availableNodes[n.id] = true;
    });
    const iterate = params.po ? selectedIventory : inventory;
    _.each(iterate, (has, k) => {
      if (
        has &&
        availableNodes[k] &&
        (selectedIventory[k] || !_.size(selectedIventory))
      ) {
        inventoryIDs.push(k);
      }
    });

    const searchSchemas = await NodeSchema.find({
      id: inventoryIDs
    });
    if (!_.size(searchSchemas)) {
      return res.send({});
    }

    const maxPerNode = PointOfSale.getInventoryMaxPerNode(
      params.limiter,
      params.limit,
      _.size(searchSchemas)
    );

    const response = {
      // __counts: {},
      __meta: {},
      __max: maxPerNode
    };

    p.where = p.where || {};
    p.where.station = stationID;
    const serviceOnly = p.serviceOnly;
    const noSerice = p.noService;

    p.limit = maxPerNode;
    p.skip = maxPerNode * (page - 1);

    for (let i = 0; i < _.size(searchSchemas); i++) {
      const s = searchSchemas[i];

      const logParams = helpers.logParams(s.schema);

      if (params.searchText) {
        if (_.size(p.where.or)) {
          p.where.or.length = 0;
        }
        Node.textSearchQuery(params.searchText, p.where, s, true);
      }

      if (serviceOnly) {
        p.where[logParams('service_item')] = true;
      } else if (params.noService && logParams('service_item')) {
        const ors = [
          { [logParams('service_item')]: false },
          { [logParams('service_item')]: null }
        ];
        if (!_.size(p.where.or)) {
          p.where.or = [...ors];
        } else {
          // the api has issues handling this query with multiple ors
          // need programatic solution
        }
      }

      const name = s.name;
      response[name] = [];
      response.__meta[name] = response.__meta[name] || {};
      response.__meta[name].schema = NodeSchema.getId(s);
      response.__meta[name].label = s.title || name;
      response.__meta[name].page = page;
      delete p.noService;
      delete p.serviceOnly;
      delete p.po;

      p.sort = {
        [logParams('name')]: 'ASC'
      };

      const nodes = await Node.findNodes(p, s);
      response.__meta[name].count = await PointOfSale.getCountsByQuery(
        p.where,
        s
      );
      // response.__counts[name] = response.__meta[name].__count;

      const serviceParam = logParams('service_item');
      for (let j = 0; j < _.size(nodes); j++) {
        const n = nodes[j];
        if (
          serviceParam &&
          ((n[logParams('service_item')] && noSerice) ||
            (!n[logParams('service_item')] && serviceOnly))
        ) {
          continue;
        }

        const posProducts = await PointOfSale.convertNodeItemsToProducts(
          [n],
          s,
          res.locals.siteData
        );

        response[name].push(...posProducts);
      }
    }
    res.send(response);
  },

  pricechange: async function(req, res) {
    const params = req.params.all();
    const errors = PointOfSale.errorMessages();
    if (!User.is(req.user, Roles.MANAGER)) {
      return res.forbidden({
        error: errors.PERMISSION_PRICE_OVERRIDE
      });
    }

    if (!params.id) {
      return res.badRequest({
        error: errors.ID_PARAMETER_IS_REQUIRED
      });
    }

    if (params.change === null || !params.by) {
      return res.badRequest({
        error: errors.CHANGE_CONTEXT_REQUIRED
      });
    }

    const transaction = await PosTransaction.findOneById(params.id)
      .populate('schema')
      .populate('pointofsale');
    if (!transaction) {
      return res.badRequest({
        error: errors.TRANSACTION_NOT_FOUND
      });
    }

    let pos = new PointOfSale._model(_.clone(transaction.pointofsale));

    const settingsSchema = await NodeSchema.findOneById(
      NodeSchema.getId(transaction.pointofsale.schema)
    );
    const settings = settingsSchema.applications;
    const searchSchema = transaction.schema; // await NodeSchema.findOneById(transaction.schema);
    const node = await Node.findOneById(transaction.node, searchSchema);

    const helpers = Module._helpers.logistics();
    const logParams = helpers.logParams(searchSchema.schema);
    const retailCost = logParams('retail_cost');

    transaction.has_price_override = true;
    transaction.retail_cost = params.change || 0;
    transaction.price_override_by = params.by;
    transaction.price_override = (params.change || 0) - (node[retailCost] || 0);
    transaction.total_retail_cost = Utils.fixValue(
      transaction.retail_cost * transaction.quantity,
      PosTransaction.wantsRounding(),
      2
    );

    await PosTransaction.saveAsync(transaction);

    const posId = PointOfSale.getId(transaction.pointofsale);
    await PointOfSale.applyTransactionCosts(posId, pos, settings);

    pos.has_price_overrides = true;
    pos.price_overrides = pos.price_overrides || {};
    pos.price_overrides[params.id] = {
      price_override_by: params.by,
      price_override: params.change,
      transaction: params.id
    };

    await PointOfSale.saveAsync(pos);
    pos = await PointOfSale.findOneById(
      PointOfSale.getId(transaction.pointofsale)
    ).populateAll();
    // await pos.setClient();
    res.send(pos);
  },

  session: async function(req, res) {
    const params = req.params.all();
    if (params.clear) {
      req.session.posTransaction = null;
    }
    let pos = null;
    if (
      req.session.posTransaction &&
      req.session.posTransaction[params.station] &&
      req.session.posTransaction[params.station][params.schema]
    ) {
      const pId = req.session.posTransaction[params.station][params.schema];
      pos = await PointOfSale.findOneById(pId).populateAll();
      if (!pos) {
        req.session.posTransaction[params.station] = null;
      }
    }
    res.send(pos);
  },

  scan: async function(req, res) {
    const params = req.params.all();
    const method = req.method;
    const errors = PointOfSale.errorMessages();
    sails.log.debug('PointOfSalesController.scan:: EXECUTING SCAN ', params);
    if (!params.id && (!params.station || !params.schema)) {
      return res.badRequest({
        error: errors.INVALID_REQUIRE_PARAMETERS
      });
    }
    PointOfSale.resetSession(req);
    const settings = await PointOfSale.getNodeSchemaSettingsThroughReq(req);
    // const scan = params.scan;

    let pos;
    try {
      pos = await PointOfSale.posThroughReq(req);
      if (!pos) {
        return res.serverError({
          error: errors.POS_MODEL_NOT_GENERATED
        });
      }
      const forward = await PointOfSale.checkForwardUserChange(pos, params);
      if (!forward) {
        return await PointOfSale.sendPosWithSession(pos, req, res);
      }
    } catch (e) {
      sails.log.error(e);
      return await PointOfSale.sendErrorWithSession(e, pos, req, res); // res.serverError({ error: e });
    }
    if (Utils.leastOne(method, 'PUT', 'POST')) {
      let elements;
      try {
        elements = await PointOfSale.getNodeElements(pos, params, settings);
        if (!elements.node) {
          return await PointOfSale.sendPosWithSession(pos, req, res);
        }
      } catch (e) {
        return await PointOfSale.sendErrorWithSession(e, pos, req, res);
      }

      PointOfSale.nodeQuantitySetup(elements);
      await PointOfSale.buildTransaction(elements, pos, params);
      PosTransaction.setTransactionQuantity(elements, params, req.method);
      PosTransaction.setRetailCost(elements);

      try {
        await PosTransaction.alterNodeValues(elements, params);
        await PointOfSale.finalizePosTransaction(elements, settings, pos);
      } catch (e) {
        return await PointOfSale.sendErrorWithSession(e, pos, req, res);
      }
    } else if (Utils.leastOne(method, 'DELETE')) {
      /*
      Here we want to delete a scanned item
      */
      const is_return = params.quantity < 0;
      const transaction = await PosTransaction.transactionalContext(
        params,
        pos
      );
      if (!transaction) {
        return await PointOfSale.sendPosWithSession(pos, req, res);
      }
      const wait = PosTransaction.setWaitingParent(pos, is_return);
      const t = transaction.toObject();
      transaction.destroy(wait);
      await PosTransaction.incrementSerials(t);
      PointOfSale.setPriceOverrides(pos, t);
      const elements = await PointOfSale.reduceTransactionalNodeElements(t);
      await PointOfSale.finializeTransactionalRemoval(elements, settings, pos);
    }
    await PointOfSale.sendPosWithSession(pos, req, res);
  }
};
