/**
 * StockVarianceConfirm.js
 *
 * @description :: A model definition.  Represents a database table/collection/etc.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    stocktake: {
      model: 'stocktake',
      required: true
    },

    schema: {
      model: 'nodeschema'
    },

    sku: {
      type: 'string',
      required: true
    },

    confirmed: {
      type: 'boolean'
    },

    confirmed_by: {
      model: 'user'
    },

    count: {
      type: 'integer'
    },

    count_hold: {
      type: 'integer'
    },

    delta: {
      type: 'integer'
    },

    delta_hold: {
      type: 'integer'
    },

    delta_cost: {
      type: 'float'
    },

    item: {
      type: 'integer'
    },

    total: {
      type: 'float'
    },

    unit_cost: {
      type: 'float'
    },

    start_quantity: {
      type: 'integer'
    },

    end_quantity: {
      type: 'integer'
    },

    explanation: {
      type: 'text'
    }
  }
};
