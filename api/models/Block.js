/**
 * Block.js
 *
 * @description :: A model definition.  Represents a database table/collection/etc.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

module.exports = {
  migrate: (process.env.MIGRATION || 'safe'),
  attributes: {
  
    entity: {
      required: true,
      type: 'string'
    },

    target: {
      required: true,
      type: 'integer'
    },

    // linked: {
    //   type: 'boolean',
    //   defaultsTo: false
    // }

  }

};
