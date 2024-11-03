const { AssetPivot } = require('./asset-pivot');
const { ItemCounter } = require('./item-counter');

class MissionReadyness {
  _schemas = {};
  _nodes = {};
  constructor(charting) {
    this._charting = charting;
    this._pivot = new AssetPivot(charting);
    this._counter = new ItemCounter(charting);
  }

  get meta() {
    return this.story.meta || {};
  }

  get storyId() {
    return this.charting.storyId;
  }

  get charting() {
    return this._charting;
  }

  get stations() {
    return this._charting.stations;
  }

  get utils() {
    return this._charting.utils;
  }

  get story() {
    return this._story;
  }

  set story(story) {
    this._story = story;
  }

  get config() {
    return this._config;
  }

  set config(config) {
    this._config = config;
  }

  hasStations() {
    return this.charting.hasStations;
  }

  setMetaContext() {
    const meta = this.meta;
    this.config = meta.config;
  }

  checkMetaContext() {
    this.setMetaContext();
    return !!this.config;
  }

  async pullStory() {
    this.story = await this.utils.pullStory(this.storyId);
  }

  pullGroupConfig(group = {}) {
    const meta = group.meta || {};
    return meta.config || {};
  }

  assetParams(group) {
    const config = this.pullGroupConfig(group);
    const keys = [];
    for (const key in config.params) {
      config.params[key] && keys.push(key);
    }
    return keys;
  }

  getGroupPercentage(group = {}, sum = 0) {
    const weight = group.weight / 100;
    const quantity = group.quantity || 0;
    const value = Math.ceil((sum / quantity) * 100);
    const overflowValue = value > 100 ? 100 : value;
    const groupContribution = overflowValue * weight;
    return groupContribution;
  }

  async pullAssetGroup(group = {}, children = []) {
    const config = this.pullGroupConfig(group);
    this._pivot.assets = config.assets;
    const params = this.assetParams(group);
    let sum = 0;
    for (let i = 0; i < params.length; i++) {
      const param = params[i];
      const query = this._pivot.buildQuery(children, param);
      const results = await this.utils.sendQueryResults(query);
      sum += this.utils.assetSumResults(results);
    }
    return this.getGroupPercentage(group, sum);
  }

  async getSchema(schemaId) {
    if (!schemaId) {
      throw new Error('A schema ID is required for this query');
    }
    if (this._schemas[schemaId]) {
      return this._schemas[schemaId];
    }
    this._schemas[schemaId] = await NodeSchema.findOneById(schemaId);
    return this._schemas[schemaId];
  }

  getNodeItem(nodeId, schema) {
    if (!nodeId) {
      throw new Error('An item ID is required to process this request');
    }
    return Node.findOneById(nodeId, schema);
  }

  normalizeCountResults(dependent = {}, results = []) {
    const sum = this.utils.assetSumResults(results, 'total');
    return sum > dependent.quantity ? dependent.quantity : sum;
  }

  async pullItemGroup(group = {}, children = []) {
    const dependents = group.dependsOn || [];
    let sum = 0;
    for (let i = 0; i < dependents.length; i++) {
      const dependent = dependents[i];
      const schema = await this.getSchema(dependent.schema);
      const item = await this.getNodeItem(dependent.item, schema);
      const query = this._counter.getQuery(item, schema, children);
      const results = await this.utils.sendQueryResults(query);
      sum += this.normalizeCountResults(dependent, results);
    }
    return this.getGroupPercentage(group, sum);
  }

  async processGroups() {
    const send = {};
    for (const index in this.config) {
      const values = this.config[index];
      send[values.name] = 0;
      const stations = this.stations;
      for (let i = 0; i < stations.length; i++) {
        const station = stations[i];
        const childStations = await this.utils.getChildren(
          Station.getId(station)
        );
        const children = this.utils.filterIds(childStations);
        for (let j = 0; j < values.groups.length; j++) {
          const group = values.groups[j];
          if (group.asset) {
            send[values.name] += await this.pullAssetGroup(group, children);
          } else {
            send[values.name] += await this.pullItemGroup(group, children);
          }
        }
      }
    }
    return send;
  }

  async render() {
    if (!this.hasStations()) {
      return { warning: 'A station context is required to render this story' };
    }
    await this.pullStory();
    if (!this.checkMetaContext()) {
      return { warning: 'Story configuration is required' };
    }
    return this.processGroups();
  }
}

module.exports = { MissionReadyness };
