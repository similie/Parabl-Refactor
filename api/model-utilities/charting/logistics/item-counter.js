const { SqlUtils } = require('similie-api-services');

class ItemCounter {
  _charting;
  _story;
  _config;
  _schemaCache = {};
  _itemCache = {};
  _productCache = {};
  _domainCache = {};
  constructor(charting) {
    this._charting = charting;
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

  get sCache() {
    return this._schemaCache;
  }

  set sCache(schemaCache) {
    this._schemaCache = schemaCache;
  }

  get pCache() {
    return this._productCache;
  }

  set pCache(productCache) {
    this._productCache = productCache;
  }

  get iCache() {
    return this._itemCache;
  }

  set iCache(itemCache) {
    this._itemCache = itemCache;
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

  async buildLineage() {
    this.lineage = await this.utils.buildLineage(this.stations);
  }

  addToSetCache(setCache, schema) {
    const sId = NodeSchema.getId(schema);
    if (!sId) {
      return;
    }
    setCache[sId] = {
      ...schema
    };
  }

  async pullSchemas(config) {
    const schemas = config.schemas || [];
    const cache = this.sCache;
    const setCache = {};
    for (let i = 0; i < schemas.length; i++) {
      const sId = schemas[i];
      if (cache[sId]) {
        this.addToSetCache(setCache, cache[sId]);
        continue;
      }
      const pulled = await NodeSchema.findOneById(sId).populateAll();
      this.addToSetCache(setCache, pulled);
      this.addToSetCache(cache, pulled);
    }
    this.sCache = cache;
    return setCache;
  }

  findNodes(nodeIds, nodeSchema) {
    return Node.findNodes({ where: { id: nodeIds } }, nodeSchema);
  }

  async convertToItems(nodes, nodeSchema) {
    const site = await Site.thisSiteAsync(nodeSchema.domain);
    return PointOfSale.convertNodeItemsToProducts(nodes, nodeSchema, site);
  }

  async applyNodesToProductCache(nodes = [], nodeSchema) {
    const sId = NodeSchema.getId(nodeSchema);
    const pCache = this.pCache;
    pCache[sId] = pCache[sId] || {};
    const products = await this.convertToItems(nodes, nodeSchema);
    products.forEach(p => {
      pCache[sId][p.id] = p;
    });
    this.pCache = pCache;
  }

  applyNodesToCache(nodes = [], setCache) {
    nodes.forEach(n => {
      setCache[n.id] = n;
    });
  }

  async findNodeNodes(nodeIds, nodeSchema) {
    const sId = NodeSchema.getId(nodeSchema);
    const iCache = this.iCache;
    iCache[sId] = iCache[sId] || {};
    const setCache = {};
    const nIds = [];
    for (let i = 0; i < nodeIds.length; i++) {
      const nId = nodeIds[i];
      const node = iCache[sId][nId];
      if (node) {
        this.addToSetCache(setCache, node);
        continue;
      }
      nIds.push(nId);
    }

    if (nIds.length) {
      const nodes = await this.findNodes(nIds, nodeSchema);
      this.applyNodesToCache(nodes, iCache[sId]);
      this.applyNodesToCache(nodes, setCache);
      await this.applyNodesToProductCache(nodes, nodeSchema);
      this.iCache = iCache;
    }

    return setCache;
  }

  async applyItemCache(config) {
    const schemaCache = await this.pullSchemas(config);
    for (const sId in config.items) {
      const nIds = config.items[sId];
      const schema = schemaCache[sId];
      await this.findNodeNodes(nIds, schema);
    }
  }

  getQuery(item, schema, children) {
    const stations = this.utils.filterIds(children);
    const sParam = this.utils.getSkuParam(schema);
    const qParam = this.utils.getQuantityParam(schema);
    const sku = item[sParam];
    if (!sku) {
      throw new Error('Undefined SKU value');
    }
    const escape = SqlUtils.escapeUtil();
    const query = escape(
      `
        SELECT SUM("%s")::INT as "total" FROM %s WHERE %s = '%s' AND "station" %s
    `,
      qParam,
      this.utils.getDatabase(schema),
      sParam,
      sku,
      SqlUtils.setInString(stations)
    );
    return query;
  }

  async setItemsQueryChain(item, schema, children) {
    const query = this.getQuery(item, schema, children);
    const results = await Model.queryAsync(query);
    return results.rows.pop();
  }

  async findInvetoryForChildren(config, children) {
    const send = {};
    const pCache = this.pCache;
    for (const sId in config.items) {
      send[sId] = send[sId] || {};
      const items = config.items[sId];
      // send.config[sId] = con
      const schema = this.sCache[sId];
      for (let i = 0; i < items.length; i++) {
        const itemId = items[i];
        const item = this.iCache[sId][itemId];
        const results = await this.setItemsQueryChain(item, schema, children);
        const total = results.total || 0;
        send[sId][itemId] = {
          total: total,
          item: pCache[sId][itemId]
        };
      }
    }
    return send;
  }

  buildRenderActions(hold = {}) {
    return async (station, children) => {
      for (const index in this.config) {
        hold[index] = hold[index] || [];
        const config = this.config[index];
        await this.applyItemCache(config);
        const totals = await this.findInvetoryForChildren(config, children);
        station.item_totals = {
          totals: totals,
          config: config
        };
        hold[index].push(station);
      }
    };
  }

  async cycleStations() {
    const stations = {};
    const buildRenderActions = this.buildRenderActions(stations);
    await this.utils.cycleStations(this.lineage, buildRenderActions.bind(this));
    return stations;
  }

  getConfigRows() {
    const send = {};
    for (const index in this.config) {
      const config = this.config[index];
      send[index] = [];
      for (const sid in config.items) {
        const items = config.items[sid];
        for (let i = 0; i < items.length; i++) {
          send[index].push({
            item: items[i],
            schema: sid
          });
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
    try {
      await this.buildLineage();
      return {
        stations: await this.cycleStations(),
        rows: this.getConfigRows(),
        config: this.config
      };
    } catch (e) {
      sails.log.error(e);
      return { error: e.message };
    }
  }
}

module.exports = { ItemCounter };
