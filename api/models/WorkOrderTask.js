/**
 * WorkorderTask.js
 *
 * @description :: The actuation for steps in a workorder.
 * @docs        ::
 */

const {
  WOActivityStates
} = require('../model-utilities/workorders/workorder-states');

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    state: {
      type: 'integer',
      min: WOActivityStates.REJECTED,
      max: WOActivityStates.COMPLETE,
      defaultsTo: WOActivityStates.PENDING
    },
    // assets: {
    //   type: 'array',
    // },
    // ordering: {
    //   type: 'integer',
    // },

    // steps: {
    //   type: 'array',
    // },

    // parent: {
    //   type: 'integer',
    // },

    workorder: {
      model: 'workorder'
    },

    // weight: {
    //   type: 'integer',
    //   defaultsTo: 1,
    // },

    final_cost: {
      type: 'integer',
      defaultsTo: 0
    },

    start_time: {
      type: 'datetime'
    },

    end_time: {
      type: 'datetime'
    },

    estimated_time: {
      type: 'integer',
      defaultsTo: 0
    },

    // estimated_cost: {
    //   type: 'float',
    //   defaultsTo: 0,
    // },

    // hours: {
    //   type: 'integer',
    //   defaultsTo: 0,
    // },

    // minutes: {
    //   type: 'integer',
    //   defaultsTo: 0,
    // },

    // days: {
    //   type: 'integer',
    //   defaultsTo: 0,
    // },

    // unitcost: {
    //   type: 'integer',
    //   defaultsTo: 0,
    // },

    name: {
      type: 'string'
    },

    details: {
      type: 'text'
    },

    description: {
      type: 'string'
    },

    memo: {
      type: 'string'
    },

    // stationschema: {
    //   model: 'stationschema',
    // },

    // nodeschema: {
    //   model: 'nodeschema',
    // },

    required_parts: {
      type: 'array'
    },

    parts_inventory: {
      type: 'array'
    },

    approved_by: {
      model: 'user'
    },

    started_by: {
      model: 'user'
    },

    ended_by: {
      model: 'user'
    },

    // is_template: {
    //   type: 'boolean',
    //   defaultsTo: false,
    // },

    workorder_task_template: {
      model: 'workordertasktemplate'
    },

    files: {
      collection: 'sysfile'
    },

    order: {
      type: 'integer',
      defaultsTo: 0
    },

    meta: {
      type: 'json'
    }
  },

  states: {
    REJECTED: -2,
    NOT_REQUIRED: -1,
    PENDING: 0,
    INPROGESS: 1,
    COMPLETE: 2
  },

  getInvertedTaskOrder: function(template = {}) {
    const taskOrder = template.task_order || {};
    const order = {};

    for (const orderVale in taskOrder) {
      const id = taskOrder[orderVale];
      order[id] = parseInt(orderVale);
    }

    return order;
  },

  mergeAllValues: function(allValues = {}, template = {}) {
    const id = this.getId(allValues);
    const taskOrder = this.getInvertedTaskOrder(template);
    const order = taskOrder[id] || allValues.order || 0;
    const build = {
      name: allValues.name,
      order: order,
      files: allValues.files.map(f => this.getId(f)),
      details: allValues.details,
      workorder_task_template: id,
      required_parts: allValues.required_parts,
      meta: {}
    };
    return build;
  },

  buildFromTemplate: async function(taskTemplate = {}, template = {}) {
    const allValues = await WorkOrderTaskTemplate.findOneById(
      this.getId(taskTemplate)
    ).populateAll();
    const build = this.mergeAllValues(allValues, template);
    return this.create(build);
  }
};
