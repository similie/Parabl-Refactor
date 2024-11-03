/**
 * StationSchema.js
 *
 * @description :: TODO: You might write a short summary of how this model works and what it represents here.
 * @docs        :: http://sailsjs.org/documentation/concepts/models-and-orm/models
 */
const _lo = require('lodash');
const { SqlUtils } = require('similie-api-services');
const SailsExtensions = require('../services/SailsExtensions');

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    name: {
      type: 'string',
      required: true
    },

    color: {
      type: 'string'
    },

    icon: {
      type: 'string',
      maxLength: '255'
    },

    margin: {
      type: 'integer',
      defaultsTo: 0,
      max: 20,
      min: -20
    },

    schema: {
      type: 'array'
    },

    theme: {
      type: 'boolean',
      defaultsTo: false
    },

    theme_parent: {
      model: 'stationschema'
    },

    station_url: {
      type: 'string',
      required: true
      // unique: true
    },

    station_id: {
      model: 'stationidtracker',
      required: true
    },

    nodes: {
      collection: 'nodeschema'
    },

    weight: {
      type: 'integer',
      min: 0
    },
    is_service_station: {
      type: 'boolean',
      defaultsTo: false
    },
    service_nodes: {
      collection: 'nodeschema',
      through: 'station_s_nodes'
    },

    workorder_templates: {
      collection: 'workorder'
    },

    active: {
      type: 'boolean',
      defaultsTo: true
    },

    invisible: {
      type: 'boolean',
      defaultsTo: false
    },

    modules: {
      collection: 'module'
    },

    public_site: {
      type: 'boolean',
      defaultsTo: false
    },

    domain: {
      model: 'domain'
    },

    dashboard: {
      type: 'json'
    },

    is_asset: {
      type: 'boolean',
      defaultsTo: false
    },

    is_transport: {
      type: 'boolean',
      defaultsTo: false
    },

    is_currier: {
      type: 'boolean',
      defaultsTo: false
    },

    has_event_boundary: {
      type: 'boolean',
      defaultsTo: false
    },

    adds_competency: {
      type: 'boolean',
      defaultsTo: false
    },

    no_nav: {
      type: 'boolean',
      defaultsTo: false
    },

    geo_type: {
      type: 'string',
      maxLength: 20,
      in: ['point', 'polygon', 'polyline'],
      defaultsTo: 'point'
    },

    meta: {
      type: 'json'
    },

    restrict_logistics: {
      type: 'boolean',
      defaultsTo: false
    },

    is_international: {
      type: 'boolean',
      defaultsTo: false
    },

    not_assignable: {
      type: 'boolean',
      defaultsTo: false
    }
  },

  getAssetSchemas: function(domain = null) {
    return this.find().where({ is_asset: true, domain: domain });
  },

  nodeSchemasCollectionObject: function() {
    const attrs = this._attributes;
    const collections = SailsExtensions.populateCollections(
      {
        nodes: true
      },
      attrs
    );
    const collection = collections.pop();
    return SailsExtensions.queryCollection(collection, 'stationschema');
  },

  getSchemaWithNodes: async function(nodeSchema, noAsset = false) {
    const table = this.nodeSchemasCollectionObject();
    const escape = SqlUtils.escapeUtil();
    const query = escape(
      `SELECT "nss"."${table.model_row}" FROM "${table.table}" "nss"
      JOIN "stationschema" "ss" ON ("ss"."id" = "nss"."${table.model_row}")
      WHERE "${table.collection_row}" = %s AND "${table.model_row}" IS NOT NULL
        ${noAsset ? ' AND "ss"."is_asset" = false' : ''}
      `,
      NodeSchema.getId(nodeSchema)
    );
    const r = await Model.queryAsync(query);
    const nodes = _.pluck(r.rows, table.model_row);
    return nodes;
  },

  getNodes: async function(stationSchema) {
    const table = this.nodeSchemasCollectionObject();
    const escape = SqlUtils.escapeUtil();
    const query = escape(
      `SELECT ${table.collection_row}
      FROM ${table.table}
      WHERE ${table.model_row} = %s`,
      StationSchema.getId(stationSchema)
    );
    const r = await Model.queryAsync(query);
    const nodes = _.pluck(r.rows, table.collection_row);
    return nodes;
  },

  getFamilyTreeQuery: function(stations) {
    const table = this.nodeSchemasCollectionObject();
    const escape = SqlUtils.escapeUtil();
    const query = escape(
      `SELECT
    "ns"."id" 
  FROM
    (
    SELECT DISTINCT
      "sn"."${table.collection_row}" AS "id" 
    FROM
      "station" "s"
      JOIN "${table.table}" "sn" ON ( "s"."station_type" = "sn"."${table.model_row}" ) 
    WHERE
      "s"."id" %s
    ) AS "nodes"
    JOIN "nodeschema" "ns" ON ( "nodes"."id" = "ns"."id" ) 
  WHERE
    "ns"."is_inventory";`,
      SqlUtils.setInString(stations.map(s => this.getId(s)))
    );
    return query;
  },

  runFamilyTreeQuery: async function(stations) {
    const query = this.getFamilyTreeQuery(stations);
    const results = await this.queryAsync(query);
    return results.rows.map(i => i.id);
  },

  familyTreeIventoryNodes: async function(stationsIds = []) {
    const inventoryItemIds = await this.runFamilyTreeQuery(stationsIds);
    return NodeSchema.find()
      .where({ id: inventoryItemIds })
      .sort({ name: 'ASC' })
      .populateAll();
  },

  hasNode: async function(stationSchema, node) {
    const nodes = await this.getNodes(stationSchema);
    const nId = Model.getId(node);
    return _.indexOf(nodes, parseInt(nId)) !== -1;
  },

  autoGenerateSchema: async function(themeCache, domain) {
    const stations = [];
    const stationSchema = [];

    for (let i = 0; i < _.size(Object.keys(themeCache)); i++) {
      const themeId = Object.keys(themeCache)[i];
      const cache = themeCache[themeId];
      const originalDomain = cache.original.domain;
      if (Domain.getId(originalDomain) === Domain.getId(domain)) {
        continue;
      }

      const station = themeCache[themeId].parent;
      const clone = _lo.cloneDeep(cache.clone);
      const nodes = clone.nodes;
      clone.nodes = [];

      for (let j = 0; j < _.size(nodes); j++) {
        clone.nodes.push(nodes[j]);
      }

      const schema = await StationSchema.create(clone);
      stationSchema.push(StationSchema.getId(schema));

      if (station) {
        station.station_type = StationSchema.getId(schema);
        const created = await Station.create(station);
        stations.push(created);
      }
    }
    return {
      stations: stations,
      stationSchema: stationSchema
    };
  }
};
