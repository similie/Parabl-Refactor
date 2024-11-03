/**
 * InventoryDemand.js
 *
 * @description :: A model definition represents a database table/collection.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

module.exports = {

  attributes: {

    item: {
      type: 'string'
    },

    action: {
      type: 'string',
      maxLength: 10,
      in: ['request', 'exchange', 'consume', 'deliver']
    }
    
   
  },

};

