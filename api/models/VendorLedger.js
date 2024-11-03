/**
 * VendorLedger.js
 *
 * @description :: A model definition. Represents a database table/collection/etc.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    sku: {
      type: 'string'
    },

    externalvendor: {
      model: 'externalvendor'
    },

    purchase_order: {
      model: 'purchaseorder'
    },

    work_order: {
      model: 'workorder'
    },

    invoices: {
      collection: 'sysfile'
    },

    quantity: {
      type: 'integer'
    },

    domain: {
      model: 'domain'
    },

    meta: {
      type: 'json'
    }
  }
};
