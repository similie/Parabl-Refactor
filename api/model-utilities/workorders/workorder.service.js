const { TimeUtils } = require('similie-api-services');
const { WorkOrderActivityBuilder } = require('./workorder-activity-builder');
const { WorkOrderInventoryManager } = require('./workorder-inventory-manager');
const { checkForState, states } = require('./workorder-states');
const now_ = TimeUtils.constants.now_;

class WorkorderUtils {
  static returnUpdateVariableType() {
    return Variable.pullTypeAsync({
      key: 'station_activity',
      identity: 'station_updated'
    });
  }

  static runInProgressStateManager(workorder, toState, user) {
    const wAb = new WorkOrderActivityBuilder(workorder, toState, user);
    return wAb.execute();
  }

  static runAcceptedStateManager(workorder, toState, user) {
    const wIm = new WorkOrderInventoryManager(workorder, toState, user);
    return wIm.executeApproval();
  }

  static async logStateChange(toState, workorder, user) {
    // we pull it again. If there were changes made prior, we don't
    // want to override those changes
    const wo = await WorkOrder.findOneById(Model.getId(workorder));
    const variable = await WorkorderUtils.returnUpdateVariableType();
    const activityModel = {
      activity_type: Model.getId(variable),
      user: Model.getId(user),
      title: 'Work Order Updated',
      body: `Work order ${wo.workorder_id} was moved to ${toState}`
    };
    const activity = await Activity.create(activityModel);
    wo.activitylog.add(Model.getId(activity));
    await WorkOrder.saveAsync(wo);
  }

  static applyClosedState(workorder, user) {
    const pos = { workorder: Model.getId(workorder) };
    if (workorder.parts && workorder.parts.length) {
      throw new Error('State change must be done through point of sale');
    }
    return WorkOrder.closeWorkorder(pos, user);
  }

  static async stateChangeValidator(req, beforeChangeWorkorder) {
    const changedWorkorder = req.params.all();
    const state = changedWorkorder.state;
    switch (state) {
      // [AS] This should be reviewed. There is no accepted state
      // provided to the end user
      case states.RECEIVED:
      case states.ACCEPTED:
        await WorkorderUtils.runAcceptedStateManager(
          beforeChangeWorkorder,
          state,
          req.user
        );
        break;
      case states.INPROGRESS:
        await WorkorderUtils.runInProgressStateManager(
          beforeChangeWorkorder,
          state,
          req.user
        );
        break;
      case states.CLOSED:
        await WorkorderUtils.applyClosedState(beforeChangeWorkorder, req.user);
        break;
      case states.REJECTED:
        await WorkorderUtils.reject(beforeChangeWorkorder, req.user);
        break;
    }
    try {
      await WorkorderUtils.logStateChange(
        state,
        beforeChangeWorkorder,
        req.user
      );
    } catch (e) {
      sails.log.error('workorder.service.stateChangeValidator', e);
    }
  }

  static setLastUpdateUser(req) {
    req.body.last_updated_by = Model.getId(req.user);
  }

  static async validateAndVerifyUpdates(req) {
    WorkorderUtils.setLastUpdateUser(req);
    const params = req.params.all();
    if (!params.id || !params.state) {
      return;
    }
    const beforeChange = await WorkOrder.findOneById(params.id);
    if (!beforeChange || beforeChange.state === params.state) {
      return;
    }
    await WorkorderUtils.stateChangeValidator(req, beforeChange);
  }

  static async sendWebsocketEvent(workorder, fromState, toState) {
    sails.sockets.blast(`workorder-altered-${workorder.from}`, {
      workorder: workorder,
      fromState: fromState,
      toState: toState
    });
  }

