/**
 * Query_recordset.js
 *
 * @description :: This is a model that is used to set reporting data to the json queries in users and stations
 * @docs        :: http://sailsjs.org/documentation/concepts/models-and-orm/models
 */

module.exports = {
  attributes: {
    domain: {
      type: 'integer'
    },

    station: {
      type: 'integer'
    },

    observer: {
      type: 'integer'
    },

    message: {
      type: 'integer'
    },

    user: {
      type: 'integer'
    },

    count: {
      type: 'integer'
    },

    table_name: {
      type: 'string'
    }
  }
};
