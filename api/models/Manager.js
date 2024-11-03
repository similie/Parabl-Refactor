/**
 * Manager.js
 *
 * @description :: This model manages the list of users who manage a resource
 * @docs        :: http://sailsjs.org/#!documentation/models
 * @todo		   :: add a life cycle callback for ensuring the users is  manager
 */

module.exports = {
  attributes: {
    manager: {
      model: 'user'
    },

    direct_report: {
      model: 'user'
    },

    relationship: {
      model: 'variable'
    },

    meta: {
      type: 'json'
    }
  }
};
