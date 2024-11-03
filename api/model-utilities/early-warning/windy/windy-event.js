const { WindyUtils } = require('./windy-utils');
const { EwActionParams } = require('../early-warning-actions');
const { EarlyWarningModel } = require('../early-warning-model');
const { TimeUtils } = require('similie-api-services');
const now_ = TimeUtils.constants.now_;
const tz = TimeUtils.constants.timeZone;
const TimePeriod = TimeUtils.constants.ENUMS.timePeriods;
class WindyEvent {
  _model;
  _forecast;
  _utils;
  _dates = [];
  _dangers = {};
  constructor(model, key) {
    this.model = new EarlyWarningModel(model);
    this._utils = new WindyUtils(key);
  }

  get id() {
    return this.model.id;
  }

  get domain() {
    return this.model.domain;
  }

  get utils() {
    return this._utils;
  }

  get parameters() {
    return this.model.parameters;
  }

  get point() {
    return this.getMeta('point');
  }

  get model() {
    return this._model;
  }

  set model(model) {
    this._model = model;
  }

  get forecast() {
    return this._forecast;
  }

  set forecast(forecast) {
    this._forecast = forecast;
  }

  get keys() {
    return this._utils.getApiKeys();
  }

  get dangerKeys() {
    return Object.keys(this.dangers);
  }

  get dangerSize() {
    const keys = this.dangerKeys;
    return keys.length;
  }

  get dangerIndex() {
    return this.model.dangerIndex;
  }

  get dangerCountKey() {
    const keys = this.dangerKeys;
    return keys[this.dangerIndex];
  }

  get maxDate() {
    return this._maxDate;
  }

  get dates() {
    return this._dates;
  }

  get dangers() {
    return this._dangers;
  }

  set dangers(dangers) {
    this._dangers = dangers;
  }

  get forgiveCount() {
    return this.model.forgiveCount;
  }

  get paramCache() {
    return this._utils.objectCache || {};
  }

  get triggerTime() {
    return this.formatDate(this.dangerCountKey);
  }

  get triggeredParams() {
    const values = {};
    const danger = this.dangerItem || [];
    const paramCache = this.paramCache;
    const params = this.parameters;
    for (let i = 0; i < danger.length; i++) {
      const item = danger[i];
      for (const key in params) {
        const value = item[key] || [];
        const val = value[0];
        if (!val) {
          continue;
        }
        values[key] = {
          label: paramCache[key].label,
          name: key,
          value: parseFloat(val.value),
          param: val.param
        };
      }
    }
    return values;
  }

  get triggers() {
    const values = this.triggeredParams;
    const trigger_time = this.triggerTime;
    return {
      values,
      trigger_time
    };
  }

  get activeActions() {
    return this.model.activeActions;
  }

  get dangerItem() {
    // if null, then we haven't crossed the threshold
    return this.dangers[this.dangerCountKey] || null;
  }

  async build() {
    this.forecast = await this._utils.windyPoints(this.point);
    return this.forecast;
  }

  getMeta(param) {
    if (!this.model) {
      throw new Error('An event model is required');
    }
    const meta = this.model.meta;
    return meta[param];
  }

  formatDate(date = now_) {
    return TimeUtils.date(date).tz(tz).toISO;
  }

  setMaxDate() {
    const span = this.getMeta('span');
    this._maxDate = TimeUtils.date(now_).plus(
      span.time,
      TimePeriod[span.duration]
    );
  }

  isAfter(date) {
    return TimeUtils.date(date).isAfter(this.maxDate);
  }

  isBefore(date) {
    return TimeUtils.date(date).isBefore(this.maxDate);
  }

  buildSpanDates() {
    const dates = this.forecast[this._utils.timeKey];
    this._dates.length = 0;
    this.setMaxDate();
    for (let i = 0; i < dates.length; i++) {
      const date = dates[i];
      if (this.isAfter(date)) {
        break;
      }
      this._dates.push(date);
    }
    return this._dates;
  }

  buildDanger(key, dangers) {
    dangers[key] = dangers[key] || [];
  }

  setupDanger(key) {
    this.buildDanger(key, this.dangers);
  }

  setupDangerValue(key, param, hazards) {
    return {
      key,
      param,
      selector: hazards.selector,
      value: hazards.value
    };
  }

  appendDanger(key, value, dangers) {
    dangers[key].push(value);
  }

  addDanger(key, value) {
    this.setupDanger(key);
    this.appendDanger(key, value, this.dangers);
  }

  addAllDangers(key, dangers) {
    for (const _key in dangers) {
      this.addDanger(key, { [_key]: dangers[_key], date: key });
    }
  }

  hasAllDangers(dangers = {}) {
    const params = this.parameters;
    for (const key in params) {
      const d = dangers[key] || [];
      if (!d.length) {
        return false;
      }
    }
    return true;
  }

  testDangers(param, key, index) {
    const keys = this.keys;
    const selector = keys[key];
    const values = this.forecast[selector];
    const ewAction = new EwActionParams(param, 'decimal');
    ewAction.value = this._utils.processValue(values[index], key);
    const invalid = ewAction.check();
    return {
      invalid,
      selector,
      value: ewAction.value
    };
  }

  iterateDangers(dangers, index) {
    const params = this.parameters;
    for (const key in params) {
      const param = params[key];
      const hazards = this.testDangers(param, key, index);
      if (!hazards.invalid) {
        continue;
      }
      const danger = this.setupDangerValue(key, param, hazards);
      this.buildDanger(key, dangers);
      this.appendDanger(key, danger, dangers);
    }
  }

  seekDangers() {
    this.dangers = {};
    this._utils.units = this.forecast.units;
    for (let i = 0; i < this.dates.length; i++) {
      const dangers = {};
      this.iterateDangers(dangers, i);
      const date = this.dates[i];
      if (this.hasAllDangers(dangers)) {
        this.addAllDangers(date, dangers);
      }
    }
    return this.dangers;
  }

  async findExistingTimeout() {
    const event = await this.model.findExistingTimeout(
      this.eventCategory,
      TimePeriod.hours
    );
    return event;
  }
}

module.exports = { WindyEvent };
