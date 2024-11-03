/**
 * WorkOrderController
 *
 * @description :: Server-side actions for handling incoming requests.
 * @help        :: See https://sailsjs.com/docs/concepts/actions
 */

const _ = require('lodash');
const {
  WorkorderUtils
} = require('../model-utilities/workorders/workorder.service');
const SailsExtensions = require('../services/SailsExtensions');

module.exports = {
  checkout: function(req, res) {
    const errors = WorkorderUtils.errorMessages();

    if (req.method !== 'POST') {
      return res.badRequest({ error: errors.ROUTE_NOT_FOUND });
    }
    return WorkOrder.checkout(req, res);
  },

  update: async function(req, res) {
    try {
      await WorkorderUtils.validateAndVerifyUpdates(req);
    } catch (e) {
      return res.serverError({ error: e.message });
    }

    SailsExtensions.bluePrints.update(req, res);
  },

  search: function(req, res) {
    WorkOrder.count().exec(function(err, found) {
      if (err) return res.negotiate(err);
      if (!found) return res.notFound();

      WorkOrder.find({
        from: req.param('station'),
        schema: req.param('schema'),
        service_station: req.param('service_station'),
        or: [
          {
            name: {
              contains: req.param('search')
            }
          },
          {
            description: {
              contains: req.param('search')
            }
          }
        ]
      })
        .populate('tasks')
        .populate('approval_files')
        .populate('templates')
        .exec(function(err, workorders) {
          if (err) {
            return res.serverError(err);
          }

          // Iterate through workorders to format the owner and created attributes
          _.each(workorders, function(workorder) {
            const status = ['pending', 'approved'];
            if (status.includes(workorder.status)) {
              workorder.cost = _.sumBy(workorder.items, function(i) {
                return i.final_cost;
              });
            } else {
              workorder.cost = _.sumBy(workorder.items, function(i) {
                return i.estimated_cost;
              });
            }
          });

          return res.json({
            options: {
              total: found,
              workorders: workorders
            }
          });
        });
    });
  },

  create: async function(req, res) {
    const params = req.params.all();
    const errors = WorkorderUtils.errorMessages();
    if (_.isNil(req.param('station'))) {
      return res.badRequest({ error: errors.STATION_REQUIRED });
    }
    if (!_.isString(req.param('from'))) {
      return res.badRequest({ error: errors.FROM_COST_CODE_REQUIRED });
    }
    if (!_.isString(req.param('notes'))) {
      return res.badRequest({ error: errors.DESCRIPTIVE_MESSAGE_REQUIRED });
    }
    let createdWorkorder;
    const request_station = await Station.findOne({
      id: params.station
    });
    // const from_station = await Station.findOne({ station_id: params.from });
    const to_station = await Station.findOne({
      station_id: params.service_station
    });
    const requisition = await Requisition.findOne({
      user: req.user.id,
      station: request_station.id
    });

    if (_.isNil(requisition) && req.user.role < Roles.SITE_ADMIN) {
      return res.badRequest();
    }
    if (requisition && requisition.role >= Roles.MANAGER) {
      if (request_station.station_id !== params.from && !_.isNil(to_station)) {
        params.mode = 'require';
        params.state = 'pending';
      } else {
        params.mode = 'request';
        params.state = 'approved';
      }
    } else if (requisition && requisition.role === Roles.RECORDER) {
      params.state = 'pending';
      params.mode = 'request';
    }
    try {
      const _created = await WorkOrder.create(params);
      createdWorkorder = await WorkOrder.findOne({ id: _created.id }).populate(
        'activitylog'
      );

      WorkorderUtils.buildActivitiesToTemplates(createdWorkorder);

      const c = await Activity.create({
        body: `Workorder ${createdWorkorder.workorder_id} Created`,
        title: 'Work Order Created',
        station: to_station,
        user: User.getId(req.user)
      });
      createdWorkorder.activitylog.add(c);
      await WorkOrder.saveAsync(createdWorkorder);

      if (req._sails.hooks.pubsub) {
        if (req.isSocket) {
          WorkOrder.subscribe(req, createdWorkorder);
          WorkOrder.introduce(createdWorkorder);
        }
        // Make sure data is JSON-serializable before publishing
        const publishData = createdWorkorder.toJSON();
        WorkOrder.publishCreate(publishData, !req.options.mirror && req);
      }
    } catch (e) {
      return res.serverError(e);
    }
    const _created = await WorkOrder.findOne({
      id: createdWorkorder.id
    }).populateAll();
    // .populate('tasks')
    // populate('templates');
    res.status(201);

    return res.created(_created);
  },

  /**
   * @name getWorkorder
   * @param {request} req
   * @param {result} res
   * @deprecated please do not use this function
   */
  getWorkorder: async function(req, res) {
    /**
     * The blueprint api is not returning all the collections. This queries and return them
     * @type {*|undefined}
     */

    const wo = await WorkOrder.find({
      workorder_id: req.param('workorder_id')
    }).populateAll();
    const workorder = wo[0];
    if (workorder.nodeserial != null) {
      const nodeserial = await NodeSerial.find({ id: workorder.nodeserial })
        .populate('owned_by_schema')
        .populate('possessed_by_schema');
      workorder.nodeserial = nodeserial[0];
      const node = await Node.findOneById(
        nodeserial[0].possessed_by_node,
        nodeserial[0].possessed_by_schema
      );
      workorder.nodeserial.possessed_by_node = node;
    }

    res.send(workorder);
  },

  /**
   * @name workorderPdf
   * @param {request} req
   * @param {result} res
   * @deprecated this will be replaced in future versions by
   *   functional
   */
  workorderPdf: async function(req, res) {
    // if (req.param('type') === 'request') {
    //   Jobs.generateWorkorderPdf.add({
    //     workorder: +req.param('id'),
    //     type: 'request'
    //   });
    // } else {
    //   Jobs.generateWorkorderPdf.add({
    //     workorder: +req.param('id'),
    //     type: 'report'
    //   });
    // }
    res.ok();
  }
};
