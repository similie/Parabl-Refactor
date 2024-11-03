const { SqlUtils } = require('similie-api-services');
const {
  LogisticsChartingShared
} = require('../../charting/logistics/logistics-charting-shared');
class WLDeviceManager {
  nCache = {};
  stationCache = {};
  parentCache = {};
  context = null;
  constructor(context) {
    this.context = context;
    this._utils = new LogisticsChartingShared(this.context);
  }

  get storyId() {
    return this.context.story;
  }

  get story() {
    return this._story;
  }

  set story(story) {
    this._story = story;
  }

  get config() {
    const meta = this.story.meta || {};
    return meta.config || {};
  }

  setStationCache(stations = []) {
    stations.forEach(s => {
      this.stationCache[Station.getId(s)] = s;
    });
  }

  async getSchemasFromContext() {
    const schemas = [];
    this.context.station = this.context.station || this.context.stations || [];
    const _stations = this.context.station
      .map(s => Station.getId(s))
      .filter(s => !!s);
    const stations = await Station.find().where({
      id: _stations
    });
    this.setStationCache(stations);
    const sSchema = stations.map(s => Station.getId(s.station_type));
    schemas.push(...sSchema);
    if (!schemas.length) {
      return [];
    }
    return StationSchema.find().where({ id: schemas });
  }

  getMetaParam(name, data) {
    const meta = data.meta || {};
    return meta[name] || null;
  }

  getMetaParamForWl(ns) {
    return this.getMetaParam('wl_percent', ns);
  }

  runOtherParams(ns, cb) {
    const others = ['wl_distance', 'wl_liters', 'wl_date'];
    for (let i = 0; i < others.length; i++) {
      const other = others[i];
      const param = this.getMetaParam(other, ns);
      if (param) {
        cb(param, other);
      }
    }
  }

  runStationMetaParams(ss, cb) {
    const others = [
      'tank_shape',
      'tank_distance_empty',
      'tank_distance_full',
      'tank_length',
      'tank_width',
      'tank_height'
    ];
    for (let i = 0; i < others.length; i++) {
      const other = others[i];
      const param = this.getMetaParam(other, ss);
      if (param != null) {
        cb(param, other);
      }
    }
  }

  getOtherParams(ns) {
    const params = [];
    const rOther = this.runOtherParams.bind(this);
    rOther(ns, param => {
      params.push(param);
    });
    return params;
  }

  getOtherParamsWithContext(data, isStation) {
    const params = {};
    const run = isStation
      ? this.runStationMetaParams.bind(this)
      : this.runOtherParams.bind(this);
    run(data, (param, val) => {
      params[val] = param;
    });
    return params;
  }

  applyOtherSelector(ns) {
    let send = '';
    const params = this.getOtherParams(ns);
    if (!params.length) {
      return send;
    }
    const escape = SqlUtils.escapeUtil();
    for (let i = 0; i < params.length; i++) {
      const param = params[i];
      send += escape(`, "%s"`, param);
    }
    return send;
  }

  getParamForMeta(param, ns) {
    let meta = {};
    const schema = ns.schema || [];
    for (let i = 0; i < schema.length; i++) {
      const s = schema[i];
      if (s.name === param) {
        meta = s;
        break;
      }
    }
    return meta;
  }

  async cycleParams(schemas) {
    const params = {};
    for (let i = 0; i < schemas.length; i++) {
      const schema = schemas[i];
      const schemaId = StationSchema.getId(schema);
      const nodes = await StationSchema.getNodes(schema);

      params[schemaId] = {};
      params[schemaId].station_meta = this.getOtherParamsWithContext(
        schema,
        true
      );

      for (let j = 0; j < nodes.length; j++) {
        const nId = nodes[j];
        const node = this.nCache[nId] || (await NodeSchema.findOneById(nId));
        this.nCache[nId] = node;
        const param = this.getMetaParamForWl(node);
        if (param) {
          const meta = this.getParamForMeta(param, node);
          params[schemaId][nId] = {};
          params[schemaId][nId].label = meta.label;
          params[schemaId][nId].type = meta.type;
          params[schemaId][nId].node_name = node.title;
          params[schemaId][nId].param = param;
          params[schemaId][nId].params_other = this.getOtherParamsWithContext(
            node
          );
          params[schemaId][nId].nodeschema = nId;
        }
      }
    }
    return params;
  }

  async getlastWlQueryForSchema(ns, param, station) {
    const escape = SqlUtils.escapeUtil();
    const p = param.param;
    const table = Node.getStringTableNameWithSchema(ns);
    const query = escape(
      `SELECT "%s" %s FROM %s WHERE "station" = %s ORDER BY "date" DESC LIMIT 1`,
      p,
      this.applyOtherSelector(ns),
      table,
      Station.getId(station)
    );

    const results = await Model.queryAsync(query);
    const values = results.rows;
    return values[0] || null;
  }

