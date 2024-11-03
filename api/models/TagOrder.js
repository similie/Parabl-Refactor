/**
 * TagOrder.js
 *
 * @description :: TODO: You might write a short summary of how this model works and what it represents here.
 * @docs        :: http://sailsjs.org/documentation/concepts/models-and-orm/models
 */

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    order_entity: {
      type: 'string'
    },
    entity_id: {
      type: 'integer'
    },
    order: {
      type: 'array'
    }
  }
};
