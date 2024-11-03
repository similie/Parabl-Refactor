/**
 * Sms.js
 *
 * @description :: TODO: You might write a short summary of how this model works and what it represents here.
 * @docs        :: http://sailsjs.org/documentation/concepts/models-and-orm/models
 */

const Twilio = require('twilio');
const BullQueue = require('../services/BullQueue');
module.exports = {
  timeoutValue: 1000 * 60 * 1,
  attributes: {
    apiMessageId: 'string',
    accepted: 'boolean',
    to: 'string',
    message: 'string',
    node: 'integer',
    error: 'string',
    price: 'float',
    price_unit: 'string',
    status: 'string',
    domain: {
      model: 'domain'
    }
  },
  _processors: [
    BullQueue.jobTemplate(
      job => {
        return Sms.processVerification(job.data);
      },
      'smsVerification',
      {
        failed: function(_job, err) {
          console.error('smsVerification::ERROR::', err);
        }
      }
    )
  ],

  packMessages: async function(messages = [], message, node, domain) {
    if (!_.size(messages)) {
      return messages;
    }

    const n = Model.getId(node);
    const saveMessages = [];

    for (let i = 0; i < messages.length; i++) {
      const pin = {};
      const m = messages[i];
      pin.message = message;
      pin.node = n;
      pin.domain = Domain.getId(domain);
      pin.to = m.to;
      pin.apiMessageId = m.apiMessageId || m.sid;
      pin.accepted = m.status ? m.status === 'queued' : m.accepted || false;
      pin.error = m.error;
      saveMessages.push(pin);
    }

    const created = await Sms.create(saveMessages);
    return created;
  },

  sendTwillio: async function(to, message, integrations) {
    const client = this.getTwillioClient(integrations);
    const messages = [];
    for (let i = 0; i < to.length; i++) {
      const _to = to[i];
      if (_to == null) {
        continue;
      }
      let number = _to || '+';
      if (!number.startsWith('+')) {
        number = `+${number}`;
      }
      const response = await client.messages.create({
        body: message,
        to: number, // Text this number
        from: '+' + integrations.twilio_number // From a valid Twilio number
      });
      messages.push(response);
    }
    return messages;
  },

  getTwillioClient: function(integrations = {}) {
    return new Twilio(integrations.twilio_sid, integrations.twilio_token);
  },

  processTwillioVerification: async function(smsModel = {}, integrations = {}) {
    if (!this.getId(smsModel) || !smsModel.apiMessageId) {
      return null;
    }

    const client = this.getTwillioClient(integrations);
    const { status, price, errorMessage, priceUnit } = await client
      .messages(smsModel.apiMessageId)
      .fetch();
    return this.update(
      { id: this.getId(smsModel) },
      { status, price, error: errorMessage, price_unit: priceUnit }
    );
  },

  processVerification: async function(smsModel = {}) {
    const site = await Site.thisSiteAsync(smsModel.domain);
    const integrations = site.integrations || {};
    if (this.isTwillioIntegrated(integrations)) {
      return this.processTwillioVerification(smsModel, integrations);
    }
    throw new Error('Not Yet Implemented');
  },

  verificationCheck: function(smsModel = {}) {
    if (!this.getId(smsModel)) {
      return;
    }
    if (Site.isInTestMode()) {
      return setTimeout(() => {
        this.processVerification(smsModel);
      }, this.timeoutValue);
    }
    Jobs.smsVerification.add(smsModel, { delay: this.timeoutValue });
  },

  sendValidation: function(createdSms) {
    const values = Array.isArray(createdSms) ? createdSms : [createdSms];
    for (const value of values) {
      this.verificationCheck(value);
    }
  },

  getClicktelToken: function(integrations) {
    const token = (integrations.clickatell || '').trim();
    return token;
  },

  sendClickTel: function(to, message, integrations) {
    return new Promise((resolve, reject) => {
      const token = this.getClicktelToken(integrations);
      if (!token) {
        return;
      }
      const clickatell = require('clickatell-node').rest(token);
      clickatell.sendMessage(to, message, {}, async (err, messages) => {
        if (err) {
          sails.log.error(err);
          return reject(err);
        }
        resolve(messages);
      });
    });
  },

  isTwillioIntegrated: function(integrations) {
    let twil = false;
    if (
      integrations.twilio_token &&
      integrations.twilio_sid &&
      integrations.twilio_number
    ) {
      twil = true;
    }
    return twil;
  },

  formatTo: function(to) {
    if (!Array.isArray(to)) {
      to = [to];
    }
    return to.filter(t => !!t);
  },

  send: async function(to, message, node, device, domain) {
    const domainSearch = (device || {}).domain || domain || null;
    const site = await Site.thisSiteAsync(domainSearch);
    const integrations = {
      ...((site || {}).integrations || {})
    };

    if (_.size((device || {}).integrations)) {
      Object.assign(integrations, device.integrations);
    }
    const twil = this.isTwillioIntegrated(integrations);
    if (!twil && !integrations.clickatell) {
      throw new Error('errors.NO_INTEGRATION_FOUND');
    }
    const send = this.formatTo(to);
    if (twil) {
      const messages = await this.sendTwillio(send, message, integrations);
      const created = await this.packMessages(messages, message, node, domain);
      return created;
    } else {
      const messages = await this.sendClickTel(send, message, integrations);
      const created = await this.packMessages(messages, message, node, domain);
      return created;
    }
  }
};
