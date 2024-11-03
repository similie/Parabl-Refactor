/**
 * TelemetryEvent.js
 *
 * @description :: A model definition represents a database table/collection.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    session: {
      type: 'string',
      required: true
    },
    action: {
      type: 'string',
      in: [
        'speed',
        'temperature',
        'boundary',
        'fuel',
        'humidity',
        'daily_restrict',
        'maintenance'
      ]
    },
    count: {
      type: 'integer',
      defaultsTo: 0
    }
  }
};
