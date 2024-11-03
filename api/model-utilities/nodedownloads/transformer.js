const { TimeUtils } = require('similie-api-services');

// TODO:
// create tranformer for: districts, agreagator, node, people, tags

class Transformer {
  _varCache = {};
  _lang;
  constructor(varCache = {}, lang) {
    this._varCache = varCache;
    this._lang = lang;
  }

  _translation = {
    start: this._varCache['labels.START'] || 'Start',
    end: this._varCache['labels.END'] || 'End',
    duration: this._varCache['labels.TIME_DURATION'] || 'Duration',
    durationInMnutes:
      this._varCache['labels.DURRATION_IN_MINS'] || 'Duration in minutes',
    title: this._varCache['labels.TITLE'] || 'Title',
    description: this._varCache['labels.DESCRIPTION'] || 'Description'
  };

  getCountryByCode(code) {
    const selectedCountry = sails.config.country.list.find(
      country => country.id === code
    );

    return selectedCountry.name || code;
  }

  /**
   * @description get generic value from cache
   * @param value {string} - value parameter
   * @param type {string} - type of cache to get
   * @param sVars {object} - schema variables
   * @param lang {string} - language
   * @returns {string} - value
   */
  getGenericVars(value, type, sVars) {
    const labelVars = sVars[type] || {};
    const val = labelVars[value] || {};
    const label = val[this._lang] || value;

    return label;
  }

  /**
   * @description transform date type
   * @param value {string} - value parameter
   * @param isTime {boolean} - is time value
   * @returns {string} - value dateTime
   */
  date(value, isTime) {
    if (!value) return null;

    return isTime
      ? TimeUtils.formattedDate(value, TimeUtils.constants.formats.Date.full)
      : value;
  }

  /**
   * @description transform variable type
   * @param value {string} - value parameter
   * @param sVars {object} - schema variables
   * @param lang {string} - language
   * @returns {string} - value variable
   */
  variable(value, sVars) {
    return value ? this.getGenericVars(value, 'params', sVars) : null;
  }

  /**
   * @description transform boolean type
   * @param value {boolean} - value parameter
   * @returns {string} - value
   */
  boolean(value) {
    return value ? 'TRUE' : 'FALSE';
  }

  /**
   * @description transform money type
   * @param value {object} - money object
   * @returns {string} - value
   */
  money(value) {
    return value ? `${value.currency} ${value.value}` : null;
  }

  /**
   * @description transform stop watch type
   * @param value {object} - duration parameter
   * @returns {string} - value
   */
  duration(value) {
    if (!value) return null;

    const buildDurration = milisecs => {
      const seconds = milisecs / 1000;
      const datatime = TimeUtils.timeFormatFromSeconds(seconds);
      return datatime;
    };

    const startDate = this.date(value.start, true);
    const endDate = this.date(value.end, true);
    const duration = buildDurration(value.duration);
    const durationInMnutes = TimeUtils.minutesFromMilliseconds(value.duration);

    return `
      ${this._translation.start}: ${startDate}
      ${this._translation.end}: ${endDate} 
      ${this._translation.duration}: ${duration}
      ${this._translation.durationInMnutes}: ${durationInMnutes}
    `;
  }

  /**
   * @description transform multi select type
   * @param value {object} - duration parameter
   * @param sVars {object} - schema variables
   * @returns {string} - value
   */
  multiSelect(value, sVar) {
    if (!value) return null;

    const data = JSON.parse(value || '[]');

    if (!data.length) return null;

    const result = data
      .map(v => this.getGenericVars(v, 'params', sVar))
      .join(', ');

    return result;
  }

  /**
   * @description transform json/checkbox type
   * @param value {object} - duration parameter
   * @param options {array} - schema options
   * @param lang {string} - language
   * @returns {string} - value
   */
  json(value, options) {
    if (!value) return null;

    const [key] = Object.keys(value).filter(item => value[item]);
    const selectedOption = options.find(option => option.name === key);
    const selectedValue =
      selectedOption.select_text[this._lang] || selectedOption.name;

    return selectedValue;
  }

  // TODO: add country name based on code
  /**
   * @description transform country type
   * @param value {array} - list of country code
   * @returns {string} - value
   */
  country(value) {
    if (!value) return null;

    const data = JSON.parse(value || '[]');

    return data.map(code => this.getCountryByCode(code)).join(', ');
  }

  /**
   * @description transform calculator type
   * @param value {array} - list of country code
   * @returns {string} - value
   */
  calculator(value) {
    if (!value) return null;

    const calculate = value.params
      .map(({ operator, value, label }, index) => {
        const firstOperator = index === 0 && operator === '-' ? '-' : '';

        return `${
          index > 0 ? `${operator}` : ''
        } ${label}(${firstOperator}${value})`;
      })
      .join(' ');

    return `${calculate} = ${value.val}`;
  }

  /**
   * @description transform filestory type
   * @param value {object} - file node object
   * @returns {string} - value
   */
  filestory(value) {
    if (!value) return null;

    const file = `
      ${this._translation.title}: ${value.title}, 
      ${this._translation.description}: ${value.description}
    `;

    return file;
  }

  /**
   * @description transform paragraphs type
   * @param value {object} - paragraphs object
   * @param keys {object} - paragraphs key
   * @returns {string} - value
   */
  paragraphs(value, keys) {
    if (!value) return null;

    const text = Object.entries(value)
      .map(item => {
        return `${keys[item[0]]}: ${item[1]}`;
      })
      .join(', ');

    return text;
  }

  // TODO: implement agregator
  /**
   * @description transform paragraphs type
   * @param value {object} - agregator object
   * @param options {object} - agregator options
   * @returns {string} - value
   */
  disaggregator(value, options) {
    if (!value) return null;

    const result = options
      .map(
        item =>
          `${item.select_text[this._lang] || item.select_text.name}: ${
            value[item.name]
          }`
      )
      .join(', ');

    return result;
  }
}

module.exports = { Transformer };
