/**
 * Badge.js
 *
 * @description :: TODO: You might write a short summary of how this model works and what it represents here.
 * @docs        :: http://sailsjs.org/documentation/concepts/models-and-orm/models
 */

module.exports = {
  migrate: process.env.MIGRATION || 'safe', // set to 'alter' to have sails create the table
  attributes: {
    domain: {
      model: 'domain'
    },
    name: {
      type: 'string',
      required: true
    },
    variety: {
      model: 'variable'
    },
    group: {
      type: 'string'
    },
    icon: {
      type: 'json'
    },
    rank: {
      type: 'integer',
      min: 0
    },
    description: {
      type: 'text'
    },
    badgeblock: {
      model: 'badgeblock'
    },
    meta: {
      type: 'json'
    }
  }
};
