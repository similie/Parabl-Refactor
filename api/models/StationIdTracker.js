/**
 * StationIdTracker.js
 *
 * @description :: In order to maintain consistent station ID, we use this model to track the current values.
 */

const { Common } = require('../model-utilities/common/common');

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    count: {
      type: 'integer',
      defaultsTo: 0,
      min: 0
    },

    decimal: {
      type: 'float',
      defaultsTo: 0.00001
    },

    prefix: {
      type: 'string'
      // max: 4
    },

    postfix: {
      type: 'string'
    },
    // callback to support legacy
    increment: function(cb) {
      this.count += 1;
      return new Promise((resolve, reject) => {
        this.save((err, values) => {
          if (err) {
            Common.noop(cb, err);
            return reject(err);
          }
          Common.noop(cb, null, values);
          resolve(values);
        });
      });
    },

    locked: {
      type: 'boolean',
      defaultsTo: false
    },
    domain: {
      model: 'domain'
    }
  },

  beforeCreate: async function(values, next) {
    const tracker = await StationIdTracker.findOne().where({
      domain: values.domain,
      prefix: values.prefix
    });
    if (_.size(tracker)) {
      return next(
        'The entered prefix has already been used. Please select another'
      );
    }

    next();
  }
};
