const { WindyUtils } = require('./windy-utils');

// const { SqlUtils } = require('similie-api-services');
class WindyDomains {
  _query = `SELECT
	"domain" AS "domain",
	"integrations" ->> 'windy_point_forecast_api' AS "key" 
FROM
	"site" 
WHERE
	"integrations" ->> 'windy_point_forecast_api' IS NOT NULL;`;

  async queryDomains() {
    const results = await Model.queryAsync(this._query);
    return results.rows;
  }

  where(domainResult = {}) {
    const domain = Domain.getId(domainResult.domain);
    const where = {
      active: true,
      station: WindyUtils.stationID,
      domain: domain
    };
    return where;
  }

  domainEvents(domainResult = {}) {
    const where = this.where(domainResult);
    return EarlyWarning.find().where(where);
  }
}

module.exports = { WindyDomains };