  setStationValues(station, value = {}) {
    const send = {};
    for (const key in value.station_meta) {
      const param = value.station_meta[key];
      send[param] = station.schema[param];
    }
    return send;
  }

  findStationLock(station) {
    const story = NodeStory.getId(this.context.story);
    const meta = station.meta || {};
    const lockMeta = meta.tank_locked_to || {};
    return lockMeta[story] || {};
  }

  async iterateNodeParams(params, station) {
    const nodes = [];
    const values = {};
    for (const id in params) {
      if (id === 'station_meta') {
        continue;
      }
      const param = params[id];
      const ns = this.nCache[id];
      nodes.push({
        id: NodeSchema.getId(ns),
        label: ns.title,
        name: ns.name
      });
      const value = await this.getlastWlQueryForSchema(ns, param, station);
      values[id] = value;
    }
    return {
      nodes,
      values
    };
  }

  getParent(stationId) {
    const station = this.parentCache[Model.getId(stationId)];
    if (!station) {
      return null;
    }
    return {
      id: station.id,
      local_name: station.local_name,
      schema: Model.getId(station.station_type),
      station_id: station.station_id
    };
  }

  async findMostRecentNode(params) {
    const send = [];
    const stations = this.context.stations || this.context.station || [];
    for (let i = 0; i < stations.length; i++) {
      const sId = Station.getId(stations[i]);
      const station = this.stationCache[sId];
      if (!station) {
        continue;
      }
      const sType = Station.getId(station.station_type);
      const _params = params[sType];
      const iterables = await this.iterateNodeParams(_params, station);

      const result = {
        values: iterables.values,
        station: sId,
        params: _params,
        name: station.local_name,
        nodes: iterables.nodes,
        locked_to: this.findStationLock(station),
        station_values: this.setStationValues(station, _params),
        parent: this.getParent(sId)
      };
      send.push(result);
    }

    return send;
  }

  getAssetQuery(children = []) {
    const escape = SqlUtils.escapeUtil();
    const query = escape(
      `SELECT  to_json("ps".*) as "station", to_json("s".*) as "asset", to_json("ss".*) as "schema" FROM "stationasset" "sa"
    JOIN "station" "s" ON "s"."id" = "sa"."asset"
    JOIN "station" "ps" ON "ps"."id" = "sa"."station"
    JOIN "stationschema" "ss" ON "ss"."id" = "s"."station_type"
    WHERE "ss"."id" = %s
    AND "sa"."station" %s`,
      this.config.assets,
      SqlUtils.setInString(this._utils.filterIds(children))
    );
    return query;
  }

  async runAssetQuery(children = []) {
    const query = this.getAssetQuery(children);
    const results = await Model.queryAsync(query);
    return results.rows;
  }

  async isForAssets() {
    this.story = await this._utils.pullStory(this.storyId);
    const config = this.config;
    return config.has_assets && config.assets;
  }

  parseSchema(stationschema) {
    if (typeof stationschema.schema === 'string') {
      stationschema.schema = JSON.parse(stationschema.schema);
    }
    return stationschema;
  }

  applySchemas(assets, schemas = [], childrenIds = {}) {
    assets.forEach(asset => {
      const station = asset.asset;
      const sId = station.id;
      station.station_type = asset.schema;
      schemas.push(this.parseSchema(asset.schema));
      this.stationCache[sId] = station;
      this.parentCache[sId] = asset.station;
      childrenIds[sId] = true;
    });
  }

  applyChilrenIds(children = [], childrenIds = {}) {
    children.forEach(child => {
      childrenIds[Model.getId(child)] = true;
    });
  }

  convertChildrenToContext(childrenIds = {}) {
    this.context.station = Object.keys(childrenIds).map(c => parseInt(c));
  }

  async cycleStations() {
    const schemas = [];
    const childrenIds = {};
    for (let i = 0; i < this.context.station.length; i++) {
      const station = this.context.station[i];
      const children = await this._utils.getChildren(station);
      const assets = await this.runAssetQuery(children);
      this.applySchemas(assets, schemas, childrenIds);
    }
    this.convertChildrenToContext(childrenIds);
    return schemas;
  }

  async buildAssetTankLevels() {
    if (!this.context.station) {
      throw new Error('A station context is required');
    }
    const schemas = await this.cycleStations();
    const params = await this.cycleParams(schemas);
    const values = await this.findMostRecentNode(params);
    return values;
  }

  async process() {
    if (await this.isForAssets()) {
      return this.buildAssetTankLevels();
    }

    const schemas = await this.getSchemasFromContext();
    const params = await this.cycleParams(schemas);
    const values = await this.findMostRecentNode(params);
    return values;
  }
}

module.exports = { WLDeviceManager };
