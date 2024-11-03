/*
 * Geo utilities for application
 */

const GeoJSON = require('geojson');
const dms2dec = require('dms2dec');
const Q = require('q');
const simplify = require('simplify-js');
const inside = require('point-in-polygon');
const w3w = require('what3words');

const { SqlUtils } = require('similie-api-services');
const escape = SqlUtils.escapeUtil();

/*
  %s formats the argument value as a simple string. A null value is treated as an empty string.
  %Q formats the argument value as a dollar quoted string. A null value is treated as an empty string.
  %I treats the argument value as an SQL identifier, double-quoting it if necessary. It is an error for the value to be null.
  %L quotes the argument value as an SQL literal. A null value is displayed as the string NULL, without quotes.
  % In addition to the format specifiers described above, the special sequence % may be used to output a literal % character.
*/

// var postgis = sails.config.connections.postgis;
module.exports = {
  WITH_WORDS: true,
  NO_WORDS: false,
  stationPointSchema: function() {
    return {
      name: 'lg',
      node_schema: 'public'
    };
  },

  stationPointQuery: function(query) {
    const stationGeo = `
  SELECT
  row_to_json ( fc ) AS geography,
  fc.id,
  fc.members_only,
  fc.station_type,
  fc.local_name,
  REPLACE(fc.word_address, '"', '') as word_address
FROM
  (
SELECT
  'FeatureCollection' AS TYPE,
  array_to_json (
  ARRAY_AGG ( f )) AS features,
  f.id,
  f.members_only,
  f.station_type,
  f.local_name,
  f.word_address::TEXT
FROM
  (
SELECT
  'Feature' AS TYPE,
  ST_AsGeoJSON ( "geo" ) :: json AS geometry,
  lg.id,
  lg.members_only,
  lg.station_type,
  lg.local_name,
  lg.word_address->'words'::TEXT as word_address,
  row_to_json ((
SELECT
  l
FROM
  (
SELECT
  lg.ID,
  lg.members_only,
  'station' AS model_type,
  lg.station_id,
  sc.geo_type,
  sc.station_url,
  sc.color,
  sc.NAME,
  sc.icon,
  sc.ID AS station_type,
  "b".url AS "badge"
  ) AS l
  )) AS properties
FROM
  station AS lg
  JOIN stationschema sc ON lg.station_type = sc.ID
  LEFT JOIN (  SELECT "b".*, "sb"."station" FROM "badging" "b" JOIN  "stationbadge" "sb" on b."id" = "sb"."badge" WHERE "b"."active" IS TRUE ORDER BY "sb"."createdAt" ASC ) "b" ON lg."id" = "b"."station"
%s
  ) AS f GROUP BY f.id, f.members_only, f.station_type, f.word_address::TEXT, f.local_name
  ) AS fc`;

    return escape(stationGeo, query || '');
  },
  /*
   * addGeo
   *
   * adds geo data to a model
   *
   * @params {Object} params - the object we are adding data to
   */
  addGeo: function(params) {
    return function(schema) {
      return new Promise((resolve, reject) => {
        Geo.setGeo(params, err => {
          if (err) {
            return reject(err);
          }
          resolve(schema);
        });
      });
    };
  },

  canImportShape: function(model) {
    return _.contains(['station'], model);
  },

  gets3BaseForShapes: function() {
    return 'resources/shapes/';
  },

  getGeoPoint: function() {
    return 'geography';
  },

  getGeoTelmetryPath: async function(sessions, extras, limit, param, color) {
    extras = extras || '';
    limit = limit || '';
    const paramKey = param || 'geo';
    const exapedKey = escape('%s', paramKey);
    const geoJsonParam = 'gJson';

    if (!_.size(sessions)) {
      return [];
    }

    const inSession = _.isArray(sessions)
      ? ` ${SqlUtils.setInString(sessions)}`
      : ` = ${sessions}`;

    const query = escape(
      `SELECT
    fc.distance,
    fc.COUNT::INT4,
    fc.max_speed,
    fc.max_altitude,
    fc.min_altitude,
    fc.end_time,
    fc.start_time,
    EXTRACT(EPOCH FROM (fc.end_time::timestamp - fc.start_time::timestamp)) as duration,
    fc.accuracy,
    fc.quality,
    fc.SESSION,
    fc.station,
    fc.alert,
    row_to_json ( fc ) AS "${geoJsonParam}"
  FROM
    (
    SELECT
      'FeatureCollection' AS TYPE,
      array_to_json ( ARRAY_AGG ( f ) ) AS features,
      f.COUNT AS "count",
      SUM ( f.distance ) AS "distance",
      SUM ( f.max_speed ) AS "max_speed",
      SUM ( f.max_altitude ) AS "max_altitude",
      SUM ( f.min_altitude ) AS "min_altitude",
      SUM ( f.accuracy ) AS "accuracy",
      SUM ( f.quality ) AS "quality",
			bool_or ( f."alert" ) AS "alert",
			AVG ( f."humidity" ) AS "humidity",
			AVG ( f."temperature" ) AS "temperature",
			AVG ( f."fuel" ) AS "fuel",
      f.end_time AS "end_time",
      f.start_time AS "start_time",
      f.SESSION AS "session",
      f.station AS "station"
    FROM
      (
      SELECT
        'Feature' AS TYPE,
        ST_AsGeoJSON ( lg.geo ) :: json AS geometry,
        row_to_json (
          (
          SELECT
            l
          FROM
            (
            SELECT
              '${escape('%s', color || '#06c4de')}' as "color",
              8 as "stroke",
              lg.distance,
              lg.COUNT,
              lg.max_speed,
              lg.max_altitude,
              lg.min_altitude,
              lg.end_time,
              lg.start_time,
              lg.accuracy,
              lg.quality,
              lg.SESSION,
              lg.station,
              lg.alert,
				      lg.humidity,
				      lg.temperature,
				      lg.fuel,
              lg."count"
            ) AS l
          )
        ) AS properties,
        ST_Length ( ST_Transform ( lg.geo, 4326 ), TRUE ) AS "distance",
        lg.max_speed,
        lg.max_altitude,
        lg.min_altitude,
        lg.end_time,
        lg.start_time,
        lg.accuracy,
        lg.quality,
        lg.SESSION,
        lg.station,
        lg.alert,
				lg.humidity,
				lg.temperature,
				lg.fuel,
        lg."count"
      FROM
        (
        SELECT
          ST_Length ( ST_Transform ( sess.geo, 4326 ), TRUE ) AS "distance",
          sess.*
        FROM
          (


          SELECT COUNT
            ( * ) AS "count",
            COALESCE ( MAX ( "speed" ), 0 ) AS "max_speed",
            COALESCE ( MAX ( "altitude" ), 0 ) AS "max_altitude",
            COALESCE ( MIN ( "altitude" ), 0 ) AS "min_altitude",
            MAX ( "createdAt" ) AS "end_time",
            MIN ( "createdAt" ) AS "start_time",
            AVG ( "accuracy" ) AS "accuracy",
            AVG ( "quality" ) AS "quality",
            COALESCE(bool_or ( "alert" ), false ) AS "alert",
						COALESCE(AVG ( "humidity" ), 0 ) AS "humidity",
						COALESCE(AVG ( "temperature" ), 0)  AS "temperature",
						COALESCE(AVG ( "fuel" ), 0 ) AS "fuel",
            gps."session",
            gps."station",
            ST_MakeLine ( COALESCE(gps."${exapedKey}", gps."geo" ) ORDER BY gps."createdAt" ASC, gps.session ) AS geo
          FROM
          (
						SELECT * FROM "stationtelemetry"
						WHERE "session" %s
            %s
						ORDER BY "session", "createdAt" ASC
					) AS gps
          GROUP BY
            "session",
            "station"
          ) "sess"
          ORDER BY
          "start_time" DESC
        ) AS lg
      ) AS f
    GROUP BY
      f.end_time,
      f.start_time,
      f.SESSION,
      f.station,
      f."count"
    ) AS fc
  ORDER BY
    fc."start_time" DESC
    %s
    ;`,
      inSession,
      extras,
      limit
    );

    const data = await StationTelemetry.queryAsync(query);
    const rows = data.rows;
    await StationBoundary.placeRestrictionBoundaries(inSession, rows);
    return rows;
  },

  /*
   * Convertgs a Geo GSON feature to a geometry string
   * for db creation
   */
  stringGeometryFromGeoJson: function(gJson) {
    const deferred = Q.defer();

    if (!_.size(gJson)) {
      deferred.resolve();
      return deferred.promise;
    }

    let jString;
    // "crs":{"type":"name","properties":{"name":"EPSG:4326"}}
    gJson.crs = { type: 'name', properties: { name: 'EPSG:4326' } }; // 'EPSG:3785'

    try {
      jString = JSON.stringify(gJson);
    } catch (e) {
      deferred.reject(e);
      return deferred.promise;
    }

    // SELECT ST_AsText(ST_Transform(ST_GeomFromText('POLYGON((743238 2967416,743238 2967450 743265 2967450,743265.625 2967416,743238 2967416))',2249),4326)) As wgs_geom
    // "SELECT ST_GeomFromText(ST_Transform(ST_SetSRID(ST_AsText(ST_GeomFromGeoJSON('%s')), 3785), 4326)) As geotext;";
    /// var query = "SELECT ST_GeomFromText(ST_Transform(ST_SetSRID(ST_AsText(ST_GeomFromGeoJSON('%s')), 4326), 4326)) As geotext;";
    // var query ="SELECT ST_Transform(ST_SetSRID(ST_GeomFromText( ST_AsText('0105000020AD1000000100000001020000002A000000A7308A34E2D92341898DDC1B29226141B135892C1EDA23410D40F8AF222261413D5DCE4208DA2341E36651CB20226141DB79E4D35DDA23417DA4D0490622614194872C1F8CD92341B42F075904226141DD5238B38DD92341552C30BD02226141D87B13AB83D92341BFC0EC3303226141D08FBF3D04D923415068B73B03226141E15CD70DC4D92341694AAA5DD7216141D5509E80B0D72341F1DD2AA6D6216141FB315336C2D62341768D1B58D3216141F4EFF941A3D52341970E825DCF216141A4C1FE4328D42341F0505C52CE2161415055CAB33DD4234132371569C8216141146096399ED32341765A4F3BC521614129AE30D4FED22341315D6562C32161414E385F79FECD2341D7AD1CEEB1216141EA61B4DBE7CC234127E4A321AD216141D4C1FDD681CA234124411022A72161415F3CA06FE0C923417F851BC39F216141043CE4B537C62341EFEC56908C2161410E2C2DA1BAC4234169EBF28484216141C0F2912BD7C22341A12411B87A216141B2C1B5F02BC2234167C3FE28772161411BD93636D8BF2341D9FC45636E216141A4C1D5894FBD2341C528A558552161415E4EFCFF53BA234177DD68D42D21614116B04977C5B92341C74AE9702D21614189B859563BB923417DA11A92222161417AC552D050B9234170CA9D361D216141770C7285F6B92341D12DA699182161413CAF7E16D3BA2341764CB6240C21614134BBE17E79BB23414BB42F32F7206141A797D423C7BB23415F8E51DDE3206141F717E5F49DBC2341C5B1E86CCB2061416DB172A7C3BF234100F9A3754F206141DE46010CC7BF234101941F3234206141169E1BF61BC02341392937682A206141566897D8D3C023411DE4B98E21206141F3FA8F8E43C22341695FE910F31F6141EBB116D27DC223411C9A7232EC1F6141FE021F0FEFC2234199301587DF1F6141')),4326),4326) As geotext;"
    // var query = "SELECT ST_GeomFromText(ST_Transform(ST_SetSRID( ST_AsText(ST_GeomFromGeoJSON('%s')), 4326 ), 4326) ) As geotext;"
    const query =
      "SELECT ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON('%s'), 4326), 4326 ) As geotext;";
    const query2 =
      "SELECT ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON('%s'), 23882), 4326 ) As geotext;";

    // var query = "SELECT ST_Transform(ST_GeomFromGeoJSON('%s'), 4326 ) As geotext;"
    Model.query(escape(query2, jString), (err, conv) => {
      if (err) {
        return deferred.reject(err);
      }
      if (!conv || !_.size(conv)) {
        return deferred.resolve();
      }
      const rows = _.pluck(conv.rows, 'geotext');
      const row = rows.pop();
      deferred.resolve(row);
    });

    return deferred.promise;
  },
  pullDistrict: function(value, key) {
    const deferred = Q.defer();

    key = key || 'geo';

    if (!value[key]) {
      return deferred.resolve(value);
    }

    const query =
      "SELECT row_to_json(fc) as %s FROM ( SELECT 'FeatureCollection' As type, array_to_json(array_agg(f)) As features FROM (SELECT 'Feature' As type, ST_AsGeoJSON('%s')::json As geometry , row_to_json((SELECT l FROM (SELECT lg.id, 'district' as model_type, lg.code, lg.district_type, lg.color, lg.name::json)  As l)) As properties FROM \"district\" As lg WHERE id = %s) As f ) As fc;";

    Model.query(escape(query, key, value[key], value.id), (err, conv) => {
      if (err) {
        return deferred.reject(err);
      }

      if (!conv) {
        return deferred.resolve(value);
      }

      const row = conv.rows;
      value[Geo.getGeoPoint()] = row[0].geo;
      delete value.geo;
      deferred.resolve(value);
    });

    return deferred.promise;
  },

  pullGeoFeature: function(value, key, as) {
    const deferred = Q.defer();

    key = key || 'geo';
    as = as || Geo.getGeoPoint();

    if (!value[key]) {
      return deferred.resolve(value);
    }
    const query = `SELECT row_to_json(fc) as %s FROM ( SELECT 'FeatureCollection' As type, array_to_json(array_agg(f)) As features FROM (SELECT 'Feature' As type, ST_AsGeoJSON('%s')::json As "geometry", row_to_json((SELECT l FROM (SELECT lg.id, 'geo_features' as model_type, lg.color, lg.type, lg.description, lg.name::json)  As l)) As properties FROM "geofeature" As lg WHERE id = %s) As f ) As fc;`;
    Model.query(escape(query, key, value[key], value.id), (err, conv) => {
      if (err) {
        return deferred.reject(err);
      }

      if (!conv) {
        return deferred.resolve(value);
      }

      const row = conv.rows;
      value[as] = row[0].geo;
      delete value.geo;
      deferred.resolve(value);
    });

    return deferred.promise;
  },

  pullSimpleNode: function(value, key) {
    const deferred = Q.defer();
    key = key || 'geo';

    if (!value[key]) {
      return deferred.resolve(value);
    }
    const query =
      "SELECT row_to_json(point) as %s from (select ST_X('%s') as longitude, ST_Y('%s') as latitude ) as point;";

    Model.query(escape(query, key, value[key], value[key]), (err, conv) => {
      if (err) {
        return deferred.reject(err);
      }

      if (!conv) {
        return deferred.resolve(value);
      }

      const row = conv.rows;
      value[Geo.getGeoPoint()] = row[0].geo;
      delete value.geo;
      deferred.resolve(value);
    });

    return deferred.promise;
  },

  pullGeoJsonNode: function(value, schema, key) {
    const deferred = Q.defer();

    key = key || 'geo';

    if (!value[key]) {
      return deferred.resolve(value);
    }

    const name = schema.name;
    const query =
      'SELECT row_to_json(fc) as %s FROM ( SELECT \'FeatureCollection\' As type, array_to_json(array_agg(f)) As features FROM (SELECT \'Feature\' As type , ST_AsGeoJSON(\'%s\')::json As geometry , row_to_json((SELECT l FROM (SELECT lg.id, \'node\' as model_type, lg.station, sc.color, sc.name, sc.id as schema)  As l)) As properties FROM "nodes"."%s" As lg JOIN "public"."nodeschema" sc ON lg."schema" = sc.id WHERE lg.id = %s) As f ) As fc;';

    Model.query(escape(query, key, value[key], name, value.id), (err, conv) => {
      if (err) {
        return deferred.reject(err);
      }

      if (!conv) {
        return deferred.resolve(value);
      }

      const row = conv.rows;
      value[Geo.getGeoPoint()] = row[0].geo;
      delete value.geo;
      deferred.resolve(value);
    });

    return deferred.promise;
  },

  pullGeoJson: function(value, key) {
    const deferred = Q.defer();

    key = key || 'geo';

    if (!value[key]) {
      return deferred.resolve(value);
    }

    const query =
      "SELECT row_to_json(fc) as %s FROM ( SELECT 'FeatureCollection' As type, array_to_json(array_agg(f)) As features FROM (SELECT 'Feature' As type , ST_AsGeoJSON('%s')::json As geometry , row_to_json((SELECT l FROM (SELECT lg.id, 'station' as model_type, lg.station_id, lg.local_name, sc.geo_type, sc.station_url, sc.color, sc.name, sc.icon, sc.id as station_type)  As l)) As properties FROM station As lg JOIN stationschema sc ON lg.station_type = sc.id WHERE lg.id = %s) As f ) As fc;";
    Model.query(escape(query, key, value[key], value.id), (err, conv) => {
      if (err) {
        sails.log.error(err);
        return deferred.reject(err);
      }

      if (!conv) {
        return deferred.resolve(value);
      }

      const row = conv.rows;
      value[Geo.getGeoPoint()] = row[0].geo;
      deferred.resolve(value);
    });

    return deferred.promise;
  },

  getPairsOrder: function(poly) {
    const lnglat = Geo.isBouned(poly[1], poly[0]);

    if (lnglat) {
      return {
        0: 'lng',
        1: 'lat'
      };
    }

    const latlng = Geo.isBouned(poly[0], poly[1]);

    if (latlng) {
      return {
        0: 'lat',
        1: 'lng'
      };
    }
  },

  inside: function(point, poly) {
    if (point && point.lat && point.lng) {
      const chunk = _.chunk(poly, 2);
      const orders = this.getPairsOrder(poly);
      return inside([point[orders[0]], point[orders[1]]], chunk);
    }

    return null;
  },
  stripJSON: function() {
    // var self = this;
    return function() {
      const model = this.toObject();
      if (!model.meta || !model.meta.color) {
        model.meta = model.meta || {};
        const existingPoly = _.where((model.geoPoint || {}).features, {
          geometry: {
            type: 'Polygon'
          }
        });

        if (
          existingPoly &&
          existingPoly.length &&
          existingPoly[0].properties &&
          existingPoly[0].properties.color
        ) {
          model.meta.color = existingPoly[0].properties.color;
        } else {
          model.meta.color = Utils.color();
        }
      }

      delete model.geoPoint;
      return model;
    };
  },
  isSimple: function() {
    return process.env.GEO_SIMPLIFY_GEO || true;
  },
  simplicityFactor: function() {
    return process.env.GEO_SIMPLICITY_FACTOR || 0.0013; // 0.003;
  }, // 0.003,
  simplicity: function(poly) {
    let transformed;
    if (poly && poly.length) {
      transformed = [];
      const polys = setPollies(poly);
      const simplified = simplify(polys, this.simplicityFactor(), false);
      _.each(simplified, simple => {
        transformed.push(simple.y);
        transformed.push(simple.x);
      });
    }

    return transformed;
  },

  aggregateLineChildren: async function(station, orderBy = 'id') {
    const meta = station.meta || {};
    const children =
      meta.links || (await Station.children(station, false, false));
    const ids = children.map(c => Model.getId(c));
    if (!ids.length) {
      return null;
    }
    const inString = SqlUtils.setInString(ids);
    const query = escape(
      `SELECT ST_AsGeoJSON (st_makeline(ST_SetSRID(st.geo, 4326 ) ))::JSON as "geo"
     FROM (SELECT * FROM "station" "s"
     JOIN "stationschema" "sc" ON "s"."station_type" = "sc"."id" 
     WHERE "s"."id" %s  AND "sc"."geo_type" = 'polyline' AND "geo" IS NOT NULL ORDER BY (%s::TEXT)::INT 
     ) st;`,
      inString,
      orderBy
    );
    const results = await Model.queryAsync(query);
    const [row] = results.rows;
    return {
      properties: {
        id: Model.getId(station),
        station_type: Model.getId(station.station_type),
        children: ids
      },
      ...row.geo
    };
  },

  findStationsWithinBounds: async function(bounds) {
    if (_.size(bounds) !== 4) {
      throw new Error('station boundaries incomplete');
    }

    const query = `
      SELECT
        id
      FROM
        "station"
      WHERE
        ST_Intersects(
          ST_SetSRID(ST_MakeBox2D (
            ST_SetSRID(ST_Point( %s,  %s ),4326),
            ST_SetSRID(ST_Point( %s, %s ),4326)),
        4326), ST_SetSRID("geo"::geometry, 4326 ) ) AND "geo" IS NOT NULL;
    `;

    const ids = await Station.queryAsync(
      escape(
        query,
        bounds.lngNorthEast,
        bounds.latNorthEast,
        bounds.lngSouthWest,
        bounds.latSouthWest
      )
    );
    return ids.rows;
  },

  getCenter: function(geo) {
    const query =
      "SELECT ST_X(center) as longitude, ST_Y(center) as latitude from ST_Centroid(ST_GeomFromText(ST_AsText('%s') ,4326)) as center;";
    const deferred = Q.defer();

    Model.query(escape(query, geo), (err, center) => {
      if (err) {
        sails.log.error(err);
        return deferred.reject(err);
      }
      // var isInside = center.rows[0];
      deferred.resolve(center.rows[0]);
    });

    return deferred.promise;
  },

  isContained: function(inside, outside) {
    const query =
      "SELECT ST_Contains(ST_GeomFromText(ST_AsText('%s')), ST_GeomFromText(ST_AsText('%s'))) as inside;";

    const deferred = Q.defer();

    Model.query(escape(query, inside, outside), (err, inside) => {
      if (err) {
        sails.log.error(err);
        return deferred.reject(err);
      }

      const isInside = inside.rows[0];

      deferred.resolve(isInside);
    });

    return deferred.promise;
  },

  pullPointsIntoArray: async function(table, where, param, order) {
    param = param || 'geo';
    order = order || '"createdAt" ASC';
    where = where || '';
    const query = escape(
      `SELECT ARRAY
    (
    SELECT
      json_build_object ( 'lat', LAT, 'lng', LONG, 'id', "id" )
    FROM
      (
      SELECT
        ST_X ( ST_TRANSFORM ( "${escape('%s', param)}", 4674 ) ) AS LONG,
        ST_Y ( ST_TRANSFORM ( "${escape('%s', param)}", 4674 ) ) AS LAT,
        "id" as "id"
      FROM
        "%s"
      ${escape('%s', where)}
      ORDER BY
       ${escape('%s', order)}
      ) st
    ) AS "${escape('%s', param)}";`,
      table
    );
    const results = await Model.queryAsync(query);
    return results.rows.pop();
  },

  getSimpleStationPoints: async function(stations) {
    const _stationsArr = _.isArray(stations) ? stations : [stations];
    const _stations = _stationsArr.map(s => Station.getId(s));
    const query = `SELECT
    ST_X ( ST_TRANSFORM ( "geo", 4674 ) ) AS lng,
    ST_Y ( ST_TRANSFORM ( "geo", 4674 ) ) AS lat,
    "local_name" as "name",
    "station_type" as "identity",
    "id" as "id"
  FROM "station" WHERE "id" ${SqlUtils.setInString(_stations)};`;
    const results = await Station.queryAsync(query);
    return results.rows;
  },

  simplify: function(req, res) {
    /*
     * This is a test for the station name formatting
     */

    Utils.getParser(req, res, (err, models) => {
      if (err) {
        sails.log.error(err);
        return res.serverError(err);
      }

      const transformedModels = [];

      _.each(models, model => {
        const poly = (model.toJSON.bind(model) || _.noop)().polygon;

        model.polygon = Geo.simplicity(poly);

        transformedModels.push(model);
      });

      res.send(transformedModels);
    });
  },

  parse: GeoJSON.parse,
  convert: dms2dec,
  // gps: gps,
  geoPullBoundaryData: function(geoA, geoB) {
    const deferred = Q.defer();
    const query =
      "SELECT ST_Intersects(ST_GeomFromText(ST_AsText('%s'), 4326), ST_GeomFromText(ST_AsText('%s'), 4326) ) as crossing, ST_Contains(ST_GeomFromText(ST_AsText('%s'), 4326), ST_GeomFromText(ST_AsText('%s'), 4326) ) as inside, ST_Distance(ST_Transform(ST_GeomFromText(ST_AsText('%s'), 4326), 2163), ST_Transform(ST_GeomFromText(ST_AsText('%s'), 4326), 2163) ) as distance;";

    Model.query(
      escape(query, geoA, geoB, geoA, geoB, geoA, geoB),
      (err, distance) => {
        if (err) {
          sails.log.error(err);
          return deferred.reject(err);
        }

        if (!distance) {
          return deferred.resolve(distance);
        }

        const row = distance.rows;
        deferred.resolve(row[0]);
      }
    );

    return deferred.promise;
  },

  geoBuildPoints: async function(elements, model, col) {
    col = col || 'geo';
    const ids = _.pluck(elements, 'id');
    if (!_.size(ids)) {
      return [];
    }

    const query = `SELECT "id", json_build_object('latitude', LAT, 'longitude', LONG) as "point" FROM (
      SELECT id, ST_X(ST_TRANSFORM(COALESCE("${col}", "geo" ) ,4674)) AS LONG, ST_Y(ST_TRANSFORM(COALESCE("${col}", "geo" ) ,4674)) AS LAT FROM "${model}" WHERE "id" ${SqlUtils.setInString(
      ids
    )})  st;`;

    const results = await Model.queryAsync(query);
    const values = results.rows;
    const vCache = {};
    _.each(values, v => {
      vCache[v.id] = v.point;
    });

    _.each(elements, e => {
      delete e[col];
      e.__point = vCache[e.id];
    });
    return elements;
  },

  geoIntercepts: function(geoA, geoB) {
    const deferred = Q.defer();
    const query =
      "SELECT ST_Intersects(ST_GeomFromText(ST_AsText('%'), 4326), ST_GeomFromText(ST_AsText('%'), 4326) ) as crossing;";

    Model.query(escape(query, geoA, geoB), (err, distance) => {
      if (err) {
        sails.log.error(err);
        return deferred.reject(err);
      }

      if (!distance) {
        return deferred.resolve(distance);
      }

      const row = distance.rows;
      deferred.resolve(row[0]);
    });

    return deferred.promise;
  },

  findGeomDistanceMeters: function(geoA, geoB) {
    const deferred = Q.defer();
    const query =
      "SELECT ST_Distance(ST_Transform(ST_GeomFromText(ST_AsText('%s'), 4326), 2163), ST_Transform(ST_GeomFromText(ST_AsText('%s'), 4326), 2163) ) as distance;";

    Model.query(escape(query, geoA, geoB), (err, distance) => {
      if (err) {
        sails.log.error(err);
        return deferred.reject(err);
      }

      if (!distance) {
        return deferred.resolve(distance);
      }

      const row = distance.rows;
      deferred.resolve(row[0]);
    });

    return deferred.promise;
  },

  findClosestStation: async function(
    point,
    filter,
    desc = false,
    limit = null
  ) {
    filter = filter || '';
    const lat = point.lat;
    const lng = point.lng;
    const query = escape(
      `SELECT ID
    ,
    ST_Distance (
      ST_Transform ( ST_GeomFromText ( ST_AsText ( "geo" ), 4326 ), 2163 ),
      ST_Transform ( ST_SetSRID ( ST_Point ( %s, %s ), 4326 ), 2163 )
    ) AS distance
  FROM
    station
  WHERE
    geo IS NOT NULL
    ${filter}
  ORDER BY
    distance ${desc ? 'DESC' : ''} ${limit ? 'limit %s' : ''} ;`,
      lng,
      lat,
      limit
    );

    const results = await Station.queryAsync(query);
    return results.rows;
  },

  findPointWithinDistance: function(params, cb) {
    const lat = params.lat;
    const lng = params.lng;
    const distance = params.distance;
    Station.query(
      escape(
        'SELECT * FROM station WHERE ST_DWithin(station.geo::geometry, ST_SetSRID(ST_Point(%s, %s),4326), %s )',
        lng,
        lat,
        distance
      ),
      cb
    );
  },

  lng: {
    min: 124,
    max: 127.4
  },

  lat: {
    min: -9.51,
    max: -8.11
  },

  setGeoByType: async function(values, type, noWords) {
    switch (type) {
      case 'polygon':
        await setPolygon(values);
        break;
      case 'circle':
        await setCirc(values);
        break;
      case 'rectangle':
        await setRec(values);
        break;
      case 'polyline':
        await setLine(values);
        break;
      default:
        await setPoint(values, null, noWords);
        break;
    }
  },

  setGeo: function(values, next) {
    if (values.polygon) {
      setPolygon(values, next);
    } else if (values.polyline) {
      setLine(values, next);
    } else if (values.circle) {
      setCirc(values, next);
    } else if (values.rectangle) {
      setRec(values, next);
    } else if (values.point || values.__point__) {
      setPoint(values, next);
    } else {
      delete values[Geo.getGeoPoint()];
      return next();
    }
  },

  /*
   * Check to ensure the lat/lng are withing the specified ranges
   */
  isBouned: function() {
    return true;
  },

  updateGeo: function(values, model, next) {
    return next();
  },

  parseLocation: function(values, next) {
    // if we have a point value
    const polygon = values.polygon;
    const point = values.point;

    // first remove the geoPoint so we don't need
    // change the seeding files. Attempted optimize

    /*
     * If we simply have point data, we process that single point
     */
    if (point && !polygon) {
      const lat = point.lat;
      const lng = point.lng;

      if (lat && lng) {
        // we ensure that the geometry is bounded
        if (!Geo.isBouned(lat, lng)) {
          return next('errors.GEO_OUT_OF_BOUNDS');
        }
        // now we set the geop
        const g = Geo.parse(
          [
            {
              lat: lat,
              lng: lng,
              type: 'district'
            }
          ],
          {
            Point: ['lat', 'lng']
          }
        );

        values.geoPoint = g;

        // values.geoPoint = g.features.pop();

        // if (geo && geo.geometry) {
        //     values.geoPoint = geo.geometry;
        // }
      }
    }

    /*
     * If we have polygon values. Let's do some work
     */
    if (polygon && polygon.length) {
      // we want to know if the lat/lgn or the lng/lat comes fist
      // se we test it against our bounds
      const lnglat = Geo.isBouned(polygon[1], polygon[0]);

      let latlng = true;
      if (!lnglat) {
        // this is lat/lgn
        latlng = Geo.isBouned(polygon[0], polygon[1]);
      }
      // if neither work, reject!
      if (!lnglat && !latlng) {
        sails.log.error('INITIAL Bounding error', polygon[0], polygon[1]);
        return next('errors.GEO_OUT_OF_BOUNDS');
      }
      // contain the pollygons
      const polys = [];

      let valid = true;

      _.each(
        polygon,
        (poly, i) => {
          // if even, then we have a change
          const even = i % 2 === 0;

          if (even) {
            // on even, we start fresh
            this.poly = {};
            // if we have lnglat the even is here
            if (lnglat) {
              this.poly.lng = poly;
            } else {
              this.poly.lat = poly;
            }
          } else {
            if (lnglat) {
              this.poly.lat = poly;
            } else {
              this.poly.lng = poly;
            }

            // on odd, we push our values
            const bounded = Geo.isBouned(this.poly.lat, this.poly.lng);
            // if we have values that aren't bounded, let the user know
            if (!bounded && valid) {
              sails.log.error(
                'Bound error',
                bounded,
                this.poly.lat,
                this.poly.lng
              );

              valid = false;
              return next('errors.GEO_OUT_OF_BOUNDS');
            }
            // push it
            polys.push(this.poly);
          }
        },
        {
          poly: {}
        }
      );

      if (!valid) {
        return;
      }
      // override for previous behavior
      values.meta = values.meta || {};
      // set the color
      values.meta.color = values.meta.color || Utils.color();
      // here we want to persist the existing color
      if (values.geoPoint && values.geoPoint.features) {
        const existingPoly = _.where(values.geoPoint.features, {
          geometry: {
            type: 'Polygon'
          }
        });

        if (
          existingPoly &&
          existingPoly.length &&
          existingPoly[0].properties &&
          existingPoly[0].properties.color
        ) {
          values.meta.color = existingPoly[0].properties.color;
        }

        values.geoPoint = null;
      }
      return next();
    }
    next();
  },

  getWhat3Words: async function(words, domain) {
    const config = await Site.thisSiteAsync(domain);
    if (!config.integrations || !config.integrations.what_3_words) {
      return null;
    }
    const wordOptions = {
      key: config.integrations.what_3_words,
      lang: 'en' // we need to consider language
    };

    w3w.config(wordOptions);
    const response = await w3w.forward({
      addr: words
    });
    return response;
  },
  setWhat3Words: function(values, lat, lng) {
    return setWhat3Words(values, lat, lng);
  },
  getLineLength: async function(geoString) {
    const query = escape(
      `SELECT ST_Length( ST_GeomFromText(ST_AsText('%s'), 4326))`,
      geoString
    ); // color #2d8a66
    const results = await Model.queryAsync(query);
    const [row] = results.rows;
    return row.st_length;
  }
};

