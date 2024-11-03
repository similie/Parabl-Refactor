const { Common } = require('../common/common');
const { EwsActionUtils } = require('./ews/ews-action-utils');

class EarlyWarningSubscription {
  errors = {
    errorValue: 'EarlyWarningSubscription',
    instantiate: 'We cannot instantiate this class without an event',
    instantiateEWS: 'We cannot instantiate this class without an event instance'
  };

  SMS_CHAR_LENGTH = 140;
  eventType = {
    SMS: 'sms',
    EMAIL: 'email'
  };

  /**
   * @constructor
   * @param {EarlyWarning} earlyWarning
   * @param {EWS} ews
   */
  constructor(earlyWarning, ews) {
    if (!earlyWarning) {
      throw new Error(this.errors.instantiate);
    }
    if (!ews) {
      throw new Error(this.errors.instantiateEWS);
    }
    this.earlyWarning = earlyWarning;
    this.ews = ews;
    this.utils = new EwsActionUtils();
  }

  get utils() {
    return this._utils;
  }

  set utils(utils) {
    this._utils = utils;
  }

  get ews() {
    return this._ews || {};
  }

  set ews(ews = {}) {
    this._ews = ews;
  }

  get earlyWarning() {
    return this._earlyWarning;
  }

  set earlyWarning(earlyWarning) {
    this._earlyWarning = earlyWarning;
  }

  get subscriptions() {
    return this._subscriptions || [];
  }

  set subscriptions(subscriptions = []) {
    this._subscriptions = subscriptions;
  }

  get targetId() {
    return this.ews.target;
  }

  get target() {
    return this._target;
  }

  set target(target) {
    this._target = target;
  }

  get nodeSchema() {
    return this._nodeSchema;
  }

  set nodeSchema(nodeSchema) {
    this._nodeSchema = nodeSchema;
  }

  get config() {
    return this._config;
  }

  set config(config) {
    this._config = config;
  }

  get station() {
    return this._station || null;
  }

  set station(station) {
    this._station = station;
  }

  get eventLocals() {
    return EWS.setLocals(this.localsPayload);
  }

  get languages() {
    return this.config.languages || [Translates.fallbackLanguage];
  }

  get fallbackLang() {
    return `HELLO %NAME%,
      You subscribed to an event notification for %STATION%. This is a notification that an event has occurred
    `;
  }

  get hasSms() {
    return this.config.public_sms || Site.isInTestMode();
  }

  async pullNodeSchema() {
    const nodeschema = this.earlyWarning.node;
    if (Number.isInteger(nodeschema)) {
      const nodeSchema = await NodeSchema.findOneById(nodeschema);
      this.nodeSchema = nodeSchema;
    } else {
      this.nodeSchema = nodeschema;
    }
  }

  async pullStation() {
    if (this.station) {
      return;
    }
    const stationId = this.earlyWarning.station;
    if (!this.utils.isActionableStation(stationId)) {
      return;
    }
    this.station = await Station.findOneById(stationId);
  }

  async pullTarget() {
    this.target = await Node.findOneById(this.targetId, this.nodeSchema);
  }

  localsPayload(content = {}, user = {}) {
    return {
      ew: this.earlyWarning,
      config: this.config,
      node: this.target,
      station: this.station,
      subscriber: this.asSubscriber(user),
      content
    };
  }

  asSubscriber(user) {
    return {
      type: 'user',
      id: user.id,
      name: User.fullName(user),
      email: user.email,
      phone: user.phone,
      language: user.preferred_language || Translates.fallbackLanguage
    };
  }

  getId(model) {
    return Model.getId(model);
  }

  smsCharLength(content, href) {
    const correctLength = content.length + href.length <= this.SMS_CHAR_LENGTH;
    if (correctLength) {
      return href;
    }
    return '';
  }

