/**
 * WorkOrderActivity.js
 *
 * @description :: A model definition represents a database table/collection.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

const {
  WOActivityStates,
  checkForState
} = require('../model-utilities/workorders/workorder-states');
const {
  WorkorderUtils
} = require('../model-utilities/workorders/workorder.service');

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    name: {
      type: 'string'
    },

    details: {
      type: 'text'
    },

    description: {
      type: 'text'
    },

    state: {
      type: 'integer',
      min: WOActivityStates.REJECTED,
      max: WOActivityStates.COMPLETE,
      defaultsTo: WOActivityStates.PENDING
    },

    priority: {
      type: 'integer',
      min: 0,
      defaultsTo: 0
    },

    workorder: {
      model: 'workorder',
      required: true
    },

    item: {
      type: 'integer',
      required: true
    },

    nodeschema: {
      model: 'nodeschema'
    },

    template: {
      model: 'workordertemplate'
    },

    tasks: {
      collection: 'workordertask',
      through: 'wo_activity_tasks'
    },

    start_time: {
      type: 'datetime'
    },

    end_time: {
      type: 'datetime'
    },

    started_by: {
      model: 'user'
    },

    ended_by: {
      model: 'user'
    }
  },

  createActivity: async function(activity, workorder) {
    const variable = await WorkorderUtils.returnUpdateVariableType();
    const c = await Activity.create({
      activity_type: Model.getId(variable),
      body: `Activity updated to a final state: ${activity.state}`,
      title: activity.name,
      // station: to_station,
      user: this.getId(activity.ended_by)
    });
    workorder.activitylog.add(c);
    await WorkOrder.saveAsync(workorder);
  },

  afterUpdate: async function(values, next) {
    if (!values.ended_by || values.state === WOActivityStates.PENDING) {
      return next();
    }

    const woId = this.getId(values.workorder);
    if (!woId) {
      return next();
    }

    const wo = await WorkOrder.findOneById(woId);
    if (!wo || wo.state !== checkForState('INPROGRESS')) {
      return next();
    }

    await this.createActivity(values, wo);

    next();
  },

  getTaskTemplates: async function(template) {
    const theseTasks = template.tasks || [];
    if (theseTasks.length) {
      return theseTasks;
    }
    const pulledTasks = await WorkOrderTemplate.findOneById(
      this.getId(template)
    ).populate('tasks');
    return pulledTasks.tasks || [];
  },

  buildFromTemplate: async function(template, item, workOrder) {
    const build = {
      name: template.name,
      details: template.details,
      workorder: this.getId(workOrder),
      item: this.getId(item),
      nodeschema: this.getId(item.schema),
      template: this.getId(template),
      tasks: []
    };
    const created = await this.create(build);
    const tasksTemplates = await this.getTaskTemplates(template);

    try {
      for (let i = 0; i < tasksTemplates.length; i++) {
        const taskTemplate = tasksTemplates[i];
        const task = await WorkOrderTask.buildFromTemplate(
          taskTemplate,
          template
        );
        created.tasks.add(this.getId(task));
      }
      return this.saveAsync(created);
    } catch (e) {
      sails.log.error('WorkOrderActivity.buildFromTemplate', e);
      return created;
    }
  }
};
