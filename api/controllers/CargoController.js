/**
 * CargoController
 *
 * @description :: Server-side actions for handling incoming requests.
 * @help        :: See https://sailsjs.com/docs/concepts/actions
 */

const UserController = require('./UserController');
const { SqlUtils } = require('similie-api-services');

module.exports = {
  odometer: async function(req, res) {
    if (req.method !== "POST") {
      return res.badReqest({
        error: "Action unvailable"
      });
    }

    const params = req.params.all();
    if (params.id) {
      return res.send({
        error: "Vehicle ID required"
      });
    }

    const station = await Station.findOneById(params.id).populate(
      "station_type"
    );
    if (!station) {
      return res.send({
        error: "Invalid Station"
      });
    }

    if (params.odometer == null) {
      return res.badReqest({
        error: "Odometer value required"
      });
    }

    const odometer = parseInt(params.odometer);

    if (_.isNaN(odometer) || odometer < 0) {
      return res.badReqest({
        error: "Invalid odometer value. It must be a positive integer"
      });
    }

    const schema = station.station_type.schema;
    const helpers = Module._helpers.logistics("vehicle_parameter");
    const logParams = helpers.logParams(schema);
    const od = logParams("odometer");
    station.schema[od] = odometer;
    await Station.saveAsync(station);
    res.send(station);
  },

  simplify: async function(req, res) {
    const params = req.params.all();
    const id = params.id;

    if (!id) {
      return res.badReqest({ error: "Vehicle ID required" });
    }

    const station = await Station.findOneById(id).populate("station_type");

    if (!station) {
      return res.badReqest({ error: "Vehicle not found" });
    }

    const schema = station.station_type.schema;
    const helpers = Module._helpers.logistics("cargo_parameter");
    const logParams = helpers.logParams(schema);
    const capacity = logParams("capacity");
    const escape = SqlUtils.escapeUtil();
    const progress = params.progress || 1;
    const query = escape(
      `SELECT
    cargo.*,
    ROUND((COALESCE(cargo."volume", 0) / COALESCE (NULLIF(cargo."capacity", 0 ), 1) ) * 100, 2 ) as "percent_full"
    FROM
    (SELECT SUM
      ( "weight" ) AS "weight",
      ( COALESCE ( ( s."schema" ->> '${capacity}' ) :: INT, 0) ) AS "capacity",
      ROUND(
        ( SUM ( C."length" ) :: NUMERIC / 100 ) * ( SUM ( C."width" ) :: NUMERIC / 100 ) * ( SUM ( C."height" ) :: NUMERIC / 100 ),
        2 
      ) AS "volume",
      COUNT(*) as "count"
    FROM
      "cargo"
      C JOIN "station" s ON ( s."id" = C."vehicle" ) 
    WHERE
      C."vehicle" = %s 
      AND C."progress" = ${progress} 
    GROUP BY
      s.SCHEMA ->> '${capacity}'
      ) cargo;`,
      id
    );
    let send = {};
    try {
      const values = await Model.queryAsync(query);
      send = values.rows[0] || {};
    } catch (e) {
      sails.log.error(e);
    }

    if (User.is(req.user, Roles.MANAGER)) {
      const query2 = escape(
        `SELECT SUM( "value" ) as "value"
      FROM
        (
        SELECT DISTINCT ON
          ( p."id" ) p."id",
          ( p."meta" ->> 'projected_cost' ) :: NUMERIC AS "value" 
        FROM
          "cargo"
          c JOIN "purchaseorder" p ON ( "c"."purchase_order" = "p"."id" ) 
        WHERE
          c."vehicle" = %s 
          AND c."progress" = ${progress} 
        GROUP BY
          p."id" 
        ) v`,
        id
      );
      const values = await Model.queryAsync(query2);
      send.estimated_value = _.pluck(values.rows, "value")[0] || {};
    }
    return res.send(send);
  },

  transports: async function(req, res) {
    const params = req.params.all();

    if (!params.station) {
      return res.badReqest({ errors: "Station ID Required" });
    }

    const stationTypes = await StationSchema.find().where({
      is_asset: true,
      is_currier: true,
      is_transport: true
    });

    if (!_.size(stationTypes)) {
      return res.send([]);
    }

    const common = _.filter(
      await Station.commonStationTags(params.station),
      f => !!f
    );

    const assets = await StationAsset.find().where({
      station: common,
      asset: { "!": null }
    });

    if (!assets) {
      return res.send([]);
    }

    const assetIDs = _.pluck(assets, "asset");

    const stations = await Station.find().where({
      station_type: _.pluck(stationTypes, "id"),
      id: assetIDs,
      or: [
        { local_name: { contains: params.search } },
        { station_id: { contains: params.search } },
        { registration_id: { contains: params.search } },
        { code: { contains: params.search } }
      ]
    });

    res.send(stations);
  },
  drivers: async function(req, res) {
    // compatibility
    UserController.personnel(req, res);
  }
};
