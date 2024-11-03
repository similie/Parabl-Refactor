/**
 * CredentialsVerification.js
 *
 * @description :: Verifies the values of a valid email address or phone number.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

const { CommonUtils } = require('similie-api-services');

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  expire: process.env.CREDENTIALS_VERIFY_EXPIRE
    ? +process.env.CREDENTIALS_VERIFY_EXPIRE
    : 1000 * 60 * 20, // expires in 20 minutes
  numberOfDigits: 5,
  variableKey: 'verification_token_request',
  variableIdentity: {
    sms: 'verification_token_request_sms',
    email: 'verification_token_request_email',
    whatsapp: 'verification_token_request_whatsapp'
  },
  checkThreshold: 3,
  attributes: {
    user: {
      model: 'user'
    },

    verify: {
      type: 'string',
      in: ['sms', 'whatsapp', 'email'],
      required: true
    },

    target: {
      type: 'string',
      required: true
    },

    token: {
      type: 'string',
      required: true
    },

    active: {
      type: 'boolean',
      defaultsTo: true
    },

    issued_time: {
      type: 'number',
      required: true
    },

    preferred_language: {
      type: 'string',
      defaultsTo: Translates.fallbackLanguage
    },

    domain: {
      model: 'domain',
      defaultsTo: null
    },

    increment: {
      type: 'integer',
      defaultsTo: 0
    },

    verification_fragment: {
      type: 'integer'
    },
    /**
     * @name isExpired
     * @description instance function that returns
     *   false if the verification is already expired
     * @returns {boolean}
     */
    isExpired: function() {
      const value = this.toObject();
      const now = new Date().getTime();
      const issued = +value.issued_time;
      return now - issued > this.expire;
    },

    verifyMatch: function(match = '') {
      const value = this.toObject();
      return CredentialsVerification.verify(match, value);
    },

    consume: function() {
      const value = this.toObject();
      return CredentialsVerification.update(
        { id: CredentialsVerification.getId(value) },
        { active: false }
      );
    },

    toJSON: function() {
      const value = this.toObject();
      delete value.token;
      return value;
    }
  },

  getFallbackContent(token = '') {
    return CommonUtils.parseLocals(
      `Your verification token is %token%. Do not share this with anyone.`,
      { token: token }
    );
  },

  generateContent: async function(values = {}) {
    const identity = this.variableIdentity[values.verify];
    try {
      const content = await Variable.getLanguageContent(
        this.variableKey,
        values.preferred_language,
        identity
      );
      if (!content) {
        return this.getFallbackContent(values.token);
      }
      return CommonUtils.parseLocals(content, values);
    } catch {
      return this.getFallbackContent(values.token);
    }
  },

  scrambleToken: async function(values = {}) {
    const scrambled = await new Promise((resolve, reject) => {
      CommonUtils.security.hashPassword(values.token, (err, hash) => {
        if (err) {
          return reject(err);
        }
        resolve(hash);
      });
    });
    await this.update({ id: this.getId(values) }, { token: scrambled });
  },

  beforeCreate: async function(values, next) {
    if (values.user) {
      await this.update({ user: this.getId(values.user) }, { active: false });
    }
    await this.update({ target: this.getId(values.target) }, { active: false });
    next();
  },

  getUserFullName: async function(values) {
    const user = values.user;
    if (!user) {
      return '';
    }
    const name = await User.pullFullName(user);
    return name || '';
  },

  sendEmailForTest: async function(sendContent = {}) {
    if (!process.env.PASS_THROUGH) {
      return null;
    }
    const email = await Email.create(sendContent);
    try {
      await email.sendBasic(sendContent.locals);
      return email;
    } catch (e) {
      sails.log.error('TestEmailError::', e.message);
      return email;
    }
  },
  getEmailContent: async function(values = {}) {
    const content = await this.generateContent(values);
    const name = await this.getUserFullName(values);
    const config = await Site.thisSiteAsync(values.domain);
    const sendContent = {
      to: {
        address: values.target,
        name: name
      },
      from: Email.fromDefault(),
      subject: 'Email Verification Request',
      body: content,
      locals: {
        ...values,
        ...config,
        body: content,
        subject: 'Email Verification Request',
        host: Site.buildUrl(config)
      },
      // language: values.preferred_language || Translates.fallbackLanguage,
      template: 'basic',
      // variables: Email.variables.message.key,
      tags: ['user message', 'verification']
    };
    return sendContent;
  },
  sendEmail: async function(values = {}) {
    const sendContent = await this.getEmailContent(values);
    if (Site.isInTestMode()) {
      const email = await this.sendEmailForTest(sendContent);
      await this.update(
        { id: this.getId(values) },
        { verification_fragment: this.getId(email) }
      );
      return;
    }
    Jobs.sendEmail.add(sendContent);
  },

  sendSms: async function(values = {}) {
    if (Site.isInTestMode() && !process.env.PASS_THROUGH) {
      return null;
    }
    const content = await this.generateContent(values);
    // const name = await this.getUserFullName(values);
    const created = await Sms.send(
      values.target,
      content,
      null,
      null,
      values.domain
    );
    Sms.sendValidation(created);
    await this.update(
      { id: this.getId(values) },
      { verification_fragment: this.getId(created) }
    );
  },

  afterCreate: async function(values, next) {
    try {
      switch (values.verify) {
        case 'sms':
          await this.sendSms(values);
          break;
        case 'email':
          await this.sendEmail(values);
          break;
        case 'whatsapp':
          // @todo
          break;
        default:
        // do
      }
    } catch (e) {
      return next(e.message);
    }

    await this.scrambleToken(values);
    next();
  },

  isNotBeingCreated: function(values = {}) {
    return (
      this.getId(values) ||
      values.token ||
      values.increment !== 0 ||
      values.active === false
    );
  },

  beforeValidate: function(values, next) {
    if (this.isNotBeingCreated(values)) {
      return next();
    }
    let token = '';
    for (let i = 0; i < this.numberOfDigits; i++) {
      token += `${_.random(0, 9)}`;
    }
    values.token = token;
    values.issued_time = +new Date().getTime();
    next();
  },

  beforeUpdate: function(values, next) {
    if (values.active) {
      return next('You can not activate a disabled verification');
    }
    next();
  },

  findRelevantCredentials: async function(target) {
    const credentials = await CredentialsVerification.find()
      .where({
        target: target,
        active: true
      })
      .sort({ createdAt: 'DESC' })
      .limit(1);

    const [credential] = credentials;
    return credential;
  },

  verify: async function(match, values = {}) {
    if (!match) {
      throw new Error('The match value cannot be empty');
    }

    const id = this.getId(values);
    if (!id) {
      throw new Error('The token credentials ID is empty');
    }

    const credentials = await this.findOneById(id);
    // credentials.increment = credentials.increment || 0;
    credentials.increment += 1;
    if (credentials.isExpired()) {
      throw new Error('The credentials are expired');
    }

    if (!credentials.active) {
      throw new Error('The credentials are no longer active');
    }
    // we do not want it to occur too many times
    if (credentials.increment > this.checkThreshold) {
      // we consume the attempt
      await credentials.consume();
      throw new Error('The token has failed too many try attempts');
    }
    await this.update(
      { id: this.getId(credentials) },
      { increment: credentials.increment }
    );
    return new Promise((resolve, reject) => {
      CommonUtils.security.comparePassword(
        match,
        credentials.token,
        (err, matches) => {
          if (err) {
            return reject(err);
          }
          resolve(matches);
        }
      );
    });
  }
};
