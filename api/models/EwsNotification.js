/**
 * EwsNotification.js
 *
 * @description :: A model definition represents a database table/collection.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    user: {
      model: 'user'
    },
    eventbroadcast: {
      model: 'eventbroadcast'
    }
  }
};
