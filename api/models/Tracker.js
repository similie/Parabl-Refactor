/**
 * Tracker.js
 *
 * @description :: TODO: You might write a short summary of how this model works and what it represents here.
 * @docs        :: http://sailsjs.org/documentation/concepts/models-and-orm/models
 */
const shortid = require('shortid');
const uuid = require('uuid');
const randomstring = require('randomstring');

module.exports = {
  attributes: {
    code: {
      type: 'string',
      unique: true
    },

    domain: {
      model: 'domain'
    }
  },

  FAILOUT_THRESHOLD: 20,

  findCodeBody: async function(type, length, extras, counter) {
    counter = counter || 0;

    if (counter >= Tracker.FAILOUT_THRESHOLD) {
      throw new Error('Unique Code Unavailable');
    }
    const code = Tracker.buildRandomId(type, length, extras, counter++);
    const found = await Tracker.findOne({ code: code });
    if (found) {
      return await Tracker.findCodeBody(code);
    } else {
      await Tracker.create({ code: code });
      return code;
    }
  },

  generateRandomString: function(length = 12, extras = {}) {
    return randomstring.generate({
      length: parseInt(length),
      charset: extras.alphanumeric ? 'alphanumeric' : 'numeric',
      capitalization: extras.capitalization
        ? extras.capitalization
        : 'uppercase'
    });
  },

  buildRandomId: function(type = 'randomstring', length = 12, extras = {}) {
    let code;
    switch (type) {
      case 'uuid':
        code = uuid.v4();
        break;
      case 'short':
        code = shortid.generate();
        break;
      default:
        code = this.generateRandomString(length, extras);
    }

    return code;
  },

  publicApiProtect: async function(timeout = 5000) {
    const randomString = this.generateRandomString(null, {
      alphanumeric: true,
      capitalization: 'lowercase'
    });
    const code = uuid.v4();
    const values = { [randomString]: code };

    const saved = await Session.setEphemeral(
      randomString,
      code,
      Math.ceil(timeout / 1000)
    );
    if (saved !== 'OK') {
      throw new Error('There was an error saving your protection key');
    }
    return values;
  },

  publicApiValidateKeyVal: async function(key, value) {
    const saved = await Session.getEphemeral(key);
    if (!saved) {
      return false;
    }
    return saved === value;
  },

  publicApiValidate: async function(validationObj = {}) {
    const keys = Object.keys(validationObj);
    if (keys.length !== 1) {
      throw new Error('The validation object is invalid');
    }
    const [key] = keys;
    return this.publicApiValidateKeyVal(key, validationObj[key]);
  },

  pubicApiValidateRequest: async function(req) {
    const params = req.params.all();
    if (!params.__validation__) {
      throw new Error('The validation values are not in the request');
    }
    const values = Array.isArray(params.__validation__)
      ? params.__validation__.pop()
      : params.__validation__;
    const valid = await this.publicApiValidate(values);
    if (!valid) {
      throw new Error('This is not a valid request ');
    }
    return valid;
  },

  publicPostControllerProtect: async function(req, res) {
    if (req.method === 'GET') {
      const token = await Tracker.publicApiProtect();
      res.send(token);
      return false;
    }

    if (req.method !== 'POST') {
      res.notFound();
      return false;
    }

    try {
      await Tracker.pubicApiValidateRequest(req);
    } catch (e) {
      console.error('REGISTER ERROR', e.message);
      res.notFound();
      return false;
    }

    return true;
  }
};
