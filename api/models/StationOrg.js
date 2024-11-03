/**
 * StationOrg.js
 *
 * @description :: TODO: You might write a short summary of how this model works and what it represents here.
 * @docs        :: http://sailsjs.org/documentation/concepts/models-and-orm/models
 */

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    station: {
      model: 'station'
    },
    organization: {
      model: 'organization'
    },
    assigned_by: {
      model: 'user'
    }
  }
};
