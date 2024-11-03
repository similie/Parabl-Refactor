/**
 * WorkOrderTaskTemplate.js
 *
 * @description :: TODO: You might write a short summary of how this model works and what it represents here.
 * @docs        :: http://sailsjs.org/documentation/concepts/models-and-orm/models
 */

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    order: {
      type: 'integer',
      min: 0,
      defaultsTo: 0,
    },

    name: {
      type: 'string',
    },

    details: {
      type: 'text',
    },

    estimated_time: {
      type: 'integer',
    },

    required_parts: {
      type: 'array',
    },

    files: {
      collection: 'sysfile',
    },
  },
};
