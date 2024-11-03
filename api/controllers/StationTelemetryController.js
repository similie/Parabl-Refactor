/**
 * StationTelemetryController
 *
 * @description :: Server-side actions for handling incoming requests.
 * @help        :: See https://sailsjs.com/docs/concepts/actions
 */

module.exports = {
  assign: async function(req, res) {
    const assignment = req.params.all();

    if (!assignment.vehicle) {
      return res.badRequest({
        error: 'Vehicle ID required'
      });
    }

    if (!assignment.boundary) {
      return res.badRequest({
        error: 'A boundary ID is required'
      });
    }
    let assign;
    if (req.method === 'POST') {
      assign = await StationBoundary.create(assignment);
    } else if (req.method === 'DELETE') {
      assign = await StationBoundary.destroy(assignment);
      await GeoFeature.destroy({ id: assignment.boundary });
    } else if (req.method === 'PUT') {
      assign = await StationBoundary.update(
        {
          vehicle: assignment.vehicle,
          boundary: assignment.boundary
        },
        {
          active: assignment.active
        }
      );
    }

    res.send(assign);
  },

  boundary: async function(req, res) {
    const params = req.params.all();
    if (!params.id) {
      return res.badRequest({ error: 'Vehicle ID is Required' });
    }

    const sb = await StationBoundary.find()
      .where({ vehicle: params.id, boundary: { '!': null } })
      .sort({
        createdAt: 'DESC'
      })
      .populate('boundary');
    const boundaries = _.map(sb, s => {
      return {
        ...s.boundary,
        active: s.active
      };
    });
    GeoFeature.decorate(boundaries, 'gJson')
      .then(models => {
        res.send(models);
      })
      .catch(res.serverError);
  },

  findOne: function(req, res) {
    Utils.findOne(req, res, async model => {
      await Geo.geoBuildPoints([model], 'stationtelemetry');
      res.send(model);
    });
  },

  find: function(req, res) {
    const params = req.params.all();
    const pretty = params.pretty;
    if (req.body) {
      delete req.body.pretty;
    }
    Utils.getParser(req, res, async models => {
      await Geo.geoBuildPoints(
        models,
        'stationtelemetry',
        pretty ? 'geo_snapped' : 'geo'
      );
      res.send(models);
    });
  },

  simplify: async function(req, res) {
    const params = req.params.all();
    // const params = Utils.params(req);
    // params.id = await Device.findStationBasedOneDevice(params);

    if (!params.id) {
      return res.badRequest({
        error: 'errors.STATION_ID_REQUIRED'
      });
    }
    const station = await Station.findOneById(params.id).populate(
      'station_type'
    );

    const color = (station.station_type || {}).color;

    if (!station) {
      return res.badRequest({
        error: 'errors.STATION_NOT_FOUND'
      });
    }
    // limit count
    const limit = Utils.limit(req);
    const skip = Utils.skip(req);
    let openSessions = [];
    let closedSessions = [];

    if (!params.session) {
      openSessions = await StationTelemetry.findOpenSession(station);
      closedSessions = await StationTelemetry.findClosedSessions(
        station,
        limit,
        skip,
        (params || {}).where
      );
    } else {
      openSessions.push({
        session: params.session,
        station: params.id
      });
    }
    const oSessions = _.filter(
      _.pluck(
        _.isArray(openSessions) ? openSessions : [openSessions],
        'session'
      ),
      f => !!f
    );
    const cSessions = _.filter(_.pluck(closedSessions, 'session'), f => !!f);

    if (!_.size(oSessions) && !_.size(cSessions)) {
      return res.send([]);
    }
    let oResults = [];

    const selectedParam = params.pretty ? 'geo_snapped' : 'geo';

    if (!skip && _.size(oSessions)) {
      oResults = await Geo.getGeoTelmetryPath(
        oSessions,
        null,
        null,
        'geo',
        color
      );
      _.each(oResults, o => {
        o.open = true;
      });
    }

    const cResults = await Geo.getGeoTelmetryPath(
      cSessions,
      null,
      null,
      selectedParam,
      color
    );

    const results = [...oResults, ...cResults];

    res.send(results);
  }
};
