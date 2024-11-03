/**
 * Query.js
 *
 * @description :: TODO: You might write a short summary of how this model works and what it represents here.
 * @docs        :: http://sailsjs.org/documentation/concepts/models-and-orm/models
 */

module.exports = {
  attributes: {
    user: {
      model: 'user'
    },

    node: {
      model: 'nodeschema'
    },

    global: {
      type: 'boolean'
    },

    query: {
      type: 'json'
    }
  }
};