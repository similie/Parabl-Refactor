const { SqlUtils } = require('similie-api-services');
class AssetPivot {
  _charting;
  _story;
  _config;
  _paramHold = {};
  constructor(charting) {
    this._charting = charting;
  }

  get storyId() {
    return this._charting.storyId;
  }

  get lineage() {
    return this._lineage;
  }

  set lineage(lineage) {
    this._lineage = lineage;
  }

  get meta() {
    return this._story.meta || {};
  }

  get configParams() {
    return this._config.params || {};
  }

  get configAssets() {
    return this._config.assets || [];
  }

  get assets() {
    return this._assets;
  }

  set assets(assets) {
    this._assets = assets;
  }

  get params() {
    return this._params;
  }

  set params(params) {
    this._params = params;
  }

  get variables() {
    return this._variables;
  }

  set variables(variables) {
    this._variables = variables;
  }

  get stations() {
    return this._charting.stations || [];
  }

  get utils() {
    return this._charting.utils;
  }

  get paramKeys() {
    const params = this.configParams;
    const keys = [];
    for (const key in params) {
      const val = params[key];
      val && keys.push(key);
    }
    return keys;
  }

  getAssetParams(asset) {
    const send = {};
    for (const key in this.configParams) {
      const val = this.configParams[key];
      if (!val) {
        continue;
      }

      send[key] = this._paramHold[key];
      if (send[key]) {
        continue;
      }
      this._paramHold[key] = this.utils.getSchemaParamFromName(
        key,
        asset.schema
      );
      send[key] = this._paramHold[key];
    }
    return send;
  }

  get xAxis() {
    const xAxis = {};
    for (const id in this.assets) {
      const asset = this.assets[id];
      xAxis[id] = {
        id: asset.id,
        name: asset.name,
        color: asset.color,
        icon: asset.icon,
        params: this.getAssetParams(asset)
      };
    }
    return xAxis;
  }

  get buildSchemaParams() {
    let discovered = false;
    const paramDetails = {};
    const params = this.configParams;
    for (const id in this.assets) {
      const asset = this.assets[id];
      const schema = asset.schema || [];
      for (let i = 0; i < schema.length; i++) {
        const param = schema[i];
        const name = param.name;
        if (params[name] && Node.isVariableType(param)) {
          paramDetails[id] = paramDetails[id] || {};
          paramDetails[id][name] = param;
          discovered = true;
        }
      }
    }
    if (!discovered) {
      throw new Error(
        'A valid parameter type cannot be found for this configuration'
      );
    }

    return paramDetails;
  }

  buildQuery(stations = [], key = '') {
    if (!stations.length || !key) {
      throw new Error('A valid key and station is required to run this query');
    }
    const escape = SqlUtils.escapeUtil();
    const escapedKey = escape(`%s`, key);
    const query = escape(
      `SELECT COUNT
    ( "s"."schema" ->> '${escapedKey}' )::INT AS "count",
    "s"."schema" ->> '${escapedKey}' AS "${escapedKey}",
    "s"."station_type",
    "v"."identity",
    "v"."key",
    "v"."value"::JSONB
  FROM
    "station" "s"
    JOIN "stationasset" "sa" ON "sa"."asset" = "s"."id"
    JOIN "variable" "v" ON "v"."id" = ( "s"."schema" ->> '${escapedKey}' ) :: INT
  WHERE
    "sa"."station" %s
    AND "s"."station_type" %s
    AND "s"."schema" ->> '${escapedKey}' IS NOT NULL 
  GROUP BY
    2,
    3,
    4,
    5,
    6;`,
      SqlUtils.setInString(stations),
      SqlUtils.setInString(this.assets)
    );
    return query;
  }

  async pullStory() {
    this._story = await this.utils.pullStory(this.storyId, {
      NO_ID: 'Story not found for this pivot',
      NO_STORY: 'There is no story avaialble with this id'
    });
  }

  setMetaContext() {
    const meta = this.meta;
    this._config = meta.config;
  }

  checkMetaContext() {
    this.setMetaContext();
    return !!this._config;
  }

  wrapAssets(assetSchema) {
    const wrapped = {};
    for (let i = 0; i < assetSchema.length; i++) {
      const asset = assetSchema[i];
      wrapped[asset.id] = asset;
    }
    return wrapped;
  }

