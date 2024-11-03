const commonUtils = require('../../utils/common')
const currency = require('currency-format');

/**
 * Retrieves currency information based on provided parameters.
 * @param {Object} params - The parameters containing currency information.
 * @returns {Object} - The currency data.
 */
function _currencies(params) {
  if (params.currency) {
    const send = {};
    commonUtils.each(params.currency, c => {
      send[c] = currency[c];
    });
    return send;
  }
 return currency;
}

/**
 * Retrieves the ledger for a given cost code, filtered by parameters.
 * @param {Object} parsedParams - The parsed parameters for the ledger query.
 * @returns {Promise<Object>} - The ledger data as currency.
 * @throws Will throw an error if the cost code is not provided.
 */
async function _ledger(parsedParams) {
  const costcode = parsedParams.costcode;

  if (!costcode) {
    throw new Error('Costcode required')
  }

  const query = {
    or: [{ from: costcode }, { to: costcode }]
  };

  if (parsedParams.start) {
    query.createdAt = { '>=': parsedParams.start };
  }

  if (parsedParams.end) {
    query.createdAt = query.createdAt || {};
    query.createdAt['<='] = parsedParams.end;
  }

  if (parsedParams.currency) {
    query.currency = parsedParams.currency;
  }

  const costcodes = await CostCode.find().where(query);
  const ledger = CostCode.getBalance(costcode, costcodes);
  return CostCode.asCurrency(ledger);
}

/**
 * Retrieves the primary station for a user based on parameters.
 * @param {Object} params - The parameters containing user ID and client type.
 * @returns {Promise<Object|null>} - The primary station or null if not found.
 * @throws Will throw an error if user ID or client type is invalid.
 */
async function _primary(params) {
  const available = ['user', 'personnel'];
  if (
    !params.id ||
    !params.client_type ||
    commonUtils.indexOf(available, params.client_type) === -1
  ) {
    throw new Error('A user id is required');
  }

  const reqs = await Requisition.find()
    .where({
      user: params.id,
      primary: true,
      archived: false
    })
    .populate('station');
  if (!commonUtils.size(reqs)) {
    return null;
  }

  const primary = commonUtils.where(reqs, { primary: true });
  if (commonUtils.size(primary)) {
    return primary[0].station;
  }
  return (reqs[0] || {}).station;
}

/**
 * Connects stations based on parsed parameters, including search and schema.
 * @param {Object} parsedParams - The parsed parameters for the connection.
 * @returns {Promise<Array>} - The array of connected stations.
 * @throws Will throw an error if required parameters are missing.
 */
async function _connect(parsedParams) {
  const searchField = parsedParams.search;
  const stationId = parsedParams.station;
  const nodeType = parsedParams.schema;
  const query = {};
  if (parsedParams.noTags) {
    query.or = [
      { local_name: { contains: searchField } },
      { station_id: { contains: searchField } }
    ];
    const assetSchema = await StationSchema.getAssetSchemas(
      res.locals.domain
    );
    if (assetSchema.length) {
      query.station_type = {
        '!': assetSchema.map(schema => StationSchema.getId(schema))
      };
    }
    const stations = await Station.find()
      .where(query)
      .populateAll();
    return stations;
  }

  if (!stationId) {
    throw new Error('An entry station is required');
  }

  if (!nodeType) {
    throw new Error('A note type is required');
  }

  // we want to know what nodes are available
  const nIds = commonUtils.isArray(nodeType) ? nodeType : [nodeType];
  let nodeField = [];
  for (let i = 0; i < commonUtils.size(nIds); i++) {
    const n = nIds[i];
    nodeField = commonUtils.union(
      nodeField,
      await StationSchema.getSchemaWithNodes(n, true)
    );
  }
  commonUtils.remove(nodeField, n => !n);
  /*
   * We want stations that are bound by a common tag. We don't want to be able to transfer to stations where they cannot
   */
  const common = await Station.commonStationTags(stationId);
  // we want to remove the self station
  commonUtils.remove(common, c => c === stationId || c === null);
  // underscore 2 is given to use as a sals global
  if (!commonUtils.size(common)) {
    return [];
  }

  query.id = common;

  if (commonUtils.size(nodeField)) {
    query.station_type = nodeField;
  }

  if (searchField) {
    query.or = [
      { local_name: { contains: searchField } },
      { station_id: { contains: searchField } }
    ];
  }
  // populateAll populates all of the assocaited model in the station object
  const stations = await Station.find()
    .where(query)
    .populateAll();

  if (parsedParams.workorder) {
    for (let i = 0; i < commonUtils.size(stations); i++) {
      const station_schema = await StationSchema.findOne(
        stations[i].station_type.id
      ).populate('service_nodes');

      const station = commonUtils.clone(stations[i]);
      const station_type = commonUtils.clone(station.station_type);
      station_type.service_nodes = commonUtils.clone(station_schema.service_nodes);
      station.station_type = station_type;
      stations[i] = station;
    }
  }

  return stations;
}

module.exports = {
  _currencies,
  _ledger,
  _primary,
  _connect
}