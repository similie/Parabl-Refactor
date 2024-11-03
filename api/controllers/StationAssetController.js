/**
 * StationAssetController
 *
 * @description :: Server-side actions for handling incoming requests.
 * @help        :: See https://sailsjs.com/docs/concepts/actions
 */
const { SqlUtils } = require('similie-api-services');

module.exports = {
  inventory: async function(req, res) {
    const params = req.params.all();
    if (!params.asset || !params.client) {
      return res.badRequest('Both and asset and client parameter are required');
    }

    const escape = SqlUtils.escapeUtil();
    const query = escape(
      `SELECT
      REPLACE
      (
        REPLACE (
          ARRAY_AGG ( "combined"."elements"::JSONB ->> 'name' ) FILTER ( WHERE "combined"."elements"::JSONB ->> 'param_purpose' = 'serial' AND boolin ( textout ( "combined"."elements"::JSONB ->> 'asset_parameter' ) ) = TRUE ) :: TEXT,
          '{',
          '' 
        ),
        '}',
        '' 
      ) AS "serial_param",
    combined.station,
    combined.owner,
    combined.node ,
    combined.schema ,
    combined.via_param ,
    combined.serial_node ,
    combined.serial_schema ,
    combined.station_type,
    combined.node_serial
  FROM
    (
    SELECT 
  
      jsonb_array_elements(COALESCE(NULLIF(ss."schema"::TEXT, '[]'), '[{"name": "__NO_SERIAL_IDENITFIED__", "param_purpose": "serial","asset_parameter": true}]')::JSONB ) as "elements",
      "partials".* 
      
    FROM
      (
      SELECT
        sa.asset AS "station",
        sa.station AS "owner",        
        ns.owned_by_node AS "node",
        ns.owned_by_schema AS "schema",
        ns."via_param",
        ns."possessed_by_node" AS "serial_node",
        ns."possessed_by_schema" AS serial_schema,
        s."station_type" AS "station_type",
        ns."id" AS "node_serial"
      FROM
        "stationasset" sa
        JOIN "nodeserial" ns ON ( ns."id" = sa."serial_bind" )
        JOIN "station" s ON ( s."id" = sa.asset ) 
      WHERE
        sa."asset" = %s 
      ) "partials"
    JOIN "stationschema" ss ON ( ss."id" = "partials"."station_type" ) 
     ) "combined"
      GROUP BY 2,3,4,5,6,7,8,9,10 `,
      params.asset
    );
    const results = await StationAsset.queryAsync(query);
    const result = results.rows.pop();
    if (!result) {
      return res.send(result);
    }

    const assetSchema = await Station.findOneById(params.asset);
    let serial = assetSchema.schema[result.serial_param];
    const helpers = Module._helpers.logistics();
    const serialSchema = await NodeSchema.findOneById(result.serial_schema);
    if (!serial) {
      const node = await Node.findOneById(result.serial_node, serialSchema);
      if (!node) {
        return res.badRequest({ error: 'Inventory is in an invalid state' });
      }
      const logParams = helpers.logParams(serialSchema.schema);
      serial = node[logParams('sku')];
    }

    const schema = await NodeSchema.findOneById(result.schema);
    if (!schema) {
      return res.badRequest({
        error: 'An inventory schema with this ID cannot be found'
      });
    }
    const logParams = helpers.logParams(schema.schema);
    const node = await Node.findOneById(result.node, schema);

    if (!node) {
      return res.badRequest({
        error: 'A node asset with this ID cannot be found'
      });
    }

    const items = [
      {
        client: User.getId(params.client),
        client_type: 'personnel',
        scan: node[logParams('sku')],
        temp_schema: result.schema,
        quantity: 1,
        serials: [
          {
            scan: serial,
            serial: {
              id: result.serial_schema,
              param_name: result.via_param,
              name: serialSchema.name,
              title: serialSchema.title,
              items: []
            }
          }
        ],
        direct: false
      }
    ];

    const payload = {
      owner: result.owner,
      items: items,
      asset: result.station,
      via_param: result.via_param,
      station_type: result.station_type,
      serial_node: result.serial_node
    };

    PointOfSale.redirectedTransactions(req, res, payload);
  },

  through: async function(req, res) {
    const params = req.params.all();
    if (!params.station || !params.identity) {
      return res.badRequest(
        'This request requires both a station and a station identity param'
      );
    }

    const ss = await StationSchema.findOneById(params.identity);
    const helpers = Module._helpers.logistics('asset_parameter');
    const serialParams = helpers.logParams(ss.schema);
    const escape = SqlUtils.escapeUtil();
    let search = ``;

    if (params.search) {
      const find = params.search;
      search = escape(
        `AND 
        ( "station_id" ILIKE'%%%s%%' 
        OR "local_name" ILIKE'%%%s%%' 
        OR "registration_id" ILIKE'%%%s%%' 
        OR "code" ILIKE'%%%s%%' 
        OR "schema"->>'%s' ILIKE '%%%s%%' )`,
        find,
        find,
        find,
        find,
        serialParams('serial'),
        find
      );
    }
    const query = escape(
      `SELECT
	s."id" as "id"
FROM
	"stationasset" sa
	JOIN "nodeserial" ns ON ( ns."id" = sa."serial_bind" )
	JOIN "station" s ON ( s."id" = sa."asset" ) 
WHERE
	sa."station" = %s
	AND s."station_type" = %s 
	%s
	ORDER BY s."updatedAt" DESC;`,
      params.station,
      params.identity,
      search
    );

    const results = await StationAsset.queryAsync(query);
    const sIds = _.pluck(results.rows, 'id');

    const stations = await Station.find()
      .where({ id: sIds })
      .populateAll();

    res.send(stations);
  },

  linkable: async function(req, res) {
    const params = req.params.all();
    const query = StationAsset.openLinkQuery(params);
    const results = await StationAsset.queryAsync(query);
    const links = results.rows;
    const serials = {};
    const cache = {
      schema: {},
      oSchema: {}
    };
    for (let i = 0; i < _.size(links); i++) {
      const link = links[i];
      const elements = {};
      const storage = [
        {
          cache: 'oSchema',
          param: 'owned_by_schema',
          node: 'owned_by_node',
          element: 'oNode'
        },
        {
          cache: 'schema',
          param: 'possessed_by_schema',
          node: 'possessed_by_node',
          element: 'node'
        }
      ];

      for (let j = 0; j < _.size(storage); j++) {
        const store = storage[j];
        cache[store.cache][link[store.param]] = cache[store.cache][
          link[store.param]
        ] || {
          schema: null,
          nodes: {}
        };

        elements[store.cache] =
          cache[store.cache][link[store.param]].schema ||
          (await NodeSchema.findOneById(link[store.param]));
        cache[store.cache][link[store.param]].schema = elements[store.cache];

        elements[store.element] =
          cache[store.cache][link[store.param]].nodes[link[store.node]] ||
          (await Node.findOneById(link[store.node], elements[store.cache]));
        cache[store.cache][link[store.param]].nodes[link[store.node]] =
          elements[store.element];
      }

      if (elements.node) {
        const helpers = Module._helpers.logistics();

        const oParam =
          _.where(elements.oSchema.schema, {
            name: link.via_param
          })[0] || {};
        const logParams = helpers.logParams(elements.schema.schema);
        const param =
          _.where(elements.schema.schema, {
            name: logParams('sku')
          })[0] || {};

        serials[link.via_param] = serials[link.via_param] || {
          items: [],
          via: oParam.label,
          item: link.id,
          node: NodeSchema.getId(elements.schema),
          owner_schema: NodeSchema.getId(elements.oSchema),
          owner_node: elements.oNode
        };

        serials[link.via_param].items.push({
          serial_bind: link.id,
          station: params.station,
          sku: elements.node[logParams('sku')],
          label: param.label,
          schema: NodeSchema.getId(elements.schema)
        });
      }
    }
    res.send(serials);
  }
};
