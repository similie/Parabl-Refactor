/**
 * JobTemplate.js
 *
 * @description :: A model definition represents a database table/collection.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    title: {
      type: 'string'
    },
    description: {
      type: 'text'
    },
    classification: {
      type: 'variable'
    },
    active: {
      type: 'boolean'
    },
    requirements: {
      type: 'array'
    },
    published: {
      type: 'boolean',
      defaultsTo: true
    },
    progression_id: {
      type: 'string'
    },
    requisition_category: {
      model: 'variable'
    },
    requisition_category_weight: {
      type: 'integer',
      defaultsTo: 0
    },
    requisition_sub_category: {
      model: 'variable'
    },
    requisition_sub_category_weight: {
      type: 'integer',
      defaultsTo: 0
    },
    organization: {
      model: 'organizationalcareer'
    },
    copy_of: {
      type: 'integer',
      defaultsTo: 0
    },
    default_role: {
      type: 'integer',
      min: Roles.ANONYMOUS,
      defaultsTo: Roles.REPORTER,
      max: Roles.MANAGER
    },
    volitile: {
      type: 'boolean',
      defaultsTo: false
    },
    competency: {
      type: 'boolean',
      defaultsTo: false
    }
  },
  ATTENDED: 'attended', // compete
  SATISFACTORY: 'satisfactory', // complete and satisfactory
  TIME_IN: 'time_in', // strart to end time
  actions: function() {
    sails.log.debug('JobTemplate.js:: Not yet implemented');
  }
};
