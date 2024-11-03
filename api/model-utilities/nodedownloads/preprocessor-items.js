const { SqlUtils } = require('similie-api-services');
class PreProcessorItems {
  _query;
  _schema;
  constructor(schema) {
    this._schema = schema;
    this._escape = SqlUtils.escapeUtil();
  }

  getStationQuery(qVal = `"s"."id"`) {
    const station = this._query.station;
    if (station) {
      const equate = Array.isArray(station)
        ? SqlUtils.setInString(station)
        : station.in && Array.isArray(station.in)
        ? SqlUtils.setInString(station.in)
        : `= ${Station.getId(station)}`;
      return this._escape(` WHERE ${qVal} ${equate}`);
    }
    return '';
  }

  getBaseObserverQuery() {
    const query = this._escape(
      `SELECT DISTINCT ON ("u"."id")  "u"."id" as "observer", CONCAT("u"."first_name" , ' ' , "u"."last_name") as "name" FROM %s "n" 
      LEFT JOIN "user" "u" ON "u"."id" = "n"."observer"
      %s
      GROUP BY 1,2
      `,
      SqlUtils.knex().tableNameForQuery(this._schema),
      this.getStationQuery(`"n"."station"`)
    );
    return query;
  }

  getBaseStationQuery() {
    const query = this._escape(
      `
   SELECT DISTINCT ON ("s"."id") "s"."id" as "station", "s"."local_name", "s"."station_id" FROM %s "n" 
   LEFT JOIN "station" "s" ON "s"."id" = "n"."station" 
   %s
   GROUP BY 1,2,3 `,
      SqlUtils.knex().tableNameForQuery(this._schema),
      this.getStationQuery()
    );
    return query;
  }

  get query() {
    return this._query;
  }

  set query(query = {}) {
    this._query = query;
  }

  async runUserQuery() {
    const query = this.getBaseObserverQuery();
    const results = await Model.queryAsync(query);
    return results.rows;
  }

  applyUserCache(users = []) {
    const send = {};
    users.forEach(u => {
      send[u.observer] = u;
    });
    return send;
  }

  async runStationQuery() {
    const query = this.getBaseStationQuery();
    const results = await Model.queryAsync(query);
    return results.rows;
  }

  applyStationCache(stations = []) {
    const send = {};
    stations.forEach(s => {
      send[s.station] = s;
    });
    return send;
  }

  async cacheProfile() {
    const stations = await this.runStationQuery();
    const stationCache = this.applyStationCache(stations);
    const users = await this.runUserQuery();
    const userCache = this.applyUserCache(users);
    return {
      stationCache,
      userCache
    };
  }
}

module.exports = { PreProcessorItems };
