/**
 * WO_activities.js
 *
 * @description :: A model definition represents a database table/collection.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    activity: {
      model: 'workorderactivity'
    },

    workorder: {
      model: 'workorder'
    }
  }
};
