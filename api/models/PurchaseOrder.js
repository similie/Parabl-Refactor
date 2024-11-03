/**
 * PurchaseOrder.js
 *
 * @description :: A model definition.  Represents a database table/collection/etc.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */
const {
  PurchaseOrderUtility
} = require('../model-utilities/purchase-orders/purchase-order');
// @TODO: Refactor to CommonUtils in similie-api-services module
const { TimeUtils } = require('similie-api-services');
const SailsExtensions = require('../services/SailsExtensions');

const tz = TimeUtils.constants.timeZone;
const now_ = TimeUtils.constants.now_;
const TimePeriod = TimeUtils.constants.ENUMS.timePeriods;

const poStates = PurchaseOrderUtility.poStates();

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    /*
     * This parameter is the name field
     */
    name: {
      type: 'string'
    },

    priority: {
      type: 'integer',
      defaultsTo: 2,
      min: 1,
      max: 3
    },

    transaction_id: {
      type: 'string',
      unique: true
    },
    /*
     * The type of entity we are adding to
     */
    identity: {
      type: 'string',
      defaultsTo: 'node'
    },
    // internal, external, onward
    scope: {
      required: true,
      type: 'string',
      in: ['internal', 'external', 'onward']
    },
    /*
     * The station to send items.
     */
    from: {
      type: 'string'
      // required: true
    },
    /*
     * The string to recieve items.
     */
    to: {
      type: 'string',
      required: true
    },

    from_address: 'text',
    to_address: 'text',

    request_memo: 'text',
    rejection_memo: 'text',
    /*
     * The state of order
     */
    state: {
      type: 'string',
      in: [
        'pending',
        'evaluating',
        'rejected',
        'approved',
        'processing',
        'shipped',
        'received',
        'complete',
        'timeout'
      ]
    },

    direction: {
      type: 'string',
      in: ['incoming', 'outgoing']
    },
    /*
     * The user id who made the request.
     */
    requester: {
      model: 'user'
    },

    opperators: {
      collection: 'user'
    },

    last_active: {
      model: 'user'
    },

    approver: {
      model: 'user'
    },

    completed_by: {
      model: 'user'
    },
    /*
     * The unix timestamp to be requested.
     */
    last_activity: {
      type: 'datetime'
    },

    fullfilment_date: {
      type: 'datetime'
    },
    /*
     * The collections of POS.
     */
    items: {
      type: 'array'
    },

    vendors: {
      collection: 'vendorledger'
    },
    /*
     * The integer id value of the schema that's been.
     * defined above model attribute.
     */
    schema: {
      type: 'integer',
      required: true
    },

    station: {
      model: 'station',
      required: true
    },

    parent: {
      model: 'purchaseorder'
    },

    onward_children: {
      collection: 'purchaseorder'
    },

    approval_files: {
      collection: 'sysfile',
      through: 'po_appr_files'
    },

    request_files: {
      collection: 'sysfile',
      through: 'po_req_files'
    },

    shipment_files: {
      collection: 'sysfile',
      through: 'po_ship_files'
    },

    customs_files: {
      collection: 'sysfile',
      through: 'po_cust_files'
    },

    locked: {
      type: 'boolean',
      defaultsTo: false
    },

    weight: {
      type: 'integer',
      defaultsTo: 0
    },

    domain: {
      model: 'domain'
    },
    // anything else
    meta: {
      type: 'json'
    }
  },
  _processors: [
    {
      name: 'purchaseorderRevertPurchaseOrders',
      process: async function(job) {
        const data = job.data;
        const po = new PurchaseOrderUtility(data);
        return po.moveRevert();
      },

      stats: SailsExtensions.stats({
        completed: function() {
          // sails.log.debug('All Surveys managed');
        },
        failed: function(job, err) {
          console.error('JOB purchaseorderRevertPurchaseOrders ERROR::', err);
          // Utils.sendexcelMessage(err, job.data);
        },
        stalled: function(job) {
          sails.log.debug('purchaseorderRevertPurchaseOrders STALL::', job);
        }
      })
    },
    {
      name: 'purchaseorderMoveCompleteExternal',
      process: async function(job) {
        // [AS] currently not used
        const data = job.data;
        const po = data.po;
        const _po = new PurchaseOrderUtility(po);
        return _po.moveCompleteExternal();
      },

      stats: SailsExtensions.stats({
        completed: function() {
          // sails.log.debug('JOB purchaseorderMoveComplete: move complete ');
        },
        failed: function(job, err) {
          console.error('JOB purchaseorderMoveComplete ERROR::', err);
          // Utils.sendexcelMessage(err, job.data);
        },
        stalled: function(job) {
          sails.log.debug('purchaseorderMoveComplete STALL::', job);
        }
      })
    },

    {
      name: 'purchaseorderMoveComplete',
      process: async function(job) {
        const data = job.data;
        const _po = data.po;
        const po = new PurchaseOrderUtility(_po);
        return po.moveComplete();
      },

      stats: SailsExtensions.stats({
        completed: function() {
          // sails.log.debug('All Surveys managed');
        },
        failed: function(job, err) {
          console.error('JOB purchaseorderMoveComplete ERROR::', err);
          // Utils.sendexcelMessage(err, job.data);
        },
        stalled: function(job) {
          sails.log.debug('purchaseorderMoveComplete STALL::', job);
        }
      })
    },

    {
      name: 'purchaseorderTempConvertInventory',
      process: async function(job) {
        const po = new PurchaseOrderUtility(job.data);
        return po.moveTemp();
      },

      stats: SailsExtensions.stats({
        completed: function() {
          // noop
        },
        failed: function(job, err) {
          console.error('JOB purchaseorderTempConvertInventory ERROR::', err);
        },
        stalled: function(job) {
          sails.log.debug('purchaseorderTempConvertInventory STALL::', job);
        }
      })
    },

    {
      name: 'purchaseorderTimeout',
      process: async function() {
        const daysAgo = process.env.PURCHASE_ORDER_TIMEOUT || 30;
        const dateString = TimeUtils.date(now_)
          .minus(daysAgo, TimePeriod.days)
          .tz(tz).toSQL;
        // originally this was month first DateTime format with timezone.

        const query = `UPDATE "public"."purchaseorder"
          SET "state" = '${poStates.TIMEOUT}'
          WHERE 'updatedAt' < '${dateString}'
          AND "state" <> '${poStates.APPROVED}'
          AND "state" <> '${poStates.COMPLETE}'
          AND "state" <> '${poStates.TIMEOUT}'
          AND "state" <> '${poStates.SHIPPED}'
          AND "state" <> '${poStates.RECEIVED}'
          AND "state" <> '${poStates.REJECTED}'`;
        sails.log.debug('RUNNING THE PO TIMEOUT', query);
        PurchaseOrder.query(query, err => {
          if (err) {
            sails.log.error(err);
          }
          // sails.log.debug("DAILY PURCHASE ORDER PROCESSOR:::", data.rows);
          /*
          NOW WE NEED TO ROLL BACK INVENTORY
          */
        });
        return new Promise(function(resolve) {
          resolve();
        });
      },

      stats: SailsExtensions.stats({
        completed: function() {
          // sails.log.debug('All Surveys managed');
        },
        failed: function(job, err) {
          console.error('JOB purchaseorderTimeout ERROR::', err);
          // Utils.sendexcelMessage(err, job.data);
        },
        stalled: function(job) {
          sails.log.debug('purchaseorderTimeout STALL::', job);
        }
      })
    },

    {
      name: 'purchaseorderChangeBlast',
      process: async function(job) {
        const data = job.data;
        const _message = data.message;
        const po = data.po;
        const change = data.change;
        const action = data.action;
        const message = _message || {};
        const _po = await PurchaseOrder.findOneById(
          PurchaseOrder.getId(po)
        ).populateAll();
        const key = await PurchaseOrderUtility.pullSocketTrackerId();
        const sendMessage = {
          purchaseOrder: _po,
          changeState: change,
          action: action || 'update',
          message: message.text,
          category: message.category,
          key: key
        };
        PurchaseOrderUtility.sendUpdateMessageToBothParties(_po, sendMessage);
      },

      stats: SailsExtensions.stats({
        completed: function() {
          // sails.log.debug('All Surveys managed');
        },
        failed: function(job, err) {
          console.error('JOB purchaseorderChangeBlast ERROR::', err);
          // Utils.sendexcelMessage(err, job.data);
        },
        stalled: function(job) {
          sails.log.debug('purchaseorderChangeBlast STALL::', job);
        }
      })
    },

    {
      name: 'purchaseorderInvoice',
      process: async function(job) {
        const data = job.data;
        const po = data.po;
        const cost = data.cost;
        const currency = data.currency;
        const domain = data.domain;
        const to = data.to;
        const from = data.from;

        try {
          await CostCode.invoice({
            from: from || po.to, // money coming from the to station
            to: to || po.from, //  model going to the from station
            amount: cost,
            currency: currency,
            domain: Domain.getId(domain),
            entity: 'purchase_order'
          });
        } catch (e) {
          sails.log.error(e);
        }
      },

      stats: SailsExtensions.stats({
        completed: function() {
          // sails.log.debug('All Surveys managed');
        },
        failed: function(job, err) {
          console.error('JOB purchaseorderInvoice ERROR::', err);
          // Utils.sendexcelMessage(err, job.data);
        },
        stalled: function(job) {
          sails.log.debug('purchaseorderInvoice STALL::', job);
        }
      })
    }
  ],

  _timers: [
    {
      interval: Const.timers.DAILY,
      name: 'purchaseorder_timeout',
      action: function() {
        return {
          do: function() {
            // add a delay of 4 minutes
            // for midnight to work
            Jobs.purchaseorderTimeout.add();
          }
        };
      }
    }
  ],

  getStates: function() {
    return PurchaseOrderUtility.poStates();
  },

  blastChange: async function(po, change, action, message) {
    if (Site.isInTestMode()) {
      return;
    }
    Jobs.purchaseorderChangeBlast.add({
      po: po,
      change: change,
      action: action,
      message: message
    });
  },

  states: function(state) {
    if (state) return poStates[state];
    return _.clone(poStates);
  },

  afterDestroy: async function(values, next) {
    const _values = _.isArray(values) ? values : [values];
    const key = await PurchaseOrderUtility.pullSocketTrackerId();
    const messagePart = { changeState: 'destroy', action: 'destroy', key: key };
    _values.forEach(po => {
      const message = {
        purchaseOrder: po,
        ...messagePart
      };
      PurchaseOrderUtility.sendUpdateMessageToBothParties(po, message);
    });
    next();
  },

  moveRevert: async function(po) {
    if (Site.isInTestMode()) {
      const _po = new PurchaseOrderUtility(po);
      return _po.moveRevert();
    } else {
      Jobs.purchaseorderRevertPurchaseOrders.add(po);
    }
  },

  beforeDestroy: async function(values, next) {
    const id = values.id || (values.where || {}).id;
    if (!id) {
      return next();
    }
    const po = await PurchaseOrder.findOneById(id);
    const state = po.state;

    const restrictedStates = [
      poStates.COMPLETE,
      poStates.PENDING,
      poStates.EVALUATING,
      poStates.TIMEOUT
    ];
    if (_.indexOf(restrictedStates, state) !== -1) {
      return next("You cannot destroy a purchase order in it's current state");
    }
    const daysAgo = process.env.PURCHASE_ORDER_TIMEOUT || 30;
    const thirtyDaysAgo = TimeUtils.date(now_).minus(daysAgo, TimePeriod.days);
    const isStale = TimeUtils.date(po.updatedAt).isBefore(thirtyDaysAgo);

    if (!isStale && !Site.isInTestMode()) {
      return next(
        `You cannot destroy a PO that has been updated withing the last ${daysAgo} days`
      );
    }
    await this.moveRevert(_.clone(po));

    next();
  },

  afterUpdate: async function(values, next) {
    if (!values.id) {
      return next();
    }
    const po = new PurchaseOrderUtility(values);
    switch (values.state) {
      case poStates.APPROVED:
        await po.pendingState();
        break;
      case poStates.SHIPPED:
        await po.shippedState(values);
        break;
      case poStates.COMPLETE:
        await po.completeState(values);
        break;
      default:
        await this.blastChange(values, values);
    }
    next();
  },

  beforeValidate: function(values, next) {
    if (values.lock_request) {
      delete values.lock_request;
      values.locked = true;
    }
    next();
  },

  beforeUpdate: async function(values, next) {
    if (!values.id) {
      return next();
    }
    if (values.meta) {
      switch (values.state) {
        // we do this to handle the bounce back effect of the states
        case poStates.PENDING:
          values.meta.last_state = poStates.PENDING;
          break;
        case poStates.REJECTED:
          values.meta.last_state = poStates.PENDING;
          break;
        // case states.APPROVED:
        //   values.meta.last_state = poStates.APPROVED;
        //   break;
        /*
         *  we handle the approved state on afterUpdate
         */
        case poStates.PROCESSING:
          values.meta.last_state = poStates.APPROVED;
          break;
        case poStates.SHIPPED:
          // values.meta.last_state = poStates.PROCESSING;
          break;
        case poStates.RECEIVED:
          values.meta.last_state = poStates.SHIPPED;
          break;
        case poStates.COMPLETE:
          values.meta.last_state = poStates.RECEIVED;
          break;
      }
    }
    next();
  },

  setStationsToCopy: async function(po) {
    const stations = await Station.find({
      station_id: [po.from, po.to]
    });
    const _po = _.cloneDeep(po);
    _.each(stations, s => {
      if (s.station === po.from) {
        _po.from_station = s.id;
      } else {
        _po.to_station = s.id;
      }
    });
    return _po;
  },

  costCode: async function(values, doNotCreateAnother = false) {
    if (!values.id || values.scope === 'external' || values.locked) return;

    const po = await PurchaseOrder.findOneById(values.id).populateAll();
    const _po = await this.setStationsToCopy(po);
    // we need to consider this. It could be from the from/to stations
    // not the initiating station. For simplicity, we are setting it up this way
    let state = poStates.PENDING;
    const cost_code = _po.station.station_id;
    const params = { purchaseorder: _po };
    const approved = await CostRule.iterateAncestors(
      cost_code,
      'purchaseorder',
      params,
      po.meta.cost_approvals
    );
    if (approved) {
      await PurchaseOrder.update({ id: PurchaseOrder.getId(po) }, { state });
    } else if (!doNotCreateAnother) {
      state = poStates.EVALUATING;
      await this.applyRejectedRequests(values, state, params);
    }

    this.blastChange({ ...po, state }, { state }, 'statechange');

    return approved;
  },

  applyRejectedRequests: async function(po, state, params) {
    const rejections = params.rejections || [];
    po.meta.approval_requests = po.meta.approval_requests || [];
    for (const rejection of rejections) {
      const co_request = await CostRequest.create(
        PurchaseOrderUtility.costRequestTemplate(po, rejection)
      );
      po.meta.approval_requests.push(this.getId(co_request));
    }
    await PurchaseOrder.update(
      { id: this.getId(po) },
      { meta: po.meta, state }
    );
  },

  buildApproval: async function(station_id) {
    const rule = await Rule.findOne({ entity: 'purchaseorder' });
    const userCan = Utils.parseLocals(`${rule.actors.initiator.query}`, {
      action: 'is',
      arr: `["${station_id}"]`
    });
    return {
      query: userCan,
      for: station_id
    };
  },

  setApproval: async function(cr, po) {
    const _cc = po.station.station_id;
    const userCan = await PurchaseOrder.buildApproval(_cc);
    const rule = await CostRule.findOneById(CostRule.getId(cr.rule));
    const rTemplate = PointOfSale.buildCan(rule, userCan);
    rTemplate.until_date = cr.expires_on;
    const meta = po.meta;
    const _cr = await CostRule.create(rTemplate);
    meta.release_rules = meta.release_rules || [];
    meta.release_rules.push(CostRule.getId(_cr));
    await PurchaseOrder.update(
      {
        id: PurchaseOrder.getId(po)
      },
      {
        meta: meta
      }
    );
    return cr;
  },

  removeStaleRules: async function(po) {
    for (let i = 0; i < _.size(po.meta.release_rules); i++) {
      const r = po.meta.release_rules[i];
      await CostRule.destroyAsync({
        id: r
      });
    }
  },

  setRequestApprovalAsValid: async function(cr) {
    const po = await PurchaseOrder.findOneById(cr.target).populateAll();
    po.meta.cost_approvals = po.meta.cost_approvals || [];
    po.meta.cost_approvals = _.union(po.meta.cost_approvals, [cr.costcode]);
    await PurchaseOrder.saveAsync(po);
    let checked = false;
    const iterateOnce = async () => {
      const approved = await this.costCode(po, !checked);
      if (!approved) {
        await this.setApproval(cr, po);
        if (!checked) {
          checked = true;
          return await iterateOnce();
        }
      } else {
        await this.removeStaleRules(po);
      }
    };

    await iterateOnce();
  },

  setRequestApprovalAsInvalid: async function(cr) {
    let po = await PurchaseOrder.findOneById(cr.target);
    po.meta.cost_rejected = [cr.costcode];
    po.rejection_memo = cr.memo;
    po.state = poStates.REJECTED;
    po.locked = true;
    await PurchaseOrder.saveAsync(po);
    po = await PurchaseOrder.findOneById(cr.target).populateAll();
    this.blastChange(
      po,
      {
        state: poStates.REJECTED
      },
      'statechange'
    );
  },

  applyVendors: async function(values) {
    const id = this.getId(values);
    if (!id) {
      return;
    }
    const po = await PurchaseOrder.findOneById(id).populate('vendors');
    const vendors = po.vendors || [];
    if (!vendors.length) {
      return;
    }
    const ids = vendors.map(v => this.getId(v));
    try {
      await VendorLedger.update(
        {
          id: ids
        },
        {
          purchase_order: values.id
        }
      );
    } catch {}
  },

  afterCreate: async function(values, next) {
    await StateKeys.registerState(values, 'purchaseorder');
    const po = new PurchaseOrderUtility(values);
    await po.applyProjectedCosts();
    await this.costCode(values);
    if (values.scope === 'external') {
      await this.applyVendors(values);
    }
    next();
  },

  beforeCreate: async function(values, next) {
    if (!values.transaction_id) {
      values.transaction_id = await Tracker.findCodeBody('short');
      values.last_active = values.requester;
      values.opperators = [values.requester];
      if (!values.state) {
        values.state = poStates.PENDING;
      }
    }

    if (!_.size(values.items)) {
      return next('A purchase order cannot exist without items');
    }

    values.meta = values.meta || {};
    values.meta.itemsCount = PurchaseOrderUtility.setItemCount(values);

    next();
  },

  getStationForParam: async function(station) {
    if (typeof station === 'string') {
      return station;
    }
    const stationObj = await Station.findOneById(this.getId(station));
    if (!stationObj) {
      throw new Error('A station with the selected ID was not found');
    }
    return stationObj.station_id;
  },

  iterateVariantPurchaseOrders: function(purchaseOrders = []) {
    const variances = {
      total: 0,
      items: {}
    };
    for (let i = 0; i < purchaseOrders.length; i++) {
      const purchaseOrder = purchaseOrders[i];
      const meta = purchaseOrder.meta || {};
      if (!_.size(meta.variances)) {
        continue;
      }
      for (let j = 0; j < meta.variances.length; j++) {
        const variance = meta.variances[j];
        const cost = variance.value || 0;
        variances.total += cost;
        variances.items[variance.sku] = variances.items[variance.sku] || 0;
        variances.items[variance.sku] += variance.delta;
      }
    }
    return variances;
  },

  findVariantPurchaseOrdersBetween: async function(
    station,
    startDate,
    endDate = new Date(),
    toOnly = false
  ) {
    if (!startDate) {
      throw new Error('A valid start date is required');
    }

    const query = {
      state: poStates.COMPLETE,
      fullfilment_date: {
        '>=': TimeUtils.isoFormattedDate(startDate),
        '<=': TimeUtils.isoFormattedDate(endDate)
      }
    };

    if (station) {
      try {
        const stationID = await this.getStationForParam(station);
        if (toOnly) {
          query.from = stationID;
        } else {
          query.or = [{ from: stationID }, { from: stationID }];
        }
      } catch {
        return null;
      }
    }
    const purchaseOrders = await this.find().where(query);
    return this.iterateVariantPurchaseOrders(purchaseOrders);
  }
};
