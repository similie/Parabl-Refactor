/**
 * StationBadge.js
 *
 * @description :: A model definition represents a database table/collection.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    badge: {
      model: 'badging'
    },
    station: {
      model: 'station'
    },

    cascade: {
      type: 'boolean',
      defaultsTo: false
    }
  },

  beforeCreate: async function(values, next) {
    if (!values.station) {
      return next();
    }
    await this.destroy({ station: values.station });
    next();
  }
};
