/**
 * EventRegistration.js
 *
 * @description :: Binds the user to a registered EW event
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

const { CommonUtils } = require('similie-api-services');

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  variableIdentity: {
    key: 'event_registration_confirmation',
    identities: {
      body: 'event_registration_body',
      sms: 'event_registration_sms',
      subject: 'event_registration_subject'
    }
  },
  attributes: {
    user: {
      model: 'user'
    },

    event: {
      model: 'earlywarning'
    },

    active: {
      type: 'boolean',
      defaultsTo: true
    },

    meta: {
      type: 'json'
    }
  },

  /**
   * Sends an SMS to a subscriber with the provided content.
   *
   * @async
   * @function sendSubscriptionSmsContent
   * @param {Object} data - The data for the SMS.
   * @param {Object} data.subscriber - The subscriber to whom the SMS will be sent.
   * @param {string} data.subscriber.phone - The phone number of the subscriber.
   * @param {string} data.subscriber.language - The language preference of the subscriber.
   * @param {Object} data.content - The content of the SMS in different languages.
   * @param {Object} data.config - The configuration details.
   * @param {string} data.config.domain - The domain name.
   * @returns {Promise<boolean>} Returns `true` if the SMS was sent successfully, `false` otherwise.
   */
  sendSubscriptionSmsContent: async function(data = {}) {
    const subscriber = data.subscriber || {};
    const locals = this.getLocals(data);
    const content =
      data.content[subscriber.language] ||
      data.content[Translates.fallbackLanguage];
    const formattedMessage = CommonUtils.parseLocals(content, locals);
    try {
      const created = await Sms.send(
        subscriber.phone,
        formattedMessage,
        null,
        null,
        data.config.domain
      );
      Sms.sendValidation(created);
      const value = Array.isArray(created) ? created[0] : created;
      return !!value.id;
    } catch (e) {
      sails.log.error(
        'EventRegistration.sendSubscriptionSmsContent',
        e.message
      );
    }
    return false;
  },

  _processors: [
    {
      name: 'ewsSubscriptionSms',
      process: async function(job) {
        const data = job.data;
        await EventRegistration.sendSubscriptionSmsContent(data);
      },
      stats: SailsExtensions.stats({
        failed: function(_job, err) {
          console.error('EWS SUBSCRIPTION SMS ERROR::', err);
        }
      })
    }
  ],

  /**
   * Sends an SMS to a subscriber.
   * @function sendSubscriptionSms
   * @param {Object} data - The data for the SMS.
   * @returns {boolean} Returns true if the job was added to the queue successfully, false otherwise.
   */
  sendSubscriptionSms: function(data = {}) {
    const subscriber = data.subscriber || {};
    if (!subscriber.phone) {
      return false;
    }
    if (Site.isInTestMode() && !process.env.PASS_THROUGH) {
      return false;
    }
    if (Site.isInTestMode()) {
      return this.sendSubscriptionSmsContent(data);
    }
    Jobs.ewsSubscriptionSms.add(data);
    return true;
  },

  /**
   * Sends an email to a subscriber.
   * @function sendSubscriptionEmail
   * @param {Object} data - The data for the email.
   */
  sendSubscriptionEmail: function(data = {}) {
    if (Site.isInTestMode()) {
      return this.processEwEmailToSubscriberTest(data);
    }
    return this.processEwEmailToSubscriber(data);
  },

  /**
   * Processes an email to a subscriber in test mode.
   * @async
   * @function processEwEmailToSubscriberTest
   * @param {Object} data - The data for the email.
   * @returns {boolean} Returns true if the email was processed successfully, false otherwise.
   */
  processEwEmailToSubscriberTest: async function(data = {}) {
    if (!process.env.PASS_THROUGH) {
      return false;
    }
    await this.processEwEmailToSubscriber(data);
    return true;
  },

  /**
   * Gets the locals for an email.
   * @function getLocals
   * @param {Object} data - The data for the email.
   * @returns {Object} Returns an object with the locals for the email.
   */
  getLocals: function(data = {}) {
    const subscriber = data.subscriber || {};
    const l = EWS.setLocals(data);
    const _loc = {
      ...l
    };
    _loc.NAME = subscriber.name;
    _loc.EMAIL = subscriber.email;
    _loc.PHONE = subscriber.phone;
    return _loc;
  },

  /**
   * Retrieves the email content.
   * @function getEmailContent
   * @param {Object} data - The data for the email.
   * @returns {string} Returns the email content as a string.
   */
  getEmailContent: async function(data = {}) {
    const subscriber = data.subscriber || {};
    const config = data.config;
    const defaultEMAIL =
      '%NAME%, %SITE% has detected that a warning has been triggered at "%STATION%"';
    const message = data.content || {};
    const locals = this.getLocals(data);
    locals.body =
      message[subscriber.language] ||
      message[Translates.fallbackLanguage] ||
      defaultEMAIL;
    return {
      to: {
        address: subscriber.email,
        name: subscriber.name
      },
      subject:
        message.subject ||
        CommonUtils.parseLocals('%SITE% Event Subscription', locals),
      locals: locals,
      default_language: subscriber.language || config.default_language || 'en',
      template: 'ews',
      variables: Email.variables.ews.key,
      tags: ['early warning alert', 'parabl', 'events', 'subscription']
    };
  },
  /**
   * Retrieves the variables for a test email.
   * @async
   * @function getVariablesForTest
   * @param {Object} emailContent - The content of the email.
   * @returns {Promise<Object>} Returns a promise that resolves with the variables for the test email.
   * @throws Will throw an error if the email parsing fails.
   */
  getVariablesForTest: async function(emailContent = {}) {
    const variables = await Variable.find({ key: emailContent.variables });
    const vars = await new Promise((resolve, reject) => {
      Email.parseEmailVars(
        emailContent.template,
        variables,
        emailContent.default_language,
        (err, vars) => {
          if (err) {
            return reject(new Error(err));
          }
          resolve(vars);
        }
      );
    });
    emailContent.locals.email_vars = vars;
  },

  /**
   * Processes an email to a subscriber.
   * @async
   * @function processEwEmailToSubscriber
   * @param {Object} data - The data for the email.
   * @returns {boolean} Returns true if the email was processed successfully, false otherwise.
   */
  processEwEmailToSubscriber: async function(data = {}) {
    const content = await this.getEmailContent(data);
    if (!Site.isInTestMode()) {
      Jobs.sendEmail.add(content);
      return true;
    }
    content.from = Email.fromDefault();
    await this.getVariablesForTest(content);
    const email = await Email.create(content);
    try {
      await email.sendBasic(content.locals);
      return !!email.id;
    } catch (e) {
      sails.log.error('TestEmailError::', e.message);
      return false;
    }
  },

  /**
   * Retrieves the subscriptions on an event.
   * @async
   * @function getSubscriptionsOnEvent
   * @param {Object} event - The event to get subscriptions for.
   * @returns {Promise<Array>} Returns a promise that resolves with the subscriptions on the event.
   */
  getSubscriptionsOnEvent: function(earlywarning) {
    const id = this.getId(earlywarning);
    if (!id) {
      return [];
    }
    return this.find()
      .where({
        event: id,
        active: true
      })
      .populateAll();
  },

  /**
   * Checks if a registration matches the current session.
   * @function matchedRegistration
   * @param {Object} req - The request object, which includes the session and parameters.
   * @returns {boolean} Returns true if the registration matches the current session, false otherwise.
   */
  matchedRegistration: function(req) {
    if (!req.session.eventRegistered) {
      return false;
    }
    const params = req.params.all();

    if (!params.id) {
      return false;
    }
    return this.getId(req.session.eventRegistered) === +this.getId(params);
  },

  /**
   * Handles a verification request.
   * @async
   * @function verificationRequest
   * @param {Object} req - The request object, which includes the session and parameters.
   * @param {Object} res - The response object.
   * @returns {Promise<void>} Returns a promise that resolves with the response object.
   */
  verificationRequest: async function(req, res) {
    const params = req.params.all();
    const id = params.id;
    if (!id) {
      return res.badRequest();
    }
    const user = await User.findOneById(id);
    if (!user) {
      return res.badRequest();
    }
    const verify = params.verify || 'email';
    const token = params.token;
    const targetValue = user[verify === 'email' ? verify : 'phone'];
    const credential = await CredentialsVerification.findRelevantCredentials(
      targetValue
    );
    if (!credential) {
      return res.badRequest();
    }
    const valid = await credential.verifyMatch(token);
    if (valid) {
      await credential.consume();
      req.session.eventRegistered = user;
    }
    return res.send({ valid });
  },

  /**
   * Handles a removal request.
   * @async
   * @function removalRequest
   * @param {Object} req - The request object, which includes the session and parameters.
   * @param {Object} res - The response object.
   * @returns {Promise<void>} Returns a promise that resolves with the updated registration object.
   */
  removalRequest: async function(req, res) {
    const params = req.params.all();
    const sId = Model.getId(params.subscription);
    if (!sId) {
      return res.badRequest({ error: 'No subscription found' });
    }
    const registration = await EventRegistration.update(
      { user: params.id, event: sId, active: true },
      { active: false }
    );
    return res.send(registration);
  },

  /**
   * Checks if the entry is valid.
   * @function checkValidEntry
   * @param {Object} req - The request object, which includes the session and parameters.
   * @throws Will throw an error if the entry is not valid.
   */
  checkValidEntry: function(req) {
    const params = req.params.all();
    if (User.is(req.user, Roles.SIMILIE_ADMIN)) {
      return;
    }
    if (
      req.session.eventRegistered &&
      this.getId(req.session.eventRegistered) !== params.id
    ) {
      return;
    }
    throw new Error('You are not permitted to view this content');
  },

  /**
   * Retrieves the subscription path for a user.
   * @function getSubscriptionPath
   * @param {Object} user - The user object.
   * @returns {string} Returns the subscription path.
   */
  getSubscriptionPath: function(user = {}) {
    return `events/subscriptions/${this.getId(user)}`;
  },

  /**
   * Combines user and configuration data.
   * @function combineLocals
   * @param {Object} user - The user object.
   * @param {Object} config - The configuration object.
   * @returns {Object} Returns an object with the combined user and configuration data.
   */
  combineLocals: function(user, config = {}) {
    const name = User.fullName(user);
    return {
      full_name: name,
      user: user,
      ...config,
      href: `${Site.buildUrl(config)}/${this.getSubscriptionPath(user)}`
    };
  },

  /**
   * Retrieves the default body for an email.
   * @function getDefaultBody
   * @param {Object} locals - The local variables for the email.
   * @returns {string} Returns the default body for an email.
   */
  getDefaultBody: function(locals = {}) {
    return CommonUtils.parseLocals(
      `This confirms your registration to the %site_name% action network. Manage your subscriptions at <a href="%href%">%site_name%</a>`,
      locals
    );
  },

  /**
   * Retrieves the default body for an SMS.
   * @function getDefaultSmsBody
   * @param {Object} locals - The local variables for the SMS.
   * @returns {string} Returns the default body for an SMS.
   */
  getDefaultSmsBody: function(locals = {}) {
    return CommonUtils.parseLocals(
      `This confirms your registration to the %site_name% action network. Manage your subscriptions at %href%`,
      locals
    );
  },

  /**
   * Retrieves the default subject for an email.
   * @function getDefaultSubject
   * @param {Object} locals - The local variables for the email.
   * @returns {string} Returns the default subject for an email.
   */
  getDefaultSubject: function(locals = {}) {
    return CommonUtils.parseLocals(
      `%full_name%, your %site_name% registration`,
      locals
    );
  },

  /**
   * Retrieves the default content type for an email or SMS.
   * @function getDefaultContentType
   * @param {Object} locals - The local variables for the email or SMS.
   * @param {string} type - The type of content ('body', 'subject', or other).
   * @returns {string} Returns the default content for the specified type.
   */
  getDefaultContentType: function(locals, type = 'body') {
    return type === 'body'
      ? this.getDefaultBody(locals)
      : type === 'subject'
      ? this.getDefaultSubject(locals)
      : this.getDefaultSmsBody(locals);
  },

  /**
   * Generates the content for a message.
   * @async
   * @function generateMessageContent
   * @param {Object} user - The user object.
   * @param {Object} config - The configuration object.
   * @param {string} type - The type of content ('body', 'subject', or other).
   * @returns {Promise<string>} Returns a promise that resolves with the generated content for the message.
   */
  generateMessageContent: async function(user, config, type = 'body') {
    const identity = this.variableIdentity[type];
    const locals = this.combineLocals(user, config);
    try {
      const content = await Variable.getLanguageContent(
        this.variableIdentity.key,
        user.preferred_language,
        identity
      );

      if (!content) {
        return this.getDefaultContentType(locals, type);
      }
      return CommonUtils.parseLocals(content, locals);
    } catch {
      return this.getDefaultContentType(locals, type);
    }
  },

  /**
   * Generates the content for a confirmation email.
   * @async
   * @function confirmationEmailContent
   * @param {Object} user - The user object.
   * @returns {Promise<string>} Returns a promise that resolves with the content for the confirmation email.
   * @throws Will throw an error if the content generation fails.
   */
  confirmationEmailContent: async function(user) {
    const name = User.fullName(user);
    const config = await Site.thisSiteAsync(user.last_domain);
    const content = await this.generateMessageContent(user, config);
    const subject = await this.generateMessageContent(user, config, 'subject');
    const sendContent = {
      to: {
        address: user.email,
        name: name
      },
      from: Email.fromDefault(),
      subject: subject,
      body: content,
      locals: {
        ...config,
        body: content,
        subject: subject,
        host: Site.buildUrl(config)
      },
      language: user.preferred_language || Translates.fallbackLanguage,
      template: 'basic',
      // variables: Email.variables.message.key,
      tags: ['user message', 'registration', 'confirmation']
    };
    return sendContent;
  },

  /**
   * Sends a test email to a user.
   * @async
   * @function sendEmailForTest
   * @param {Object} user - The user object.
   * @returns {Promise<Object|null>} Returns a promise that resolves with the email object if the email was sent successfully, null otherwise.
   * @throws Will log an error if the email sending fails.
   */
  sendEmailForTest: async function(user) {
    if (!process.env.PASS_THROUGH) {
      return null;
    }
    const sendContent = await this.confirmationEmailContent(user);
    const email = await Email.create(sendContent);
    try {
      await email.sendBasic(sendContent.locals);
      return email;
    } catch (e) {
      sails.log.error('TestEmailError::', e.message);
      return email;
    }
  },

  /**
   * Sends a confirmation email to a user.
   * @async
   * @function sendConfirmationEmail
   * @param {Object} user - The user object.
   * @returns {Promise<void>} Returns a promise that resolves when the email has been added to the job queue.
   */
  sendConfirmationEmail: async function(user = {}) {
    if (Site.isInTestMode()) {
      return this.sendEmailForTest(user);
    }
    const sendContent = await this.confirmationEmailContent(user);
    Jobs.sendEmail.add(sendContent);
  },

  /**
   * Sets the confirmation text for a user.
   * @async
   * @function setConfirmationText
   * @param {Object} user - The user object.
   * @returns {Promise<Object|null>} Returns a promise that resolves with the created SMS object if the SMS was sent successfully, null otherwise.
   */
  setConfirmationText: async function(user) {
    if (Site.isInTestMode() && !process.env.PASS_THROUGH) {
      return null;
    }
    const config = await Site.thisSiteAsync(user.last_domain);
    const content = await this.generateMessageContent(user, config, 'sms');
    const created = await Sms.send(
      user.phone,
      content,
      null,
      null,
      user.last_domain
    );
    return created;
  },
  /**
   * Sends a confirmation to a user via email or SMS.
   * @async
   * @function confirm
   * @param {Object} user - The user object.
   * @returns {Promise<void>} Returns a promise that resolves when the confirmation has been sent.
   */
  confirm: async function(user) {
    if (!user.email && !user.phone) {
      return;
    }

    if (user.email) {
      return this.sendConfirmationEmail(user);
    }
    return this.setConfirmationText(user);
  }
};
