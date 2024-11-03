const { SqlUtils } = require('similie-api-services');

class LogisticsChartingShared {
  pullStationsFromContext(context = {}) {
    const stations = context.stations || context.station || [];
    return stations;
  }

  filterIds(children = []) {
    return children.map(c => Model.getId(c));
  }

  assetSumResults(values = [], key = 'count') {
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i][key] || 0;
    }
    return sum;
  }

  async sendQueryResults(query) {
    const results = await Model.queryAsync(query);
    return results.rows;
  }

  async detailsMap(stations = []) {
    const details = await Station.stationDetails(stations);
    return this.applyIdentityCache(details, 'station');
  }

  parseValueJson(values) {
    if (typeof values !== 'string') {
      return values;
    }
    try {
      return JSON.parse(values);
    } catch (e) {
      sails.log.error(e);
      return values;
    }
  }

  getSchemaParamFromName(name, schema = []) {
    const array = this.parseValueJson(schema);
    if (!Array.isArray(schema)) {
      return null;
    }
    const filtered = array.filter(s => s.name === name);
    return filtered.pop();
  }

  cycleStations(lineage, cb) {
    return new Promise(async (resolve, reject) => {
      try {
        for (const id in lineage) {
          const stations = lineage[id];
          const details = await this.detailsMap(stations);
          for (let i = 0; i < stations.length; i++) {
            const station = stations[i];
            station.details = details[station.id];
            const children = await this.getChildren(station.id);
            await cb(station, children, id);
          }
        }
      } catch (e) {
        return reject(e);
      }
      resolve();
    });
  }

  getSkuParam(schema) {
    const helpers = Module._helpers.logistics();
    const logParams = helpers.logParams(schema.schema);
    return logParams('sku');
  }

  getQuantityParam(schema) {
    const helpers = Module._helpers.logistics();
    const logParams = helpers.logParams(schema.schema);
    return logParams('quantity');
  }

  getDatabase(schema) {
    return SqlUtils.knex().tableNameForQuery(schema);
  }

  async pullStory(storyId, messages = {}) {
    if (!storyId) {
      throw new Error(
        messages.NO_ID || 'There is in available to populate this story'
      );
    }
    const story = await NodeStory.findOneById(storyId);
    if (!story) {
      throw new Error(
        messages.NO_STORY || 'There is no story available for this given ID'
      );
    }
    return story;
  }

  async buildLineage(stations) {
    const lineage = {};
    for (let i = 0; i < stations.length; i++) {
      const station = Station.getId(stations[i]);
      const children = await this.getChildren(station, true);
      lineage[station] = children.filter(child => child.level <= 2);
    }
    return lineage;
  }

  getChildren(station, shallow = false, noAssets = true) {
    return Station.children(station, noAssets, shallow);
  }

  packageVariables(variables = [], keys) {
    const sendVarables = {};
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const keyedVariables = variables.filter(v => v.key === key);
      sendVarables[key] = sendVarables[key] || {};
      // we don't want an iterable in an undefined value
      sendVarables[key] = {
        ...sendVarables[key],
        ...this.applyIdentityCache(keyedVariables, 'identity')
      };
    }
    return sendVarables;
  }

  async pullVariables(keys) {
    const variables = await Variable.find()
      .where({ key: keys })
      .sort({
        order: 'ASC'
      });
    return this.packageVariables(variables, keys);
  }

  applyIdentityCache(items = [], key = 'id') {
    const idendityCache = {};
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const storeKey = item[key];
      idendityCache[storeKey] = item;
    }
    return idendityCache;
  }
}
module.exports = { LogisticsChartingShared };