  async setAssets() {
    const assets = this.configAssets;
    if (!assets.length) {
      throw new Error('No assets have been applied to this configuration');
    }
    const assetSchema = await StationSchema.find().where({ id: assets });
    this.assets = this.wrapAssets(assetSchema);
  }

  cycleValidityCheck(params, keys) {
    let valid = false;
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const available = params[key];
      if (available) {
        valid = true;
        break;
      }
    }
    return valid;
  }

  checkParamValidity() {
    const params = this.configParams;
    const keys = Object.keys(params);
    if (!keys.length) {
      throw new Error('No parameters have been applied to this configuration');
    }
    if (!this.cycleValidityCheck(params, keys)) {
      throw new Error(
        'At least one paramater for this configuration must be available'
      );
    }
  }

  async setParamDetails() {
    this.checkParamValidity();
    this.variables = await this.utils.pullVariables(this.paramKeys);
  }

  async buildLineage() {
    this.lineage = await this.utils.buildLineage(this.stations);
  }

  wrapQueryResults(results = []) {
    const queryResults = {};
    results.forEach(r => {
      queryResults[r.station_type] = queryResults[r.station_type] || {};
      queryResults[r.station_type][r.identity] = r;
    });
    return queryResults;
  }

  aggregateSendResults(holdCache) {
    const send = [];
    for (const ssId in holdCache) {
      const identities = holdCache[ssId];
      for (const identity in identities) {
        const values = identities[identity];
        values.result.count = values.sum;
        send.push(values.result);
      }
    }
    return send;
  }

  aggregateResults(results = []) {
    const hold = {};
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      hold[result.station_type] = hold[result.station_type] || {};
      hold[result.station_type][result.identity] = hold[result.station_type][
        result.identity
      ] || {
        sum: 0,
        result: result
      };
      hold[result.station_type][result.identity].sum += result.count;
    }
    return this.aggregateSendResults(hold);
  }

  async pullDataRows(stations) {
    const keys = this.paramKeys;
    const resultDetails = {};
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const query = this.buildQuery(stations, key);
      const results = await this.utils.sendQueryResults(query);
      resultDetails[key] = this.wrapQueryResults(
        this.aggregateResults(results)
      );
    }
    return resultDetails;
  }

  async cycleStations() {
    await this.utils.cycleStations(
      this.lineage,
      async (station, children, id) => {
        station.asset_details = await this.pullDataRows(
          this.utils.filterIds(children, id)
        );
      }
    );
  }

  buildYAxis(station = {}, asset = -1, key = '', identity = '') {
    const assetDetails = station.asset_details[key] || {};
    const varDetails = assetDetails[asset] || {};
    if (!varDetails) {
      return null;
    }
    return varDetails[identity] || null;
  }

  iterateVariables(station = {}, asset = {}) {
    const table = {};
    for (const key in this.variables) {
      const variableGroup = this.variables[key];
      const yAxis = {};
      for (const identity in variableGroup) {
        yAxis[identity] = yAxis[identity] || {};
        yAxis[identity].identity = identity;
        yAxis[identity].name = asset.name;
        yAxis[identity].y = this.buildYAxis(station, asset.id, key, identity);
      }
      table[key] = yAxis;
    }
    return table;
  }

  buildTable() {
    for (const id in this.lineage) {
      const stations = this.lineage[id];
      for (let i = 0; i < stations.length; i++) {
        const station = stations[i];
        const row = {};
        for (const aId in this.assets) {
          const asset = this.assets[aId];
          row[aId] = this.iterateVariables(station, asset);
        }
        station.table = row;
      }
    }
  }

  flattenVariables() {
    const flattenedVars = {};
    const variables = this.variables;
    for (const key in variables) {
      const vars = variables[key];
      for (const identity in vars) {
        flattenedVars[identity] = vars[identity];
      }
    }
    return flattenedVars;
  }

  async render() {
    if (!this.stations.length) {
      return [];
    }

    await this.pullStory();
    if (!this.checkMetaContext()) {
      return { warning: 'Story configuration is required' };
    }
    await this.buildLineage();
    try {
      await this.setAssets();
      await this.setParamDetails();
      await this.cycleStations();
      this.buildTable();
    } catch (e) {
      return { error: e.message };
    }

    return {
      ...this.lineage,
      yAxis: this.variables, //  this.flattenVariables(),
      xAxis: this.xAxis
    };
  }
}
module.exports = { AssetPivot };