function setPollies(arr = []) {
  const polys = [];
  let poly = {};
  for (let i = 0; i < arr.length; i++) {
    const value = arr[i];
    const pVal = _.isString(value) ? parseFloat(value) : value;
    if (i % 2 === 0) {
      poly.y = pVal;
    } else {
      poly.x = pVal;
      polys.push({ ...poly });
      poly = {};
    }
  }

  return polys;
}

async function setWhat3Words(values, lat, lng) {
  const domain = Domain.getId(values.domain);
  const config = await Site.thisSiteAsync(domain);
  if (!config.integrations || !config.integrations.what_3_words) {
    return null;
  }
  const wordOptions = {
    key: config.integrations.what_3_words,
    lang: 'en' // we need to consider language
    // display : 'terse'
  };

  w3w.config(wordOptions);
  const pairs = `${lat},${lng}`;
  const response = await w3w.reverse({
    coords: pairs
  });
  return response;
}

async function setPoint(values, _next, noWords) {
  let point = _.clone(values.point || values.__point__);
  const next = _next || _.noop;
  if (values[Geo.getGeoPoint()]) {
    delete values[Geo.getGeoPoint()];
  }

  if (_.isString(point)) {
    const joined = point.split(',');
    point = {
      lat: joined[1],
      lng: joined[0]
    };
  }

  return new Promise(async (resolve, reject) => {
    if (!point || !_.size(point)) {
      delete values.point;
      resolve();
      return next();
    }

    const lat = point.lat;
    const lng = point.lng;

    if (!lat || !lng) {
      delete values.point;
      resolve();
      return next();
    }

    /*
    We can then look to validate if that point is contained in a district.
    */
    const q = escape(
      `SELECT ST_SetSRID(ST_Point( %s, %s), 4326) as geo;`,
      lng,
      lat
    );

    try {
      const value = await Model.queryAsync(q);
      const rows = value.rows;
      delete values.point;
      if (!rows.length) {
        resolve();
        return next();
      }

      values.geo = rows[0].geo;
      if (noWords === Geo.NO_WORDS) {
        resolve();
        return next();
      }
      // need to restrict this
      const words = await setWhat3Words(values, lat, lng);
      values.word_address = words;
      resolve();
      return next();
    } catch (e) {
      sails.log.error(e);
      reject(e);
      return next(e);
    }
  });
}

