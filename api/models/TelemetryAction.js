/**
 * TelemetryAction.js
 *
 * @description :: A model definition represents a database table/collection.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

module.exports = {
  migrate: process.env.MIGRATION || "safe",
  attributes: {
    station: {
      model: "station",
      unique: true
    },

    action: {
      type: "json"
    },

    audience: {
      type: "json"
    },

    forgiveness: {
      type: "integer",
      defaultsTo: 0
    }
  }
};