  strippedContent(content = '', key = this.eventType.EMAIL) {
    if (key === this.eventType.EMAIL) {
      return content.replaceAll('\n', '<br/>').replaceAll('  ', ' ');
    }
    return content.replaceAll('\n', ' ').replaceAll('  ', ' ');
  }

  getSubscriptionNotice(content = '', key = this.eventType.EMAIL, user = {}) {
    const href = `${`${Site.buildUrl(
      this.config
    )}/${EventRegistration.getSubscriptionPath(user)}`}`;
    const append =
      key === this.eventType.EMAIL
        ? `<br/><p><a href="${href}">My Subscriptions</a></p>`
        : this.smsCharLength(content, href);
    return `${this.strippedContent(content, key)} ${append}`;
  }

  appendMySubscriptions(content = {}, key = this.eventType.EMAIL, user = {}) {
    for (const lang in content[key]) {
      const value = content[key][lang];
      if (!value) {
        continue;
      }
      content[key][lang] = this.getSubscriptionNotice(
        content[key][lang],
        key,
        user
      );
    }
  }

  getSubscriptionContent(metaValue = {}, key = this.eventType.EMAIL) {
    const values = { [key]: {} };
    const ewActions = this.earlyWarning.actions || {};
    const actionBody = ewActions[key];
    const defaults = metaValue.defaultText || {};
    for (const lang of this.languages) {
      let language = defaults[lang] || actionBody[lang] || '';
      if (!language && lang === Translates.fallbackLanguage) {
        language = this.fallbackLang;
      }
      values[key][lang] = language;
    }
    return values;
  }

  async pullConfig() {
    this.config = await Site.thisSiteAsync(this.earlyWarning.domain);
  }

  sendEmail(content = {}, user) {
    return EventRegistration.sendSubscriptionEmail(
      this.localsPayload(content, user)
    );
  }

  sendSms(content = {}, user) {
    if (!this.hasSms) {
      return false;
    }

    return EventRegistration.sendSubscriptionSms(
      this.localsPayload(content, user)
    );
  }

  async applyImpact(audience, trigger, action) {
    try {
      await EventImpact.add(audience, {
        station: Model.getId(this.station),
        method: trigger,
        event: Model.getId(this.earlyWarning),
        ews: Model.getId(this.ews),
        meta: {
          action
        }
      });
    } catch (e) {
      sails.log.error('ERROR.applyImpact::EventImpact.addMany', e);
    }
  }

  async processSubscriptionMeta(subscription) {
    const meta = subscription.meta || {};
    const processed = [];
    for (const key in meta) {
      const value = meta[key];
      const active = Common.objectify(value, 'active');
      if (!active) {
        continue;
      }
      const content = this.getSubscriptionContent(value, key);
      this.appendMySubscriptions(content, key, subscription.user);
      const thisContent = content[key];
      const subscriber = subscription.user;
      let saved = false;
      switch (key) {
        case this.eventType.EMAIL:
          saved = await this.sendEmail(thisContent, subscriber);
          break;
        case this.eventType.SMS:
          saved = await this.sendSms(thisContent, subscriber);
          break;
        default:
          continue;
      }
      await this.applyImpact(subscriber, key, meta);
      processed.push(saved);
    }
    return processed;
  }

  async processMemberships() {
    for (const subscription of this.subscriptions) {
      if (!subscription.user) {
        continue;
      }
      await this.processSubscriptionMeta(subscription);
    }
  }

  async process() {
    if (!this.earlyWarning.public) {
      return false;
    }
    this.subscriptions = await EventRegistration.getSubscriptionsOnEvent(
      this.earlyWarning
    );

    if (!this.subscriptions.length) {
      return false;
    }

    try {
      await this.pullConfig();
      await this.pullNodeSchema();
      await this.pullTarget();
      await this.pullStation();
      await this.processMemberships();
    } catch (e) {
      sails.log.error(`${this.errors.errorValue}::process`, e.message);
      return false;
    }
    return true;
  }
}

module.exports = { EarlyWarningSubscription };
