/**
 * DeviceMap.js
 *
 * @description :: A model definition.  Represents a database table/collection/etc.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    node: {
      model: 'nodeschema'
    },
    station: {
      model: 'station'
    },
    device: {
      model: 'device'
    },
    station_only: {
      type: 'boolean',
      defaultsTo: false
    }
  }
};
