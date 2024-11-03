/**
 * Contractor.js
 *
 * @description :: TODO: You might write a short summary of how this model works and what it represents here.
 * @docs        :: http://sailsjs.org/#!documentation/models
 */

module.exports = {
  attributes: {
    name: 'string',

    department: 'string',

    contractor_status: {
      model: 'variable'
    },

    notes: 'text',

    address: 'text',

    code: {
      type: 'string',
      maxLength: '15'
    },

    id_number: 'string',

    validity_date: 'datetime',

    domain: {
      model: 'domain'
    },
    contact: {
      model: 'contact'
    },
    contractor_type: {
      model: 'variable'
    },
    files: {
      collection: 'sysfile'
    }
  },
  hasPeople: true
};
