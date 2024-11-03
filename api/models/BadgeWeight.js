/**
 * BadgeWeight.js
 *
 * @description :: A model definition represents a database table/collection.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    badge: {
      model: 'badge'
    },

    organization: {
      model: 'organization'
    },

    weight: {
      type: 'integer',
      min: 0
    }
  },

  maxWeight: function(badges) {
    let index = -1;
    let max = -1;
    for (let i = 0; i < _.size(badges); i++) {
      const badge = badges[i];
      if (badge.weight > max) {
        max = badge.weight;
        index = i;
      }
    }

    return index === -1 ? null : badges[index];
  }
};
