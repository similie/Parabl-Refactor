/**
 * Badging.js
 *
 * @description :: A model definition represents a database table/collection.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

module.exports = {
  migrate: process.env.MIGRATION || "safe",
  attributes: {
    name: {
      type: "string"
    },

    description: {
      type: "string"
    },

    url: {
      type: "string"
    },

    body: {
      type: "text"
    },

    active: {
      type: "boolean",
      defaultsTo: true
    },

    domain: {
      model: "domain"
    }
  }
};
