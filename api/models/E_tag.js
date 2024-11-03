/**
 * E_tags.js
 *
 * @description :: A model definition represents a database table/collection.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    earlywarning: {
      model: 'earlywarning'
    },

    tag: {
      model: 'tag'
    }
  }
};
