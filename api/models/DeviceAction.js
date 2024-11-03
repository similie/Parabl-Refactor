/**
 * DeviceAction.js
 *
 * @description :: A model definition represents a database table/collection.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

const {
  DeviceActionBroadcast
} = require('../model-utilities/devices/device-actions/device-action-queues');

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    device: {
      model: 'device',
      required: true
    },

    action: {
      type: 'string'
    },

    topic: {
      type: 'string',
      required: true,
      in: [
        'beco_valve',
        'beco_interval',
        'particle_function',
        'particle_event',
        'mqtt_function',
        'mqtt_event'
      ]
    },

    received: {
      type: 'boolean',
      defaultsTo: false
    },

    ack: {
      type: 'boolean',
      defaultsTo: false
    },

    actor: {
      model: 'user'
    },

    context: {
      type: 'json'
    },

    earlywarning: {
      model: 'earlywarning'
    },

    domain: {
      model: 'domain'
    },

    meta: {
      type: 'json'
    }
  },

  afterCreate: async function(model, next) {
    const id = DeviceAction.getId(model);
    if (!id) {
      return next();
    }

    try {
      const deviceAction = await DeviceAction.findOneById(id);
      const dab = new DeviceActionBroadcast(deviceAction);
      await dab.send();
    } catch (e) {
      sails.log.error(
        'DeviceAction.afterCreate::DeviceActionBroadcast::Error',
        e
      );
    } finally {
      next();
    }
  }
};
