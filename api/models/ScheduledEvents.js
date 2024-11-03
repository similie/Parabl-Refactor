/**
 * ScheduledEvents.js
 *
 * @description :: A model definition.  Represents a database table/collection/etc.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

module.exports = {
  migrate: (process.env.MIGRATION || 'safe'), // set to 'alter' to have sails create the table
  attributes: {

    verb: {
      type: 'string',
      in: ['on', 'every']
    },

    scheduler: {
        model: 'assetscheduler'
    },

    job: {
        type: 'integer'
    },

    resolution: {
        type: 'text'
    },

    complete: {
        type: 'boolean'
    },

    meta: {
        type: 'json'
    }

  },

};

