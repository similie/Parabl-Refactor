/**
 * BadgeBlock.js
 *
 * @description :: A model definition represents a database table/collection.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

module.exports = {
  migrate: process.env.MIGRATION || "safe", // set to 'alter' to have sails create the table
  attributes: {
    rank: {
      type: "integer",
      min: 0
    },

    title: {
      type: "string"
    },

    description: {
      type: "text"
    },

    meta: {
      type: "json"
    }
  }
};
