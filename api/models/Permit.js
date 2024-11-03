/**
 * Permit.js
 *
 * @description :: TODO: You might write a short summary of how this model works and what it represents here.
 * @docs        :: http://sailsjs.org/documentation/concepts/models-and-orm/models
 */

module.exports = {
  attributes: {
    model: {
      type: 'string',
      required: true
    },

    domain: {
      model: 'domain'
    },

    action: {
      type: 'string'
    },

    find: {
      type: 'integer',
      defaultsTo: Roles.SIMILIE_ADMIN
    },

    destroy: {
      type: 'integer',
      defaultsTo: Roles.SIMILIE_ADMIN
    },

    create: {
      type: 'integer',
      defaultsTo: Roles.SIMILIE_ADMIN
    },

    update: {
      type: 'integer',
      defaultsTo: Roles.SIMILIE_ADMIN
    }
  }
};
