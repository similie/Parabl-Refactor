/**
 * BatchManager.js
 *
 * @description :: A model definition represents a database table/collection.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */
const { Common } = require('../model-utilities/common/common');
module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    batch: {
      model: 'batchreport'
    },

    job: {
      type: 'string'
    },

    status: {
      type: 'string',
      in: ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'UNKNOWN']
    },

    message: {
      type: 'string'
    },

    last_active: {
      type: 'datetime'
    },

    count: {
      type: 'integer',
      defaultsTo: 0
    }
  },
  status: {
    PENDING: 'PENDING',
    RUNNING: 'RUNNING',
    COMPLETED: 'COMPLETED',
    FAILED: 'FAILED',
    UNKNOWN: 'UNKNOWN'
  },

  wrapContent: function(job, status, count = 0) {
    return {
      batch: this.getId(job.data),
      job: this.getId(job),
      last_active: Common.timeIsNow(),
      status: status,
      count: count === false || count == null ? 0 : count
    };
  },

  start: function(job) {
    return this.create(this.wrapContent(job, this.status.RUNNING));
  },

  fail: function(job, message = '') {
    return this.create({
      ...this.wrapContent(job, this.status.FAILED),
      message
    });
  },
  complete: function(job, count = 0) {
    return this.create(this.wrapContent(job, this.status.COMPLETED, count));
  }
};
