const { PreProcessorItems } = require('./preprocessor-items');
const { TimeUtils } = require('similie-api-services');
const { Transformer } = require('./transformer');
const { NodeParamsFilter } = require('./node-params-filter');
class NodeParamTransformer {
  _varCache = {};
  _stationCache = {};
  _observerCache = {};
  _row;
  _schema;
  _varCache;
  _lang;
  _preProcessRows = ['observer', 'site_stations', 'local_name'];
  constructor(schema, varCache, language, selectedParams = {}) {
    this._schema = schema;
    this._varCache = varCache;
    this._lang = language;
    this._preprocessor = new PreProcessorItems(this._schema);
    this._filter = new NodeParamsFilter(this._schema, selectedParams);
    this._transformer = new Transformer(this._varCache, this._lang);
    this._filter.build();
  }

  get params() {
    return this._filter.params;
  }

  get lang() {
    return this._lang || Translates.fallbackLanguage;
  }

  get row() {
    return this._row;
  }

  set row(row) {
    this._row = row;
  }

  get preProcessRows() {
    return this._preProcessRows;
  }

  get varCache() {
    return this._varCache;
  }

  applyObserver() {
    const profile = this.cacheProfile || {};
    const userCache = profile.userCache || {};
    const observer = Model.getId(this.row.observer);
    if (observer === -1) {
      return this.getGlobalName();
    }
    const oCache = userCache[observer] || {};
    return oCache.name || observer;
  }

  getGlobalName() {
    const labelVars = this.sVars.labels || {};
    const labelName = 'is_global';
    const val = labelVars[labelName] || {};
    return val[this.lang] || labelName;
  }

  isGlobal() {
    const station = Model.getId(this.row.station);
    return station === -1;
  }

  getStationProfile() {
    const profile = this.cacheProfile || {};
    return profile.stationCache || {};
  }

  walkProfile(profile) {
    const station = Model.getId(this.row.station);
    return profile[station] || {};
  }

  applyStationId() {
    const profile = this.getStationProfile();
    const station = Model.getId(this.row.station);
    if (this.isGlobal()) {
      return this.getGlobalName();
    }
    const sCache = this.walkProfile(profile);
    return sCache.station_id || station;
  }

  applyStationLocalName() {
    const profile = this.getStationProfile();
    const station = Model.getId(this.row.station);
    if (this.isGlobal()) {
      return this.getGlobalName();
    }
    const sCache = this.walkProfile(profile);
    return sCache.local_name || station;
  }

  preProcess() {
    const rows = [];

    for (let i = 0; i < this.preProcessRows.length; i++) {
      const pr = this.preProcessRows[i];
      let value;
      switch (pr) {
        case 'observer':
          value = this.applyObserver();
          break;
        case 'site_stations':
          value = this.applyStationId();
          break;
        case 'local_name':
          value = this.applyStationLocalName();
          break;
      }
      rows.push(value);
    }

    return rows;
  }

  async buldSchemaVars() {
    this.sVars = await Variable.getSchemaVariables(this._schema.schema);
  }

  labelVars(value) {
    return this._transformer.getGenericVars(value, 'labels', this.sVars);
  }

  paramVars(value) {
    return this._transformer.getGenericVars(value, 'params', this.sVars);
  }

  getPreLabels() {
    const prelabels = [];
    this.preProcessRows.forEach(pr => {
      const label = this.labelVars(pr);
      prelabels.push(label);
    });
    return prelabels;
  }

  getLabels() {
    const prelabels = this.getPreLabels();
    const labelVars = this.sVars.labels || {};
    const labels = this.params.map(p => {
      const val = labelVars[p.name] || {};
      return val[this.lang] || p.label;
    });
    return [...prelabels, ...labels];
  }

  async applyPreProcessorCache(query) {
    this._preprocessor.query = query;
    this.cacheProfile = await this._preprocessor.cacheProfile();
  }

  getFullDate(val) {
    return TimeUtils.formattedDate(val, TimeUtils.constants.formats.Date.full);
  }

  converSpecial(param) {
    const val = this.row[this.name];

    switch (param.type) {
      case 'date':
        return this._transformer.date(val, param.time);
      case 'variable':
        return this._transformer.variable(val, this.sVars);
      case 'boolean':
        return this._transformer.boolean(val);
      case 'money':
        return this._transformer.money(val);
      case 'duration':
        return this._transformer.duration(val);
      case 'multi_select':
        return this._transformer.multiSelect(val, this.sVars);
      case 'json':
        return this._transformer.json(val, param.select_options);
      case 'country':
        return this._transformer.country(val, param.select_options);
      case 'calculator':
        return this._transformer.calculator(val);
      case 'filestory':
        return this._transformer.filestory(val);
      case 'paragraphs':
        return this._transformer.paragraphs(val, param.keys);
      case 'disaggregator':
        return this._transformer.disaggregator(val, param.select_options);
      default:
        return val;
    }
  }

  convert(param) {
    this.name = param.name;
    const val = this.converSpecial(param);
    // I was getting an error in the excel sheer with the value was NaN
    const protect = Number.isNaN(val) ? null : val;
    return protect;
  }
}

module.exports = { NodeParamTransformer };
