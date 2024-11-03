/**
 * Role.js
 *
 * @description :: TODO: You might write a short summary of how this model works and what it represents here.
 * @docs        :: http://sailsjs.org/documentation/concepts/models-and-orm/models
 */

module.exports = {
  migrate: (process.env.MIGRATION || 'safe'),
  attributes: {
    domain: {
      model: 'domain'
    },

    name: {
      type: 'string'
    },

    description: {
      type: 'text'
    },

    role: {
      type: 'integer'
    },

    meta: {
      type: 'json'
    }
  }
};