  static async logActivity(_workorder, user, action, target) {
    let workorder;
    if (_.isNumber(_workorder)) {
      const workorders = await WorkOrder.find({ id: _workorder }).populate(
        'activitylog'
      );
      workorder = workorders[0];
    } else {
      workorder = _workorder;
    }

    const to_station = await Station.findOne({
      station_id: workorder.service_station
    });
    let title = '';
    let description = '';
    const state = workorder.state;
    const state_action = (state[0] || '').toUpperCase() + state.slice(1);

    switch (action) {
      case 'created':
        title = 'Work Order Created';
        description = 'Work Created By ' + user.first_name;
        break;
      case 'state_change':
        title = 'Work Order ' + state_action;
        description =
          'Work Order updated to ' + state_action + ' By ' + user.first_name;

        break;
      case 'personnel_added':
        title = 'Work Order Personnel Added';
        description =
          'Work Order Personnel ' +
          target.first_name +
          ' Added By ' +
          user.first_name;
        break;

      case 'personnel_removed':
        title = 'Work Order Personnel Removed';
        description =
          'Work Order Personnel ' +
          target.first_name +
          ' Removed By ' +
          user.first_name;
        break;

      case 'task_added':
        title = 'Work Order Activity Removed';
        description =
          'Work Order Activity ' + target.name + ' Added By ' + user.first_name;
        break;

      case 'task_removed':
        title = 'Work Order Activity Removed';
        description =
          'Work Order Activity ' +
          target.name +
          ' Removed By ' +
          user.first_name;
        break;

      default:
        break;
    }
    const c = await Activity.create({
      body: description,
      title: title,
      station: to_station,
      user: user
    });
    workorder.activitylog.add(c);
    workorder.last_updated_by = user;

    await WorkOrder.saveAsync(workorder);
    await WorkOrder.find({ id: _workorder }).populate('activitylog');
  }

  static async setMessageContent(params) {
    const user = params.user;
    const message = params.message;
    const station = params.station;
    const site = params.site;
    const key = params.workorder.state;
    const workorder = params.workorder;
    const initiated_by = params.initiated_by;
    const role = params.user.role;
    const template = this.getEmailTemplate(key, role);
    let mess;
    let sub;
    if (message) {
      mess = message.message[user.language];
      sub = message.subject[user.language];
    } else {
      mess = template.body;
      sub = template.subject;
    }

    const locals = {
      ...station,
      name: user.first_name,
      workorder_name: workorder.name,
      request_user: (initiated_by || user).first_name,
      item_name: workorder.items[0].description,
      sku: workorder.items[0].sku,
      initiated_by: initiated_by,

      site_name: site.site_name
    };
    const findMessage = Utils.parseLocals(mess, locals);
    const subject = Utils.parseLocals(sub, locals);

    return {
      message: findMessage,
      subject: subject,
      locals: locals
    };
  }

  static async buildActivitiesToTemplates(wo) {
    const items = wo.items;
    // wo.templates = wo.templates || [];
    for (let i = 0; i < _.size(items); i++) {
      const item = items[i];
      for (const k in item.serial_content) {
        const serial = item.serial_content[k];
        if (!_.size(serial.activities)) {
          continue;
        }
        for (let i = 0; i < _.size(serial.activities); i++) {
          const a = serial.activities[i];
          wo.templates.add(a);
        }
      }
    }
  }

  static async buildMeta(wo) {
    const items = wo.items;
    const meta = wo.meta || {};
    const helpers = Module._helpers.logistics();
    meta.nodeserial = meta.nodeserial || {};

    for (let i = 0; i < _.size(items); i++) {
      const item = items[i];
      for (const k in item.serial_content) {
        const serial = item.serial_content[k];
        if (!serial.serial_bind) {
          continue;
        }
        const nodeserial = await NodeSerial.findOne({ id: serial.serial_bind })
          .populate('owned_by_schema')
          .populate('possessed_by_schema');
        if (!nodeserial) {
          continue;
        }

        const snode = await Node.findOneById(
          nodeserial.possessed_by_node,
          nodeserial.possessed_by_schema
        );

        const logParams = helpers.logParams(
          nodeserial.possessed_by_schema.schema
        );

        const _meta = {
          scan: k,
          via_param: nodeserial.via_param,
          possessed_by_schema: nodeserial.possessed_by_schema.id,
          owned_by_schema: nodeserial.owned_by_schema.id,
          id: nodeserial.id,
          param_name: logParams('sku'),
          possessed_by_node: snode.id,
          possessed_schema_name: nodeserial.possessed_by_schema.name,
          possessed_schema_title: nodeserial.possessed_by_schema.title
        };

        meta.nodeserial[k] = _meta;
      }
    }

    wo.meta = meta;
  }

  static async getEmailTemplate(key, role) {
    const tempates = {};
    const subject_fallback = `WorkOrder Update`;
    switch (key) {
      case 'pending':
        tempates.subject = 'You have a workorder pending approval';
        tempates.body = `%name%, you have received a workorder  for item %item_name% with SKU "%sku%" from %request_user%. Please login to approve`;

        break;
      case 'approved':
        tempates.subject = 'Your workorder %workorder_name% has been approved';
        tempates.body = `%name%, your  workorder %workorder_name% for item %item_name% with SKU "%sku%" has been approved. Please login to view`;

        break;

      case 'completed':
        if (role === Roles.RECORDER) {
          tempates.subject =
            'Your workorder %workorder_name% has been completed';
          tempates.body = `%name%, your  workorder %workorder_name% for item %item_name% with SKU "%sku%" has been completed. Please login to view`;
        }
        break;
      default:
        tempates.subject = subject_fallback;
        tempates.body = '';
    }

    return tempates;
  }

