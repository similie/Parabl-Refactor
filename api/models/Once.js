/**
 * Once.js
 *
 * @description :: A model definition.  Represents a database table/collection/etc.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

module.exports = {
  migrate: (process.env.MIGRATION || 'safe'),
  attributes: {
    player: {
      type: 'integer',
      min: -1
    },

    entity: {
      type: 'string',
      maxLength: 25
    },

    dependent: {
      type: 'string',
      maxLength: 25
    },

    on: {
      type: 'integer',
      min: -1,
    },

    target: {
      type: 'string',
      maxLength: 25
    },

    actor: {
      type: 'integer',
      min: -1
    },

    against_receipt: {
      type: 'array'
    },

    consumed: {
      type: 'boolean',
      defaultsTo: false
    }

  },

};
