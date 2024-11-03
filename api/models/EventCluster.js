/**
 * EventCluster.js
 *
 * @description :: A model definition.  Represents a database table/collection/etc.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    name: {
      type: 'string'
    },

    fragment_id: {
      type: 'uuid'
      // required: true
    },

    station: {
      model: 'station'
    },

    forgive_count: {
      type: 'integer',
      min: 0
    },

    timeout: {
      type: 'integer',
      min: 0
    },

    forgive_timeout: {
      type: 'integer'
    },

    active: {
      type: 'boolean',
      defaultsTo: true
    },

    actions: {
      type: 'json'
    },

    owner: {
      model: 'user'
    },

    earlywarnings: {
      collection: 'earlywarning',
      through: 'ec_ew'
    },

    last_triggered: {
      type: 'datetime'
    },

    color: {
      type: 'string',
      maxLength: 50
    },

    device: {
      model: 'device'
    },

    public: {
      type: 'boolean',
      defaultsTo: false
    },

    public_id: {
      type: 'string'
    },

    public_description: {
      type: 'json'
    },

    meta: {
      type: 'json'
    },

    tags: {
      collection: 'tag',
      through: 'ec_tag'
    }
  },

  beforeCreate: function(values, next) {
    if (!values.color) {
      values.color = Utils.color();
    }
    EarlyWarning.generatePublicId(values);
    next();
  },

  beforeUpdate: function(values, next) {
    EarlyWarning.generatePublicId(values);
    next();
  }
};
