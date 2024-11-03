/**
 * CostCodeController
 *
 * @description :: Server-side actions for handling incoming requests.
 * @help        :: See https://sailsjs.com/docs/concepts/actions
 */
const currency = require('currency-format');

module.exports = {
  currencies: function(req, res) {
    const params = req.params.all();
    if (params.currency) {
      const send = {};
      _.each(params.currency, c => {
        send[c] = currency[c];
      });
      return res.send(send);
    }
    return res.send(currency);
  },

  ledger: async function(req, res) {
    const actionUtil = Utils.actionUtil();
    // const params = req.params.all(); // this is the parsed params as from req  with a where clause
    const parsedParams = actionUtil.parseValues(req); // this has stripped out the where an gives us raw params
    // const searchField = parsedParams.search;
    // const stationId = parsedParams.station;
    // const nodeType = parsedParams.schema;
    const costcode = parsedParams.costcode;

    if (!costcode) {
      return res.badRequest({ error: 'Costcode required' });
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
    res.send(CostCode.asCurrency(ledger));
  },

  create: function(req, res) {
    return res.forbidden();
  },

  destroy: function(req, res) {
    return res.forbidden();
  },

  update: function(req, res) {
    return res.forbidden();
  },

  primary: async function(req, res) {
    const params = req.params.all();
    const available = ['user', 'personnel'];
    if (
      !params.id ||
      !params.client_type ||
      _.indexOf(available, params.client_type) === -1
    ) {
      return res.badRequest({
        error: 'A user id is required'
      });
    }

    const reqs = await Requisition.find()
      .where({
        user: params.id,
        primary: true,
        archived: false
      })
      .populate('station');
    if (!_.size(reqs)) {
      return res.send(null);
    }

    const primary = _.where(reqs, { primary: true });
    if (_.size(primary)) {
      return res.send(primary[0].station);
    }
    res.send((reqs[0] || {}).station);
  },

  connect: async function(req, res) {
    /*
     * Note! All auth and permissions is handled by middlewhere that is located in the api/services directory
     */
    const actionUtil = Utils.actionUtil();
    // const params = req.params.all(); // this is the parsed params as from req  with a where clause
    const parsedParams = actionUtil.parseValues(req); // this has stripped out the where an gives us raw params
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
      return res.send(stations);
    }

    if (!stationId) {
      return res.badRequest({ error: 'An entry station is required' });
    }

    if (!nodeType) {
      return res.badRequest({ error: 'A note type is required' });
    }

    // we want to know what nodes are available
    const nIds = _.isArray(nodeType) ? nodeType : [nodeType];
    let nodeField = [];
    for (let i = 0; i < _.size(nIds); i++) {
      const n = nIds[i];
      nodeField = _.union(
        nodeField,
        await StationSchema.getSchemaWithNodes(n, true)
      );
    }
    _.remove(nodeField, n => !n);
    /*
     * We want stations that are bound by a common tag. We don't want to be able to transfer to stations where they cannot
     */
    const common = await Station.commonStationTags(stationId);
    // we want to remove the self station
    _.remove(common, c => c === stationId || c === null);
    // underscore 2 is given to use as a sals global
    if (!_.size(common)) {
      return res.send([]);
    }

    query.id = common;

    if (_.size(nodeField)) {
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
      for (let i = 0; i < _.size(stations); i++) {
        const station_schema = await StationSchema.findOne(
          stations[i].station_type.id
        ).populate('service_nodes');

        const station = _.clone(stations[i]);
        const station_type = _.clone(station.station_type);
        station_type.service_nodes = _.clone(station_schema.service_nodes);
        station.station_type = station_type;
        stations[i] = station;
      }
      return res.send(stations);
    }

    return res.send(stations);
  },

  test: function(req, res) {
    return res.ok();
  }
};
