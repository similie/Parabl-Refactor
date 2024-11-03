/**
 * EventBroadcast.js
 *
 * @description :: A model definition represents a database table/collection.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

const {
  EwsActionUtils
} = require('../model-utilities/early-warning/ews/ews-action-utils');
const { Common } = require('../model-utilities/common/common');
const { SqlUtils, TimeUtils } = require('similie-api-services');
module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    warning: {
      model: 'ews'
    },

    event: {
      type: 'integer'
    },

    parent: {
      type: 'integer',
      defaultsTo: null
    },

    target: {
      type: 'integer'
    },

    schema: {
      type: 'integer'
    },
    /**
     * This is an event that has been sent.
     * An event that is not confirmed has NOT been broadcasted, but
     * a threshold has been crossed so we are tracking these attempts
     */
    confirmed: {
      type: 'boolean',
      defaultsTo: false
    },

    event_category: {
      type: 'text',
      in: ['earlywarning', 'eventcluster'],
      defaultsTo: 'earlywarning'
    },

    domain: {
      model: 'domain'
    },

    values: {
      type: 'json'
    },

    dependencies: {
      type: 'array',
      defaultsTo: []
    },

    burned: {
      type: 'boolean',
      defaultsTo: false
    },

    confirmed_active: {
      type: 'boolean',
      defaultsTo: false
    },

    confirmed_by: {
      model: 'user'
    },

    confirmation_text: {
      type: 'text'
    },

    confirmed_time: {
      type: 'datetime'
    },

    meta: {
      type: 'json'
    }
  },

  broadcastQuery: function(
    category = EwsActionUtils.EWEventCategory.EarlyWarning,
    confirmed = true,
    count = false
  ) {
    const escape = SqlUtils.escapeUtil();
    return escape(
      `SELECT
    ${
      count
        ? 'count("eb".*) as total'
        : `row_to_json ( "ew".* ) AS "earlywarning" ,
      row_to_json ( "_ews".* ) AS "ews" ,
      "eb".*`
    }
    FROM
      "eventbroadcast" "eb"
      JOIN  (
        SELECT _ew.*, array_to_json(array_agg( row_to_json("_t".* ))) as "tags"
         FROM "%s" "_ew" 
          LEFT JOIN "%s" "et" ON ( "_ew"."id" = "et"."%s" ) 
          LEFT JOIN "tag" "_t" ON ( "_t"."id" = "et"."tag" )
          GROUP BY "_ew"."id" 
      )  "ew" ON ( "eb"."event" = "ew"."id" )
      JOIN "ews" "_ews" ON ( "eb"."warning" = "_ews"."id" ) 
      WHERE "eb"."event_category" = '%s'
      ${
        confirmed !== 'any'
          ? `AND "eb"."confirmed" IS ${confirmed ? 'TRUE' : 'FALSE'}`
          : ''
      }`,
      category,
      EwsActionUtils.getTagModel(category),
      category,
      category
    );
  },

  deleteParamValues: async function(values = [], params = {}) {
    values.forEach(val => {
      delete params[val];
    });
  },

  dateRangeQuery: function(params = {}) {
    const escape = SqlUtils.escapeUtil();
    let dateQuery = '';
    if (params.from && params.to) {
      dateQuery = escape(
        ` AND "eb"."createdAt"::TIMESTAMP WITH TIME ZONE BETWEEN '%s'::TIMESTAMP WITH TIME ZONE AND '%s'::TIMESTAMP WITH TIME ZONE`,
        TimeUtils.isoFormattedDate(params.from),
        TimeUtils.isoFormattedDate(params.to)
      );
      this.deleteParamValues(['from', 'to'], params);
    } else if (params.from) {
      dateQuery = escape(
        ` AND "eb"."createdAt"::TIMESTAMP WITH TIME ZONE >= '%s'::TIMESTAMP WITH TIME ZONE`,
        TimeUtils.isoFormattedDate(params.from)
      );
      this.deleteParamValues(['from'], params);
    } else if (params.to) {
      dateQuery = escape(
        ` AND "eb"."createdAt"::TIMESTAMP WITH TIME ZONE <= '%s'::TIMESTAMP WITH TIME ZONE`,
        TimeUtils.isoFormattedDate(params.to)
      );
      this.deleteParamValues(['to'], params);
    }
    return dateQuery;
  },

  tagsQuery: function(params = {}) {
    if (!Array.isArray(params.tags)) {
      return '';
    }
    const ids = params.tags.map(t => {
      return `{"id": ${t}}`;
    });
    this.deleteParamValues(['tags'], params);
    return `AND "ew"."tags"::TEXT::JSONB @> '[${ids.join(',')}]'`;
  },

  isConfirmed: function(params = {}) {
    const confirmed =
      typeof params.confirmed === 'undefined' ? true : params.confirmed;
    this.deleteParamValues(['confirmed'], params);
    return confirmed;
  },

  nameQuery: function(params = {}) {
    if (!params.name) {
      return '';
    }
    const escape = SqlUtils.escapeUtil();
    const query = escape(`AND "ew"."name" ILIKE '%%%s%'`, params.name);
    this.deleteParamValues(['name'], params);
    return query;
  },

  warningId: function(params = {}) {
    if (!params.warning) {
      return '';
    }
    const escape = SqlUtils.escapeUtil();
    const query = escape(`AND "_ews"."id" = %s`, params.warning);
    this.deleteParamValues(['warning'], params);
    return query;
  },

  activeConfirmation: function(params = {}) {
    if (typeof params.confirmed_active === 'undefined') {
      return '';
    }
    const escape = SqlUtils.escapeUtil();
    const query = escape(
      `AND "eb"."confirmed_active" = %s`,
      params.confirmed_active
    );
    this.deleteParamValues(['confirmed_active'], params);
    return query;
  },

  stationsQuery: function(params = {}) {
    if (!params.station || !Array.isArray(params.station)) {
      return '';
    }
    const escape = SqlUtils.escapeUtil();
    const query = escape(
      `AND "ew"."station" %s`,
      SqlUtils.setInString(params.station)
    );
    this.deleteParamValues(['station'], params);
    return query;
  },

  countAndValuesQuery: function(
    params = {},
    category = EwsActionUtils.EWEventCategory.EarlyWarning
  ) {
    const limitQuery = Common.applySqlLimiters(params);
    this.deleteParamValues(['limit', 'skip', 'sort'], params);
    const sendParams = { ...(params.where || params) };
    const confirmed = this.isConfirmed(sendParams);
    const nameQuery = this.nameQuery(sendParams);
    const dateQuery = this.dateRangeQuery(sendParams);
    const rQuery = this.broadcastQuery(category, confirmed);
    const cQuery = this.broadcastQuery(category, confirmed, true);
    const tagsQuery = this.tagsQuery(sendParams);
    const warningQuery = this.warningId(sendParams);
    const stationQuery = this.stationsQuery(sendParams);
    const confirmationQuery = this.activeConfirmation(sendParams);
    const whereString = SqlUtils.buildWhereString(sendParams, true);
    const prefixed = Domain.applyComplexPrefix(whereString, 'ew');

    const resultsQuery = `${rQuery} AND ${prefixed || ''} ${tagsQuery ||
      ''} ${dateQuery || ''} ${nameQuery || ''} ${warningQuery ||
      ''}  ${stationQuery || ''} ${confirmationQuery || ''} ${limitQuery}`;

    const countQuery = `${cQuery} AND ${prefixed || ''} ${tagsQuery ||
      ''} ${dateQuery || ''} ${nameQuery || ''} ${warningQuery ||
      ''} ${stationQuery || ''} ${confirmationQuery || ''}`;
    return {
      resultsQuery,
      countQuery
    };
  },

  filterTags: function(broadcasts = []) {
    broadcasts.forEach(broadcast => {
      const tags = broadcast.earlywarning.tags || [];
      broadcast.earlywarning.tags = tags.filter(tag => {
        return tag;
      });
    });
  },

  jsonIfyDependencies: function(broadcasts = []) {
    broadcasts.forEach(broadcast => {
      const dependencies = broadcast.dependencies || [];
      broadcast.dependencies =
        typeof dependencies === 'string'
          ? JSON.parse(dependencies)
          : dependencies;

      const values = broadcast.values || {};
      broadcast.values =
        typeof values === 'string' ? JSON.parse(values) : values;

      const actions = broadcast.ews.actions || [];
      broadcast.ews.actions =
        typeof actions === 'string' ? JSON.parse(actions) : actions;

      const publicDescription = broadcast.earlywarning.public_description || {};
      broadcast.earlywarning.public_description =
        typeof publicDescription === 'string'
          ? JSON.parse(publicDescription)
          : publicDescription;
    });
  },

  getBroadcastByQuery: async function(
    params = {},
    category = EwsActionUtils.EWEventCategory.EarlyWarning
  ) {
    const query = this.countAndValuesQuery(params, category);
    // console.log('I AM THIS QUERY', query.resultsQuery);
    const results = await this.queryAsync(query.resultsQuery);
    const broadcasts = results.rows;
    this.filterTags(broadcasts);
    this.jsonIfyDependencies(broadcasts);

    const resultsCount = await this.queryAsync(query.countQuery);
    const [row] = resultsCount.rows;
    const count = +row.total || 0;
    return {
      broadcasts,
      count
    };
  },

  /**
   * @name getTarget
   * @description gets the target for a given node
   * @param {eventbroadcast} eventbroadcast
   * @returns {node|station}
   */
  getTarget: async function(eventbroadcast = {}) {
    if (!this.getId(eventbroadcast)) {
      throw new Error('This eventbroadcast is not fully defined');
    }
    const target = this.getId(eventbroadcast.target);
    if (!target) {
      throw new Error('A target definition has not been defined');
    }

    const category =
      eventbroadcast.event_category ||
      EwsActionUtils.EWEventCategory.EarlyWarning;
    if (category === EwsActionUtils.EWEventCategory.EventCluster) {
      return Station.findOneByID(target);
    }
    try {
      const ew = await EarlyWarning.findOneById(
        this.getId(eventbroadcast.event)
      ).populate('node');
      const nodeschema = ew.node;
      return Node.findOneById(target, nodeschema);
    } catch (e) {
      sails.log.error('EventBroadcast.getTarget::error', e);
      return null;
    }
  },

  /**
   * @name sendBroadcast
   * @description we can use this to send to
   * these events to the frontend for active event management
   * @param {eventbroadcast} created
   */
  sendBroadcast: function(created) {
    try {
      this.publishCreate(this.getId(created), created);
    } catch (e) {
      sails.log.error('EventBroadcast.sendBroadcast::error', e);
    }
  },

  applyValues: function(earlywarning, node = {}) {
    const values = {};
    const params = earlywarning.parameters || {};
    for (const key in params) {
      const value = node[key];
      values[key] = {
        ...params[key],
        value
      };
    }
    return values;
  },
  /**
   * @name generate
   * @description Simple function for generating a list of all events we have encountered
   * @param {ews} ews
   * @param {earlywarning} earlywarning
   * @param {node} node
   * @returns {eventbroadcast}
   */
  generate: async function(ews, earlywarning, node = {}) {
    const confirmed = ews.perform || false;
    const warning = this.getId(ews);
    const event = this.getId(earlywarning);
    const event_category = ews.event_category;
    const target = ews.target;
    const schema = this.getId(earlywarning.node);
    // const nodeId = this.getId(node);
    const domain = this.getId(ews.domain);
    const meta = earlywarning.actions || {};
    const values = this.applyValues(earlywarning, node);
    const parent = earlywarning.parent || null;
    const created = await this.create({
      confirmed,
      warning,
      event,
      event_category,
      target,
      parent,
      domain,
      values,
      meta,
      schema
      // node: nodeId
    });

    this.sendBroadcast(created);
    return created;
  }
};
