/**
 * Hearbeat.js
 *
 * @description :: Stores the heartbeat events coming off the devices in .
 * @docs        :: todo: http://
 */

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    device: {
      type: 'string',
      required: true
    },
    date: {
      type: 'datetime'
    },
    cellular: {
      type: 'json'
    },
    power: {
      type: 'json'
    },
    system: {
      type: 'json'
    },
    meta: {
      type: 'json'
    }
  }
};
