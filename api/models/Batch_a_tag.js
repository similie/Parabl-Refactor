/**
 * Batch_a_tag.js
 *
 * @description :: A model definition represents a database table/collection.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    batch: {
      model: 'batchreport'
    },

    tag: {
      model: 'tag'
    }
  }
};
