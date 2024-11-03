/**
 * WorkOrder.js
 *
 * @description :: A model definition.  Represents a database table/collection/etc.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

const { CommonUtils } = require('similie-api-services');
const SailsExtensions = require('../services/SailsExtensions');
const { TimeUtils } = require('similie-api-services');
const now_ = TimeUtils.constants.now_;
const {
  states,
  WOModes,
  checkForState
} = require('../model-utilities/workorders/workorder-states');
const {
  WorkorderUtils
} = require('../model-utilities/workorders/workorder.service');

const {
  WorkOrderPDF
} = require('../model-utilities/workorders/pdf/workorder-pdf');
const {
  WorkOrderInventoryManager
} = require('../model-utilities/workorders/workorder-inventory-manager');
const { Common } = require('../model-utilities/common/common');
const {
  workorderPdfFragment
} = require('../model-utilities/workorders/pdf/pdf-fragments');

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    workorder_id: {
      type: 'string'
    },

    approval_message: {
      type: 'string'
    },

    state: {
      type: 'string',
      in: Object.values(states)
    },

    previous_state: {
      type: 'string',
      in: Object.values(states)
    },

    scheduled_start: {
      type: 'datetime'
    },

    scheduled_end: {
      type: 'datetime'
    },

    approved: {
      type: 'boolean',
      defaultsTo: false
    },

    approved_by: {
      model: 'user'
    },

    pos: {
      model: 'pointofsale'
    },

    is_template: {
      type: 'boolean',
      defaultsTo: false
    },

    is_request: {
      type: 'boolean',
      defaultsTo: false
    },

    completed_by: {
      model: 'user'
    },

    completed_at: {
      type: 'string'
    },

    spent_time: {
      type: 'integer' // Seconds that has been spent
    },

    station: {
      model: 'station'
    },
    /*
     * The type of entity we are adding to
     */
    identity: {
      type: 'json'
    },

    schema: {
      type: 'integer'
    },

    parent: {
      model: 'WorkOrder'
    },

    scheduler: {
      model: 'scheduledevents'
    },

    notes: {
      type: 'text'
    },

    description: {
      type: 'text'
    },

    rejection_memo: {
      type: 'text'
    },

    activities_description: {
      type: 'text'
    },

    name: {
      type: 'string'
    },

    service_station: {
      type: 'string'
    },

    stationschema: {
      model: 'stationschema'
    },

    nodeschema: {
      model: 'nodeschema'
    },

    activities: {
      collection: 'workorderactivity',
      through: 'wo_activities'
    },

    tasks: {
      collection: 'workordertask'
    },

    from_contact: {
      type: 'string'
    },

    from_whatsapp: {
      type: 'string'
    },

    additional_contact_info: {
      type: 'string'
    },

    from: {
      type: 'string'
    },

    to_contact: {
      type: 'string'
    },

    type: {
      type: 'string',
      in: ['internal', 'external', 'template']
    },

    mode: {
      type: 'string',
      // maintence defines worked done on an assset.
      // byproduct allows converting raw inventory into
      // a serialzied asset
      in: Object.values(WOModes),
      defaultsTo: 'maintenance'
    },

    priority: {
      type: 'integer',
      defaultsTo: 2
    },

    complete: {
      type: 'boolean',
      defaultsTo: false
    },

    waiting: {
      type: 'boolean',
      defaultsTo: false
    },

    initiated_by: {
      model: 'user'
    },

    requested_by: {
      model: 'user'
    },

    rejected_by: {
      model: 'user'
    },

    last_updated_by: {
      model: 'user'
    },

    owner: {
      model: 'user'
    },

    approval_files: {
      collection: 'sysfile',
      through: 'workorderfile'
    },

    request_files: {
      collection: 'sysfile',
      through: 'workorderreqfile'
    },

    from_address: 'text',
    to_address: 'text',

    items: {
      type: 'array'
    },

    parts: {
      type: 'array'
    },

    templates: {
      collection: 'workordertemplate',
      through: 'workordertemplatem2m'
    },

    tags: {
      collection: 'tag'
    },

    personnel: {
      collection: 'user'
    },

    team: {
      collection: 'user'
    },

    activitylog: {
      collection: 'activity',
      through: 'workorderactivitylogm2m'
    },

    cost: {
      type: 'float',
      defaultsTo: 0
    },

    meta: {
      type: 'json'
    },

    nodeserial: {
      model: 'nodeserial'
    },

    order: {
      type: 'integer',
      min: 0,
      defaultsTo: 0
    }
  },
  _processors: [
    {
      name: 'workorderUpdateEmail',
      process: async function(job) {
        const { workorder, user, attachments } = job.data;
        const varKeys = ['labels.QUANTITY', 'labels.SKU', 'labels.DESCRIPTION'];

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
          Domain.getId(workorder.station.domain)
        );
        let client;

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

        const name = User.fullName(user);
        Jobs.sendEmail.add({
          to: {
            address: user.email,
            name: name
          },
          locals: {
            vars: vars,
            name: name,
            site_name: config.site_name,
            host: CommonUtils.pullHost(config),
            workorder: workorder,
            money: '$'
          },
          default_language:
            client.preferred_language || config.default_language,
          template: 'message',
          variables: Email.variables.receipt.key,
          attachments: attachments || [],
          tags: ['workorder', 'update']
        });
      },
      stats: SailsExtensions.stats({
        completed: function() {
          //
        },
        failed: function() {
          //
        }
      })
    },
    {
      name: 'generateWorkorderPdf',
      process: async function(job) {
        const { workorder, type } = job.data;
        let pdf;
        if (type === 'report') {
          pdf = await WorkOrder.workorderPdf(workorder);
        } else {
          pdf = await WorkOrder.workorderRequestPdf(workorder);
        }

        const toretPromise = new Promise((resolve, reject) => {
          const bufferSize = 9007199254740991;

          const chunks = [];
          let result;
          pdf.on('readable', async () => {
            let chunk;
            while ((chunk = pdf.read(bufferSize)) !== null) {
              chunks.push(chunk);
            }
          });
          pdf.on('error', err => {
            reject(err);
          });
          pdf.on('end', async () => {
            result = Buffer.concat(chunks);
            const res = result.toString('base64');
            resolve([res, workorder]);
          });

          pdf.end();
        });

        return await toretPromise;
      },

      stats: SailsExtensions.stats({
        completed: function(job, result) {
          if (job.data.type === 'report') {
            sails.sockets.blast(`workorder-pdf-report-${result[1]}`, {
              report: result[0]
            });
          } else {
            sails.sockets.blast(`workorder-pdf-request`, {
              report: result[0]
            });
          }
        },
        failed: function(job, err) {
          sails.log.error('WorkOrder::generateWorkorderPdf:job:error', err);
          sails.sockets.blast(`workorder-pdf-failed`, {
            report: err
          });
        }
      })
    }
    // {
    //   name: 'completeWorkorder',
    //   process: async function(job) {
    //     const pos = job.data;
    //     const wo = await WorkOrder.complete(pos.workorder.id);
    //     return wo;
    //   },

    //   stats: SailsExtensions.stats({
    //     completed: function(job, result) {
    //       sails.sockets.blast('workorder-completed', {
    //         workorder: result
    //       });
    //     },
    //     failed: function(job, err) {
    //       sails.log.error('Jobs.completeWorkorder::ERR::', err);
    //     }
    //   })
    // }
  ],

  setPdfDetails: async function(values) {
    const from_station = await Station.findOne({ station_id: values.from });
    const requisitions = await Requisition.find({
      role: Roles.MANAGER,
      station: from_station.id
    });
    for (let i = 0; i < requisitions.length; i++) {
      const user = await User.findOne(requisitions[i].user);
      const pdf = await this.workorderPdf(values.id);
      const bufferSize = 9007199254740991;

      const chunks = [];
      let result;
      pdf.on('readable', async () => {
        let chunk;
        while ((chunk = pdf.read(bufferSize)) !== null) {
          chunks.push(chunk);
        }
      });
      pdf.on('end', async () => {
        result = Buffer.concat(chunks);
        const res = result.toString('base64');
        const attachments = [
          {
            // data uri as an attachment

            filename: 'workorder.pdf',
            content: res,
            encoding: 'base64'
          }
        ];

        await WorkorderUtils.sendUpdateEmail(
          user,
          values,
          null,
          from_station,
          attachments
        );
      });
      pdf.end();
    }
  },

  applyPostCreateNodeSerialDetails: async function(values) {
    if (!values.nodeserial) {
      return;
    }
    const nodeserial = await NodeSerial.findOne({ id: values.nodeserial });
    const nodeschema = await NodeSchema.findOne({
      id: nodeserial.possessed_by_schema
    });
    const meta = _.clone(nodeschema.meta) || {};
    meta.workorderassets = _.clone(meta.workorderassets) || {};
    meta.workorderassets[nodeserial.id] = {
      station: values.from,
      asset: values.nodeserial,
      wo: Model.getId(values)
    };
    nodeschema.meta = meta;
    await NodeSchema.saveAsync(nodeschema);
  },

  setPostCreateVendors: async function(values) {
    if (values.type !== 'external') {
      return;
    }
    const workorder = await WorkOrder.findOneById(values.id).populate(
      'vendors'
    );

    if (!_.size(workorder.vendors)) {
      return;
    }

    const ids = _.pluck(workorder.vendors, 'id');
    VendorLedger.update(
      {
        id: ids
      },
      {
        workorder: values.id
      }
    ).exec(err => {
      if (err) {
        sails.log.error(err);
      }
    });
  },

  afterCreate: async function(values, next) {
    if (values.state === 'approved') {
      await WorkorderUtils.approve(values.id, {});
    }
    await this.applyPostCreateNodeSerialDetails(values);
    if (values.type === 'internal' && values.state === 'pending') {
      // await this.setPdfDetails(values);
      await WorkorderUtils.sendWebsocketEvent(values, null, 'pending');
    } else if (values.type === 'external' && values.state === 'pending') {
      await StateKeys.registerState(values, 'workorder');
      await this.costCode(values);
      await this.setPostCreateVendors(values);
    }
    next();
  },

  beforeCreate: async function(values, next) {
    if (!values.state) {
      values.state = checkForState('PENDING');
    }

    if (!values.workorder_id) {
      values.workorder_id = await Tracker.findCodeBody('short');
    }
    await WorkorderUtils.buildMeta(values);

    next();
  },

  workorderPdf: function(workorder_id, res) {
    return workorderPdfFragment(workorder_id, res);
  },

  workorderRequestPdf: async function(workorder_id) {
    const workorder = await WorkOrder.findOne({
      id: workorder_id
    }).populate('tasks');
    const pdf = new WorkOrderPDF(workorder);
    const generated = await pdf.downloadWORequestPdf();
    return generated;
  },

  findStationManager: async function(wo) {
    const fromStation = await Station.findOne({ station_id: wo.from });
    if (!fromStation) {
      throw new Error('A valid station cannot be found');
    }
    // we want to search the users who are attached to the
    // actual workorder as contacts.
    const personnel = wo.personnel || [];
    if (!personnel.length) {
      return WorkorderUtils.findFallbackUser(wo, fromStation);
    }
    // now we get the requitions for these user in this station
    const requisitions = await Requisition.find().where({
      user: personnel.map(p => this.getId(p)),
      station: this.getId(fromStation)
    });

    const reqMap = Common.buildBasicItemCache(requisitions, 'user');
    let backupManager;
    // search the people in the model
    for (let i = 0; i < personnel.length; i++) {
      const person = personnel[i];
      const req = reqMap[this.getId(person)] || {};
      // we want to find a manager for this station
      if (req.role === Roles.MANAGER) {
        return WorkorderUtils.sendUserWithSchema(person);
      } else if (person.role === Roles.MANAGER && !backupManager) {
        // we hold the first site-level manager role
        backupManager = person;
      }
    }
    // if we have a site-level manager, send that
    if (backupManager) {
      return WorkorderUtils.sendUserWithSchema(backupManager);
    }
    // fall back to first
    const [person] = personnel;
    return WorkorderUtils.sendUserWithSchema(person);
  },

  setSerialHold: function(item, schema, sku, serials = {}) {
    if (!item.serials || !item.serials.length) {
      return;
    }
    const itemSerials = _.clone(item.serials); // Object.assign([], item.serials);
    delete item.serials;
    serials[schema][sku] = serials[schema][sku] || [];
    serials[schema][sku].push(...itemSerials);
  },

  setSerialDetailsHold: function(item, schema, sku, serials = {}) {
    const serialized = item.serialized;
    if (!serialized) {
      return;
    }
    const theseSerials = {};
    const previousSerials = serials[schema][sku] || {};
    for (const key in serialized) {
      const serialize = serialized[key];
      theseSerials[key] = theseSerials[key] || [];
      if (previousSerials[key]) {
        const thoseSerials = previousSerials[key].serials || [];
        theseSerials[key].push(...thoseSerials);
      } else {
        serials[schema][sku] = serials[schema][sku] || {};
        serials[schema][sku][key] = Object.assign({}, serialize);
      }
      const setSerials = serialize.serials || [];
      theseSerials[key].push(...setSerials);
    }

    for (const key in theseSerials) {
      serials[schema][sku][key].serials = theseSerials[key];
    }
  },

  setSerialValue: function(serial, key, serialDetails) {
    const serailValue = {
      scan: serial,
      serial: {
        id: serialDetails.schema,
        param_name: key,
        name: '',
        title: '',
        items: []
      }
    };
    return serailValue;
  },

  setSerializedValueLengths: function(item = {}) {
    const serialStorage = [];
    const serials = item.serials || []; // Object.assign([], item.serials);
    const serialized = item.serialized || {};
    for (const key in serialized) {
      const values = serialized[key];
      const detailedSerials = values.serials || [];
      const serialValues = Common.buildBasicItemCache(detailedSerials, 'sku');
      for (let j = 0; j < serials.length; j++) {
        const serial = serials[j];
        const serialHold = serialValues[serial];
        const [node] = serialHold.nodes;
        const serialSubDetails = serialValues[serial].serialDetails || {};
        const serialDetails = serialSubDetails[node] || {};
        if (!serialDetails) {
          continue;
        }
        const serailValue = this.setSerialValue(serial, key, serialDetails);
        serialStorage.push(serailValue);
      }
    }
    return serialStorage;
  },

  rebuildSerialItems: function(items = []) {
    const sendItems = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const theseItems = this.setSerializedValueLengths(item);
      if (theseItems.length) {
        item.serials = theseItems;
      }
      sendItems.push(item);
    }
    return sendItems;
  },

  setSerialDetailsHolder: function() {
    const serials = {};
    const serializer = {};

    return {
      schema: schema => {
        serials[schema] = serials[schema] || {};
        serializer[schema] = serializer[schema] || {};
      },

      item: (schema, sku, serialized = true) => {
        return serialized ? serializer[schema][sku] : serials[schema][sku];
      },

      appendSerials: (item, itemSerials) => {
        if (!itemSerials) {
          return;
        }
        item.serials = itemSerials;
      },

      appendDetails: (item, serialDetails) => {
        if (!serialDetails) {
          return;
        }
        item.serialized = serialDetails;
      },

      serials,
      serializer
    };
  },

  aggregatePosItems: function(items = []) {
    const hold = {};
    const serialSet = this.setSerialDetailsHolder();

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const schema = this.getId(item.schema);
      const sku = item.sku;

      hold[schema] = hold[schema] || {};

      serialSet.schema(schema);

      this.setSerialHold(item, schema, sku, serialSet.serials);
      this.setSerialDetailsHold(item, schema, sku, serialSet.serializer);
      if (!hold[schema][sku]) {
        hold[schema][sku] = item;
        continue;
      }

      hold[schema][sku].quantity += item.quantity || 0;
    }

    const aggItems = [];
    for (const schema in hold) {
      for (const sku in hold[schema]) {
        const item = hold[schema][sku];
        serialSet.appendSerials(item, serialSet.item(schema, sku, false));
        serialSet.appendDetails(item, serialSet.item(schema, sku));
        aggItems.push(hold[schema][sku]);
      }
    }

    return this.rebuildSerialItems(aggItems);
  },

  mapPOSItems: function(wo, user) {
    const items = wo.parts
      .map(part => {
        return Object.assign(
          {
            scan: part.sku,
            workorder: this.getId(wo),
            direct: false,
            temp_schema: part.schema,
            client_type: (user.schema || {}).name || 'user',
            client: this.getId(user)
          },
          part
        );
      })
      .map(part => {
        delete part.id;
        return part;
      });
    return this.aggregatePosItems(items);
  },

  checkout: async function(req, res) {
    const params = req.params.all();
    if (!params.id) {
      return res.badRequest({ error: 'A work order ID is required' });
    }
    const wo = await this.findOneById(params.id);
    if (!wo) {
      return res.badRequest({
        error: 'A work order with the given ID cannot be found'
      });
    }

    if (wo.pos) {
      const pos = await PointOfSale.findOneById(
        this.getId(wo.pos)
      ).populateAll();
      if (pos && pos.available && !pos.complete) {
        return res.send(pos);
      }
    }

    let user = req.user;
    try {
      user = await this.findStationManager(wo);
    } catch (e) {
      return res.badRequest({ error: e.message });
    }
    const items = this.mapPOSItems(wo, user);
    const payload = {
      workorder: this.getId(wo), // might remove
      owner: wo.station, // primary station
      items: items
    };
    return PointOfSale.redirectedTransactions(req, res, payload);
  },

  closeWorkorder: async function(pos, user, log = false) {
    const workorder = pos.workorder;
    if (!workorder) {
      return;
    }
    const id = this.getId(workorder);
    const wo = await this.findOneById(id);
    if (!wo) {
      return;
    }
    wo.state = states.CLOSED;
    wo.completed_at = TimeUtils.isoFormattedDate(now_);
    wo.complete = true;
    wo.cost = pos.final_cost || 0;
    wo.completed_by = wo.completed_by || this.getId(user);
    // this will save the workorder for us
    if (log) {
      await WorkorderUtils.logStateChange(states.CLOSED, wo, user);
    }
    await this.saveAsync(wo);
    await WorkorderUtils.makeItemsAvailable(wo);
    const invManager = new WorkOrderInventoryManager(wo, states.CLOSED, user);
    return invManager.close();
  }
};
