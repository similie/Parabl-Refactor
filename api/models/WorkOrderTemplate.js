/**
 * WorkorderTemplate.js
 *
 * @description ::  Basic template for creating a task list for workorders.
 * @docs        ::
 */

module.exports = {
  attributes: {
    name: {
      type: 'string'
    },

    details: {
      type: 'text'
    },

    template_type: {
      type: 'string',
      in: ['template', 'cloned', 'standalone']
    },

    estimated_time: {
      type: 'integer',
      min: 0
    },

    parent: {
      type: 'integer',
      defaultsTo: null
    },

    // actual_time: {
    //   type: 'integer',
    //   min: 0,
    // },

    template: {
      type: 'json'
    },

    // stationschema: {
    //   model: 'stationschema',
    // },
    nodeschema: {
      model: 'nodeschema'
    },
    created_by: {
      model: 'user'
    },
    tasks: {
      collection: 'workordertasktemplate',
      through: 'workordertemplatetask'
    },
    task_order: {
      type: 'json'
    }
  },

  deleteCommonClonedParams: function(woT = {}) {
    const deletionKeys = ['id', 'createdAt', 'updatedAt'];
    deletionKeys.forEach(key => {
      delete woT[key];
    });
  },

  clone: function(woTemplate = {}, user) {
    const tasks = (woTemplate.tasks || []).map(woT => this.getId(woT));
    const woT = Object.assign({}, woTemplate);
    this.deleteCommonClonedParams(woT);
    woT.template_type = 'cloned';
    woT.tasks = tasks;
    woT.created_by = this.getId(user);
    woT.parent = this.getId(woTemplate);
    return woT;
  },

  skipLabel: function(key = '') {
    return key.startsWith('__');
  },

  setTasks: function(activity) {
    const tasks = [];
    for (const task in activity) {
      if (this.skipLabel(task)) {
        continue;
      }
      tasks.push(activity[task]);
    }
    return tasks;
  },

  /**
   * It's a elongated object that needs to be walked
   * to find the details
   * @todo consider a recurive version for brevity
   * @param {any} work
   * @returns {any}
   */
  iterateWork: function(work = {}) {
    const taskCount = {};
    const tasks = [];
    for (const item in work) {
      if (this.skipLabel(item)) {
        continue;
      }
      const workItem = work[item];
      for (const serial in workItem) {
        if (this.skipLabel(serial)) {
          continue;
        }
        const activity = workItem[serial];
        tasks.push(...this.setTasks(activity));
      }
    }
    for (let i = 0; i < tasks.length; i++) {
      const activityTasks = tasks[i];
      for (const id in activityTasks.tasks) {
        taskCount[id] = taskCount[id] || 0;
        taskCount[id]++;
      }
    }
    return taskCount;
  },

  getWorkEstimate: async function(taskCount = {}) {
    let estimate = 0;
    const ids = Object.keys(taskCount);
    if (!ids.length) {
      return estimate;
    }

    const taskTemplates = await WorkOrderTaskTemplate.find().where({ id: ids });
    for (let i = 0; i < taskTemplates.length; i++) {
      const template = taskTemplates[i];
      const eTime = template.estimated_time || 0;
      if (!eTime) {
        continue;
      }
      // we need to multiply this value because it can repeat
      // accross jobs
      const count = taskCount[this.getId(template)];
      estimate += eTime * count;
    }

    return estimate;
  }
};
