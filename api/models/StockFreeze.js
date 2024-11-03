/**
 * StockFreezeze.js
 *
 * @description :: A model definition.  Represents a database table/collection/etc.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

module.exports = {
  migrate: process.env.MIGRATION || "safe",
  attributes: {
    //  ╔═╗╦═╗╦╔╦╗╦╔╦╗╦╦  ╦╔═╗╔═╗
    //  ╠═╝╠╦╝║║║║║ ║ ║╚╗╔╝║╣ ╚═╗
    //  ╩  ╩╚═╩╩ ╩╩ ╩ ╩ ╚╝ ╚═╝╚═╝

    //  ╔═╗╔╦╗╔╗ ╔═╗╔╦╗╔═╗
    //  ║╣ ║║║╠╩╗║╣  ║║╚═╗
    //  ╚═╝╩ ╩╚═╝╚═╝═╩╝╚═╝

    //  ╔═╗╔═╗╔═╗╔═╗╔═╗╦╔═╗╔╦╗╦╔═╗╔╗╔╔═╗
    //  ╠═╣╚═╗╚═╗║ ║║  ║╠═╣ ║ ║║ ║║║║╚═╗
    //  ╩ ╩╚═╝╚═╝╚═╝╚═╝╩╩ ╩ ╩ ╩╚═╝╝╚╝╚═╝

    stocktake: {
      model: "stocktake",
      required: true
    },

    currency: {
      type: "string",
      maxLength: 5
    },

    stage: {
      type: "string",
      maxLength: 5,
      in: ["start", "end"]
    },

    sku: {
      type: "string"
    },

    total: {
      type: "integer"
    },

    unit: {
      type: "integer"
    },

    node: {
      type: "integer"
    },

    quantity: {
      type: "integer"
    },

    schema: {
      model: "nodeschema"
    },

    // freezer: {
    //     type: 'json'
    // },

    frozen_by: {
      model: "user"
    }
  }
};