  static async sendUpdateEmail(
    user,
    workorder,
    _message,
    station,
    attachments
  ) {
    const site = await Site.thisSiteAsync(station.domain);
    let message = null;
    if (_message) {
      const variables = await this.pullVaraibles();
      message = variables(_message);
    }

    const sendMessage = this.setMessageContent({
      user: user,
      message: message,
      station: station,
      site: site,
      workorder: workorder,
      initiated_by: workorder.initiated_by.first_name
    });
    await Message.create({
      to: [User.getId(user)],
      send_email: true,
      subject: sendMessage.subject,
      body: sendMessage.message
    });
    await Email.sendUserMessages(
      sendMessage.message,
      sendMessage.subject,
      user,
      station.domain,
      attachments
    );
  }

  static sendUserWithSchema(user) {
    return User.findOneById(user).populate('schema');
  }

  static async findFallbackUser(wo, fromStation) {
    const requisitions = await Requisition.find().where({
      station: Model.getId(fromStation),
      role: Roles.MANAGER
    });
    const fallbackUser = Model.getId(wo.requested_by || wo.initiated_by);

    if (!requisitions.length) {
      if (!fallbackUser) {
        throw new Error('User Unassignable');
      }
      return WorkorderUtils.sendUserWithSchema(fallbackUser);
    }

    const mappedUsers = requisitions.map(r => r.user);
    const [mappedUser] = mappedUsers.filter(
      user => Model.getId(user) === fallbackUser
    );
    if (mappedUser) {
      return WorkorderUtils.sendUserWithSchema(mappedUser);
    }
    return WorkorderUtils.sendUserWithSchema(mappedUsers[0]);
  }

  static async getDeleiverWorkOrderUserMessages(workorder, from_station) {
    const personnel = workorder.personnel || [
      Model.getId(workorder.initiated_by)
    ];

    for (let i = 0; i < personnel.length; i++) {
      const user = personnel[i];
      const fullUser = await User.findOneById(Model.getId(user));
      await this.sendUpdateEmail(fullUser, workorder, null, from_station, []);
    }
  }

  static async reject(workorder_id, user) {
    const workorder = await WorkOrder.findOne({
      id: Model.getId(workorder_id)
    }).populateAll();
    if (workorder.state === checkForState('REJECTED')) {
      throw new Error('Invalid State');
    }
    const _meta = workorder.meta || {};
    workorder.meta = { ..._meta };
    workorder.meta.last_state = checkForState('APPROVED');
    workorder.meta.rejected_on = TimeUtils.isoFormattedDate(now_);
    workorder.rejected_by = Model.getId(user);
    workorder.meta.rejected = true;
    // workorder.state = checkForState('REJECTED');
    const from_station = await Station.findOne({ station_id: workorder.from });
    await WorkorderUtils.makeItemsAvailable(workorder);
    await WorkOrder.saveAsync(workorder);
    await WorkorderUtils.getDeleiverWorkOrderUserMessages(
      workorder,
      from_station
    );
    return workorder;
  }

  static async makeItemsAvailable(workorder) {
    const serialId = Model.getId(workorder.nodeserial);
    if (!serialId) {
      return;
    }
    const nodeserial = await NodeSerial.findOneById(serialId);
    if (!nodeserial) {
      return;
    }
    const nodeschema = await NodeSchema.findOne({
      id: nodeserial.possessed_by_schema
    });
    const meta = _.clone(nodeschema.meta) || {};
    meta.workorderassets = _.clone(meta.workorderassets) || {};
    delete meta.workorderassets[nodeserial.id];
    nodeschema.meta = meta;
    await NodeSchema.saveAsync(nodeschema);
  }

  static async errorMessages() {
    return {
      ...{
        ROUTE_NOT_FOUND: 'Route not found',
        STATION_REQUIRED:
          'A station ID is required to process this transaction',
        FROM_COST_CODE_REQUIRED:
          'A requesting costcode is required to process this transaction',
        DESCRIPTIVE_MESSAGE_REQUIRED:
          'We need details of the request before proccessing this transaction'
      }
    };
  }
}
module.exports = { WorkorderUtils };