function splitPoly(arr) {
  let lineString = splitPointArrayToLine(arr);

  if (arr[1] !== arr[arr.length - 1] && arr[0] !== arr[arr.length - 2]) {
    lineString += ', ' + arr[0] + ' ' + arr[1];
  }

  return lineString;
}

function manageLineStringAdd(point, index, length) {
  let lineString = '';
  lineString += point;
  // if we are not at the 0 index
  if (lineString && index % 2 === 0) {
    lineString += ' ';
  } else if (index < length - 1 && index % 2 !== 0) {
    lineString += ', ';
  }
  return lineString;
}

function arrayLikeString(arr = '') {
  if (Array.isArray(arr)) {
    return arr;
  }

  if (_.isString(arr) && (!arr.startsWith('[') || !arr.endsWith(']'))) {
    return arr;
  }

  try {
    return JSON.parse(arr);
  } catch (e) {
    sails.log.error(e);
    return arr;
  }
}

function splitPointArrayToLine(arr) {
  let lineString = '';
  _.each(arr, (point, index) => {
    // set the string
    const values = arrayLikeString(point);
    if (!_.isArray(values)) {
      lineString += manageLineStringAdd(values, index, arr.length);
    } else {
      lineString += values.join(' ') + (index < arr.length - 1 ? ', ' : '');
    }
  });
  // ends the polygon
  return lineString;
}

