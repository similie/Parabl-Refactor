/**
 * StationBoundary.js
 *
 * @description :: A model definition represents a database table/collection.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

const { SqlUtils } = require('similie-api-services');

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    vehicle: {
      model: 'station',
      required: true
    },
    boundary: {
      model: 'geofeature',
      required: true
    },
    active: {
      type: 'boolean',
      defaultsTo: true
    }
  },

  inclusion_query: function(restricted) {
    const forgivenessBase = parseInt(
      process.env.STATION_BOUNDARY_FORGIVENESS || 20
    );

    const forgiveness = restricted ? forgivenessBase : forgivenessBase * 10;

    const restrict = restricted ? 'true' : 'false';
    const within = restricted ? '>=' : '<=';
    const bool = restricted ? 'bool_and' : 'bool_or';

    return `SELECT
    COALESCE( ${bool}( f.WITHIN ), true ) as valid,
    COUNT (f.*) as count
  FROM
    (
    SELECT
      (
        ST_Distance ( d.geo, d.point, TRUE ) ${within} ${forgiveness} 
      ) AS "within" 
    FROM
      (
      SELECT P
        .geo :: geometry AS "point",
        s.geo :: geometry AS "geo" 
      FROM
        (
        SELECT G
          .geo :: geometry AS "geo" 
        FROM
          stationboundary sb
          JOIN geofeature G ON ( G.ID = sb.boundary )
        WHERE
          sb.vehicle = %s 
          AND sb.active = TRUE AND g.restricted = ${restrict}
        ) P,
        ( SELECT * FROM "stationtelemetry" WHERE "id" = %s ) s 
      ) d 
    ) f`;
  },

  getRestrictedBoundariesBySession: async function(sessionQueryString) {
    const escape = SqlUtils.escapeUtil();
    const query = escape(
      `SELECT jsonb_build_object(
        'features', jsonb_agg(out."gJson") 
      ) as "gJson",
      out.session
      FROM (SELECT SESSION
    .SESSION,
    json_build_object ( 'type', 'Feature', 'geometry', ( ST_AsGeoJSON ( gf.geo ) :: json ), 'properties', json_build_object ( 'color', gf.color ) ) AS "gJson" 
  FROM
    (
    SELECT
      gps."session",
      gps."station",
      ST_MakeLine ( COALESCE ( gps."geo_snapped", gps."geo" ) ORDER BY gps."createdAt" ASC, gps.SESSION ) AS geo 
    FROM
      (
      SELECT
        * 
      FROM
        "stationtelemetry" 
      WHERE
        "session" %s
      ORDER BY
        "session",
        "createdAt" ASC 
      ) AS gps 
    GROUP BY
      gps."session",
      gps."station" 
    ) "session"
    LEFT JOIN "stationboundary" sb ON ( sb.vehicle = SESSION.station )
    LEFT JOIN "geofeature" gf ON ( gf.ID = sb.boundary ) 
  WHERE
    st_intersects ( SESSION.geo, gf.geo :: geometry ) = TRUE 
    AND gf.restricted = TRUE
    ) out
GROUP BY out.session`,
      sessionQueryString
    );
    const results = await Model.queryAsync(query);
    return results.rows;
  },

  placeRestrictionBoundaries: async function(
    sessionQueryString,
    rows,
    geoJsonParam
  ) {
    geoJsonParam = geoJsonParam || 'gJson';
    const restrictions = await this.getRestrictedBoundariesBySession(
      sessionQueryString
    );
    const restrictionCache = {};

    _.each(restrictions, r => {
      restrictionCache[r.session] = r;
    });

    if (!_.size(restrictions)) {
      return;
    }

    _.each(rows, r => {
      const restricted = restrictionCache[r.session];
      if (restricted && restricted[geoJsonParam] && r[geoJsonParam]) {
        _.each((restricted[geoJsonParam] || {}).features, f => {
          r[geoJsonParam].features = r[geoJsonParam].features || [];
          r[geoJsonParam].features.push(f);
        });
      }
    });
  },

  parseInclusionQuery: function(vehicle, telemetry, restricted) {
    const escape = SqlUtils.escapeUtil();
    return escape(
      this.inclusion_query(restricted),
      Station.getId(vehicle),
      StationTelemetry.getId(telemetry)
    );
  },

  runInclusionQuery: async function(vehicle, telemetry, restricted) {
    const query = this.parseInclusionQuery(vehicle, telemetry, restricted);
    const results = await Model.queryAsync(query);
    const row = results.rows.pop();
    return row.valid;
  },

  included: function(vehicle, telemetry) {
    return this.runInclusionQuery(vehicle, telemetry, false);
  },

  excluded: function(vehicle, telemetry) {
    return this.runInclusionQuery(vehicle, telemetry, true);
  }
};
