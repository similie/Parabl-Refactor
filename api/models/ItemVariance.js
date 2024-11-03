/**
 * ItemVariance.js
 *
 * @description :: A model definition.  Represents a database table/collection/etc.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

module.exports = {
  migrate: process.env.MIGRATION || "safe",
  attributes: {
    station: {
      model: "station"
    },
    purchase_order: {
      model: "purchaseorder"
    },
    node: {
      type: "integer"
    },
    quantity: {
      type: "integer"
    },
    value: {
      type: "integer"
    },
    initial_value: {
      type: "integer"
    }
  }
};