function parseValuesToLineArray(line) {
  if (Array.isArray(line)) {
    return line;
  }

  return stripPolyString(line);
}

async function setLine(values, _next) {
  const line = values.polyline || [];
  const next = _next || _.noop;

  if (values[Geo.getGeoPoint()]) {
    delete values[Geo.getGeoPoint()];
  }

  if (!line.length) {
    delete values.polyline;
    return next();
  }

  try {
    const lines = parseValuesToLineArray(line);
    const polyLine = splitPointArrayToLine(lines);
    const results = await Model.queryAsync(
      escape(
        "SELECT ST_MakeLine(ST_GeomFromText('LINESTRING(%s)')) as geo;",
        polyLine
      )
    );
    const [row] = results.rows;
    if (!row) {
      return next();
    }

    values.geo = row.geo;
    next();
  } catch (e) {
    sails.log.error(e);
    return next(e);
  }
}

function stripPolyString(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    sails.log.error(e);
  }
  // fallback to an old method
  let alteredText = text.replaceAll(' ', '');
  alteredText = alteredText.replaceAll('\n', '');
  const textArr = alteredText.split(',');

  if (textArr.length % 2 !== 0) {
    throw new Error('errors.UNBALANCED_ARRAY_MUST_BE_EVEN');
  }
  return textArr;
}

