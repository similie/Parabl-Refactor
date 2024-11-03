/**
 * StateKeys.js
 *
 * @description :: A model definition.  Represents a database table/collection/etc.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */
const EC = require('elliptic').ec;

// You can use any elliptic curve you want
const ec = new EC('secp256k1');

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    target: {
      type: 'integer',
      required: true,
      min: -2
    },

    identity: {
      type: 'integer',
      min: -2
    },

    entity: {
      type: 'string',
      maxLength: 25,
      required: true
    },

    public_key: {
      type: 'string',
      required: true
    },
    private_key: {
      type: 'string',
      required: true
    },
    toJSON: function() {
      const key = this.toObject();
      delete key.private_key;
      return key;
    }
  },

  beforeCreate: function(values, next) {
    next();
  },

  registerState: async function(entity, type, schema) {
    if (!Model.getId(entity)) {
      return;
    }
    const values = {};
    const key = ec.genKeyPair();
    const publicKey = key.getPublic('hex');
    const privateKey = key.getPrivate('hex');
    if (schema && _.isString(schema)) {
      values.identity = entity[schema];
    } else {
      values.identity = Model.getId(entity);
    }
    values.entity = type;
    values.target = Model.getId(entity);
    values.public_key = publicKey;
    values.private_key = privateKey;
    const sk = await StateKeys.create(values);
    entity.state_key = StateKeys.getId(sk);
    if (
      sails.models[type] &&
      (sails.models[type]._attributes || {}).state_key
    ) {
      await sails.models[type].update(
        { id: Model.getId(entity) },
        { state_key: StateKeys.getId(sk) }
      );
    }

    return entity;
  }
};
