/**
 * VideoCapture.js
 *
 * @description :: TODO: You might write a short summary of how this model works and what it represents here.
 * @docs        :: http://sailsjs.org/documentation/concepts/models-and-orm/models
 */

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    device: {
      type: 'string'
    },
    name: {
      type: 'string'
    },
    poster: {
      type: 'string'
    },
    bucket: {
      type: 'string'
    },

    path: {
      type: 'string'
    },

    year: {
      type: 'string'
    },

    month: {
      type: 'string'
    },

    day: {
      type: 'string'
    },

    size: {
      type: 'integer',
      min: 0
    },

    processing: {
      type: 'boolean',
      defaultsTo: false
    },

    meta: {
      type: 'json'
    }
  }
};
