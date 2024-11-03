const { EwsActionUtils } = require('../ews/ews-action-utils');

class WindyEws {
  _eventCategory = EwsActionUtils.EWEventCategory.EarlyWarning;
  _windyEvent;
  _ews;
  constructor(windyEvent) {
    if (!windyEvent) {
      throw new Error('WindyEvent Object Required');
    }
    this.event = windyEvent;
  }

  get ews() {
    return this._ews;
  }

  set ews(ews) {
    this._ews = ews;
  }

  get eventCategory() {
    return this._eventCategory;
  }

  get ew() {
    return this.event.model.model;
  }

  get event() {
    return this._windyEvent;
  }

  set event(windyEvent) {
    this._windyEvent = windyEvent;
  }

  get dangers() {
    return this.event.dangers;
  }

  get dangerItem() {
    return this.event.dangerItem;
  }

  get eventId() {
    return this.event.id;
  }

  get domain() {
    return Domain.getId(this.event.domain);
  }

  get triggeredCount() {
    return this.event.dangerIndex;
  }

  get actions() {
    const actions = Object.keys(this.event.activeActions);
    return actions;
  }

  get paramTemplate() {
    const triggers = this.event.triggers;
    return {
      early_warning: this.eventId,
      event_category: this.eventCategory,
      target: null,
      domain: this.domain,
      device: null,
      triggered_count: this.triggeredCount,
      actions: this.actions,
      expired: false,
      perform: false,
      trigger_values: triggers.values,
      triggered_time: triggers.trigger_time
    };
  }

  async waitingTimeout() {
    const event = await this.event.findExistingTimeout();
    return !!event;
  }

  async trigger() {
    const template = this.paramTemplate;
    const created = await EWS.create(template);
    created.perform = true;
    this.ews = await EWS.saveAsync(created);
    return this.ews;
  }

  async build() {
    if (this.dangerItem === null) {
      return null;
    }
    return this.trigger();
  }

  async process() {
    const pause = await this.waitingTimeout();
    if (pause) {
      return null;
    }
    await this.event.build();
    this.event.buildSpanDates();
    this.event.seekDangers();
    return this.build();
  }
}

module.exports = { WindyEws };