function setCirc(values, _next) {
  const circle = values.circle;
  const next = _next || _.noop;
  if (values[Geo.getGeoPoint()]) {
    delete values[Geo.getGeoPoint()];
  }

  return new Promise((resolve, reject) => {
    if (!circle || !_.size(circle)) {
      delete values.circle;
      resolve();
      return next();
    }

    if (!_.size(circle) === 3) {
      delete values.circle;
      resolve();
      return next();
    }

    // ST_Buffer(ST_SetSRID(ST_Point( 126.28001008182764, -8.745611670639079), 4326), 20.30909432904004) as geo;

    Model.query(
      escape(
        'SELECT ST_Buffer(ST_SetSRID(ST_Point( %s, %s), 4326)::geography, %s) as geo;',
        circle.lng,
        circle.lat,
        circle.rad
      ),
      (err, value) => {
        delete values.circle;

        if (err) {
          sails.log.error(err);
          reject(err);
          return next(err);
        }

        const rows = value.rows;

        if (!rows.length) {
          resolve();
          return next();
        }

        values.geo = rows[0].geo;
        resolve();
        next();
      }
    );
  });
}

function setRec(values, _next) {
  const rec = values.rectangle;
  const next = _next || _.noop;
  if (values[Geo.getGeoPoint()]) {
    delete values[Geo.getGeoPoint()];
  }

  return new Promise((resolve, reject) => {
    if (!rec || !_.size(rec)) {
      delete values.rectangle;
      return next();
    }

    if (!_.size(rec.sw) === 2 || !_.size(rec.ne) === 2) {
      delete values.rec;
      return next();
    }

    Model.query(
      escape(
        'SELECT ST_MakeEnvelope(%s, %s, %s, %s, 4326) as geo;',
        rec.sw.lng,
        rec.sw.lat,
        rec.ne.lng,
        rec.ne.lat
      ),
      (err, value) => {
        delete values.rectangle;
        if (err) {
          sails.log.error(err);
          reject(err);
          return next(err);
        }

        const rows = value.rows;

        if (!rows.length) {
          resolve();
          return next();
        }

        values.geo = rows[0].geo;
        resolve();
        next();
      }
    );
  });
}

async function setPolygon(values, _next) {
  const poly = values.polygon || [];
  const next = _next || _.noop;

  if (values[Geo.getGeoPoint()]) {
    delete values[Geo.getGeoPoint()];
  }
  if (!poly.length) {
    delete values.polygon;
    return next();
  }

  let polys;

  if (_.isArray(poly)) {
    polys = poly;
  } else if (_.isString(poly)) {
    try {
      polys = stripPolyString(poly);
    } catch (e) {
      return next(e);
    }
  }

  try {
    const simplified =
      Geo.isSimple() && _.size(polys) > 40 ? Geo.simplicity(polys) : polys;
    const lineString = splitPoly(simplified);

    const query = escape(
      `SELECT ST_MakePolygon( ST_AddPoint(line.open_line, ST_StartPoint(line.open_line)) ) as "geo"
    FROM (
      SELECT ST_GeomFromText('LINESTRING(%s)') As open_line) As line;`,
      lineString
    );
    const results = await Model.queryAsync(query);
    const [row] = results.rows;
    if (!row) {
      return next();
    }
    values.geo = row.geo;
    next();
  } catch (e) {
    sails.log.error('Geo.setPolygon::Polygon Error', e.message);
    return next(e);
  }
}
