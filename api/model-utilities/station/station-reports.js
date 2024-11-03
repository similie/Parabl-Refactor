const { SqlUtils } = require('similie-api-services');
const { StationUtils } = require('./station-utils');
const { groupBy } = require('lodash');

class StationReports {
  constructor(dependents) {
    this._user = dependents.user;
    this._domain = dependents.domain;
    this._tables = dependents.tables || [];
    this._schema = dependents.schema;
    this.isDomainAdmin =
      User.is(this._user, Roles.DOMAIN_ADMIN) && !this._domain;
    this.escape = SqlUtils.escapeUtil();
  }

  get domain() {
    return this._domain;
  }

  get schema() {
    return this._schema;
  }

  get tables() {
    return this._tables.map(t => t.table_name);
  }

  get reportingTemplate() {
    const reporting = {
      identifier: 'station'
    };
    return reporting;
  }

  getId(value) {
    return Station.getId(value);
  }

  queryAsync(query) {
    return Station.queryAsync(query);
  }

  static getModelsFromParams(params = {}) {
    const seek = params.reports;
    if (!seek) {
      return sails.models;
    }
    const mods = {};
    const search = _.isArray(seek) ? seek : [seek];
    for (let i = 0; i < search.length; i++) {
      const modelName = search[i];
      const model = sails.models[modelName];
      if (!model) {
        throw new Error('error.MODEL_NOT_FOUND');
      }
      mods[modelName] = model;
    }
    return mods;
  }

  static async getTableReportValues(domain = null) {
    const schema = SqlUtils.knex().getDomainSchema(domain);
    const escape = SqlUtils.escapeUtil();
    const query = escape(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='%s' AND table_name <> 'query_counts';",
      schema
    );
    const results = await Station.queryAsync(query);
    const tables = results.rows;
    return { schema, tables };
  }

  async getCountStatesReports() {
    const stateVars = await StationUtils.pullStationStateVariables();
    let q =
      'SELECT count(*) as station_count, count(station_state = %s OR NULL) as registered, count(station_state = %s OR NULL) as draft, count(station_state = %s OR NULL) as archived FROM "station" ';
    // if (!this.isDomainAdmin) {
    q += `WHERE ${SqlUtils.formatDomainQuery(this.domain)}`;
    // }
    q += ';';

    const results = await this.queryAsync(
      this.escape(
        q,
        this.getId(stateVars.registered),
        this.getId(stateVars.draft),
        this.getId(stateVars.archived)
      )
    );
    return results.rows;
  }

  async getMostActiveReports() {
    let q =
      'SELECT local_name, id, code, station_id, activities from station as s LEFT JOIN (SELECT station, count(*) as activities from activity GROUP BY 1) as act ON (s.id = act.station) ';
    q += `WHERE ${SqlUtils.formatDomainQuery(this.domain)}`;
    q += ' ORDER BY activities DESC limit 10;';
    const results = await this.queryAsync(this.escape(q));
    return results.rows;
  }

  async getLeastActiveReports() {
    let q =
      'SELECT local_name, id, code, station_id, activities from station as s LEFT JOIN (SELECT station, count(*) as activities from activity GROUP BY 1) as act ON (s.id = act.station) ';
    q += `WHERE ${SqlUtils.formatDomainQuery(this.domain)}`;
    q += ' ORDER BY activities ASC limit 10;';
    const results = await this.queryAsync(this.escape(q));
    return results.rows;
  }

  async getTableNames() {
    const tableNames = this.tables;
    const template = _.template(
      'SELECT count("station") As count, "station", \'<%=table_name%>\' As table_name FROM "<%=schema%>".<%=table_name%> GROUP BY 2'
    );
    let concat = Utils.concatTableNames(tableNames, template, this.schema);

    if (!concat) {
      return [];
    }

    concat += 'ORDER BY table_name ASC, "count" DESC;';
    const results = await this.queryAsync(this.escape(concat));
    return results.rows;
  }

  wrapTableNoDetailResults(nodes = []) {
    return {
      nodes: nodes,
      user: []
    };
  }

  wrapTableDetailResults(nodes = [], stations = []) {
    return {
      nodes: nodes,
      stations: stations
    };
  }

  async getTableDetails() {
    const tableNames = await this.getTableNames();

    if (!tableNames.length) {
      return this.wrapTableNoDetailResults(tableNames);
    }
    const query =
      'SELECT sum(g.count) as activity_total, g.station, s.station_id, s.code, s.local_name FROM json_populate_recordset(NULL::"public".query_recordset, \'%s\') as g JOIN public.station as s ON (s.id = g.station) GROUP BY 2,3,4,5 ORDER BY activity_total DESC;';
    const results = await this.queryAsync(
      this.escape(query, JSON.stringify(tableNames))
    );
    return this.wrapTableDetailResults(results.rows, tableNames);
  }

  groupStationTables(tableDetails = {}) {
    return groupBy(tableDetails.nodes, 'station');
  }

  findTableDetailsStation(stations = [], sId) {
    const stationId = parseInt(sId);
    const resolved = [];
    for (let i = 0; i < stations.length; i++) {
      const st = stations[i];
      if (this.getId(st.station) === stationId) {
        resolved.push(st);
      }
    }
    return resolved;
  }

  applyFoundStations(foundStations = [], station = {}) {
    station.nodes = {};
    foundStations.forEach(st => {
      station.nodes[st.table_name] = st.count;
    });
  }

  sortArrayDetails(payload = []) {
    return payload.sort((a, b) => {
      const aTotal = parseInt(a.activity_total);
      const bTotal = parseInt(b.activity_total);
      if (aTotal < bTotal) {
        return 1;
      }
      if (aTotal > bTotal) {
        return -1;
      }
      // must be equal
      return 0;
    });
  }

  buildTableQueryResults(tableDetails = {}) {
    const send = [];
    const order = this.groupStationTables(tableDetails);

    for (const uId in order) {
      const nodeValues = order[uId];
      const station = nodeValues.pop();
      const foundStations = this.findTableDetailsStation(
        tableDetails.stations,
        uId
      );
      this.applyFoundStations(foundStations, station);
      send.push(station);
    }
    return this.sortArrayDetails(send);
  }

  async fullfillStationReport() {
    const reporting = this.reportingTemplate;
    reporting.counts = await this.getCountStatesReports();
    reporting.most_activities = await this.getMostActiveReports();
    reporting.least_activities = await this.getLeastActiveReports();
    const tableDetails = await this.getTableDetails();
    if (!tableDetails.nodes.length) {
      return reporting;
    }
    reporting.imports = this.buildTableQueryResults(tableDetails);
    return reporting;
  }
}

module.exports = { StationReports };
