const request = require('request');
const { TimeUtils } = require('similie-api-services');

const TimePeriod = TimeUtils.constants.ENUMS.timePeriods;

class WindyUtils {
  static stationID = -2;
  _api = `https://api.windy.com/api/point-forecast/v2`;
  _model = 'gfs';
  _level = 'surface';
  _timeKey = 'ts';
  _key;
  _units;
  _values = [
    {
      label: 'labels.TEMPERATURE',
      key: 'temp',
      selector: 'value',
      symbol: '°C',
      none: '--',
      active: true,
      pulled: 'temp'
    },
    {
      label: 'labels.DEW_POINT',
      key: 'dewpoint',
      selector: 'value',
      symbol: '°C',
      none: '--',
      active: true,
      pulled: 'dewpoint'
    },
    {
      label: 'labels.RELATIVE_HUMITITY',
      key: 'rh',
      selector: 'value',
      symbol: '%',
      none: '--',
      active: true,
      pulled: 'rh'
    },
    {
      label: 'labels.PRESSURE',
      key: 'pressure',
      selector: 'value',
      symbol: 'kPa',
      none: '--',
      active: false,
      pulled: 'pressure'
    },
    {
      label: 'labels.PRECIPITATION',
      key: 'past3hprecip',
      selector: 'value',
      symbol: 'mm',
      none: '--',
      active: true,
      pulled: 'precip'
    },
    {
      label: 'labels.CONV_PRECIPITATION',
      key: 'past3hconvprecip',
      selector: 'value',
      symbol: 'mm',
      none: '--',
      active: false,
      pulled: 'convPrecip'
    },
    {
      label: 'labels.WIND_SPEED',
      key: 'wind_u',
      selector: 'converted',
      symbol: 'm/s',
      none: '--',
      active: true,
      pulled: 'wind'
    },

    {
      label: 'labels.GUST_SPEED',
      key: 'gust',
      selector: 'value',
      symbol: 'm/s',
      none: '--',
      active: true,
      pulled: 'windGust'
    },
    {
      label: 'labels.WIND_DIRECTION',
      key: 'wind_v',
      selector: 'wind_icon',
      symbol: '°',
      none: '--',
      active: true,
      special: 'wind_icon'
    }
  ];

  asMM(value) {
    return parseInt(value * 1000);
  }

  processors() {
    const kelvinConst = 273.15;
    const isKelvin = () => {
      const key = `temp-${this._level}`;
      return this.units[key] === 'K';
    };
    const processors = {
      past3hprecip: this.asMM,
      past3hconvprecip: this.asMM,
      temp: value => {
        if (isKelvin()) {
          return value - kelvinConst;
        }
        return value;
      },
      wind_v: value => {
        return value * -1;
      },
      pressure: value => {
        return (value / 1000).toFixed(2);
      },
      __default: value => {
        return value;
      }
    };
    return processors;
  }

  processValue(value, key) {
    const processors = this.processors();
    const process = processors[key] || processors.__default;
    return process(value);
  }

  constructor(key) {
    this._key = key;
  }

  get units() {
    return this._units || {};
  }

  set units(units) {
    this._units = units;
  }

  get timeKey() {
    return this._timeKey;
  }

  get key() {
    return this._key;
  }

  set key(key) {
    this._key = key;
  }

  get level() {
    return this._level;
  }

  set level(level) {
    this._level = level;
  }

  get api() {
    return this._api;
  }

  get model() {
    return this._model;
  }

  get values() {
    return [...this._values];
  }

  get stationId() {
    return this.stationID;
  }

  get parameters() {
    return this.values.map(v => v.pulled).filter(v => !!v);
  }

  get keys() {
    return this.values.filter(v => !!v.pulled).map(v => v.key);
  }

  get objectCache() {
    const cache = {};
    const values = this.values;
    for (let i = 0; i < values.length; i++) {
      const value = values[i];
      cache[value.key] = value;
    }
    return cache;
  }

  getApiKeys() {
    const params = this.keys;
    const send = {};
    params.forEach(p => {
      send[p] = `${p}-${this._level}`;
    });
    return send;
  }

  payload(point = {}) {
    const payload = {
      lat: point.lat,
      lon: point.lng,
      model: this.model,
      parameters: this.parameters,
      levels: [this.level],
      key: this.key
    };

    return payload;
  }

  async windyPoints(point = {}) {
    return new Promise((resolve, reject) => {
      request.post(
        this.api,
        { json: this.payload(point) },
        (err, httpResponse, body) => {
          if (err) {
            return reject(err);
          }
          if (httpResponse.statusCode !== 200) {
            return reject(
              new Error('Status code unexpected: ' + httpResponse.statusCode)
            );
          }
          resolve(body);
        }
      );
    });
  }

  /**
   * @static
   * @description add the most recent early warning to the model. We do this
   * so we can indicate when an event has occured
   * @param {Object} ew
   */
  static async appendEwsEvent(ew) {
    const { EwsActionUtils } = require('../ews/ews-action-utils');
    const ewUtils = new EwsActionUtils();
    const ews = await ewUtils.findLastPerformedEwModel(
      ew,
      EwsActionUtils.EWEventCategory.EarlyWarning,
      TimePeriod.hours,
      24
    );
    if (ews) {
      ew.__active_event = ews;
    }
  }
}

module.exports = { WindyUtils };
