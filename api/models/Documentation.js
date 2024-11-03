/**
 * Documentation.js
 *
 * @description :: A model definition.  Represents a database table/collection/etc.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

module.exports = {
  migrate: process.env.MIGRATION || 'safe', // set to 'alter' to have sails create the table
  attributes: {
    title: {
      type: 'json'
    },

    parent: {
      model: 'documentation'
    },

    text: {
      type: 'json'
    },

    weight: {
      type: 'integer',
      min: 0,
      defaultsTo: 0
    },

    role: {
      type: 'integer',
      defaultsTo: Roles.ANONYMOUS,
      min: Roles.ANONYMOUS,
      max: Roles.SIMILIE_ADMIN
    },

    story: {
      model: 'storyboard'
    },

    files: {
      collection: 'sysfile'
    },

    domain: {
      model: 'domain'
    },

    owner: {
      model: 'user'
    },

    active: {
      type: 'boolean',
      defaultsTo: true
    },

    enabled: {
      type: 'boolean',
      defaultsTo: true
    },

    license: {
      type: 'boolean',
      defaultsTo: false
    }
  },

  beforeCreate: async function(values, cb) {
    if (values.weight != null) {
      return cb();
    }

    const count = await Documentation.count({
      parent: Documentation.getId(values.parent)
    });
    values.weight = count;
    cb();
  }
};
