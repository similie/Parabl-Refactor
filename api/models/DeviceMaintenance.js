/**
 * DeviceMaintenance.js
 *
 * @description :: A model definition represents a database table/collection.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    title: {
      type: 'string'
    },

    notes: {
      type: 'string'
    },

    device: {
      type: 'integer'
    }
  }
};
