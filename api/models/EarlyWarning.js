/**
 * EarlyWarning.js
 *
 * @description :: TODO: You might write a short summary of how this model works and what it represents here.
 * @docs        :: http://sailsjs.org/documentation/concepts/models-and-orm/models
 */
const { Common } = require('../model-utilities/common/common');
const {
  EwsActionUtils
} = require('../model-utilities/early-warning/ews/ews-action-utils');
const { SqlUtils } = require('similie-api-services');
module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    name: {
      type: 'string'
    },

    station: {
      type: 'integer'
    },

    node: {
      // required: true,
      model: 'nodeschema'
    },

    owner: {
      model: 'user'
    },

    device: {
      model: 'device'
    },

    parameters: {
      type: 'json'
    },

    active: {
      type: 'boolean',
      defaultsTo: true
    },

    color: {
      type: 'string',
      maxLength: '50'
    },

    forgive_count: {
      type: 'integer',
      min: 0
    },

    timeout: {
      type: 'integer',
      min: 0
    },

    forgive_timeout: {
      type: 'integer'
    },

    actions: {
      type: 'json'
    },

    parent: {
      type: 'integer'
    },

    fragment_id: {
      type: 'uuid'
    },

    automatic: {
      type: 'boolean',
      defaultsTo: false
    },

    passive: {
      type: 'boolean',
      defaultsTo: false
    },

    public: {
      type: 'boolean',
      defaultsTo: false
    },

    public_id: {
      type: 'string'
    },

    public_description: {
      type: 'json'
    },

    last_triggered: {
      type: 'datetime'
    },

    template_base: {
      type: 'integer'
    },

    domain: {
      model: 'domain'
    },

    tags: {
      collection: 'tag',
      through: 'e_tag'
    },

    meta: {
      type: 'json'
    }
  },

  cloneForAuto: function(ew) {
    const clone = _.cloneDeep(ew);
    delete clone.id;
    delete clone.updatedAt;
    delete clone.createdAt;

    clone.node = Model.getId(ew.node);
    clone.owner = Model.getId(ew.owner);
    clone.device = Model.getId(ew.device);
    clone.station = Model.getId(ew.station);
    clone.workorder = Model.getId(ew.workorder);

    clone.forgive_count = 0;
    clone.timeout = 0;
    clone.forgive_timeout = 0;
    const mActions = _.clone(clone.actions.machine);
    clone.actions = {
      machine_break: mActions
    };

    clone.parameters = mActions.until;
    clone.automatic = true;
    return clone;
  },

  buildTagQuery: function(query = {}, count = false) {
    const copiedQuery = _.cloneDeep(query);
    const copiedTags = _.cloneDeep(copiedQuery.tags);
    delete copiedQuery.tags;
    const ids = Common.objectify(copiedQuery.id, '!');
    let idQuery = '';
    if (ids) {
      delete copiedQuery.id;
      idQuery = `AND "ew"."id" NOT ${SqlUtils.setInString(ids)}`;
    }
    const distinctSelect = `DISTINCT("ew"."id")`;
    const selectTag = count
      ? `COUNT(${distinctSelect}) as "total"`
      : `${distinctSelect} as "id"`;

    const escape = SqlUtils.escapeUtil();
    const whereString = SqlUtils.buildWhereString(copiedQuery, true);
    const tagsQuery = `"et"."tag" ${SqlUtils.setInString(copiedTags)}`;
    const prefixed = Domain.applyComplexPrefix(whereString, 'ew');
    const whereQuery = `WHERE ${prefixed || ''} ${idQuery} AND ${tagsQuery ||
      ''}`;
    const queryString = escape(
      `SELECT
       %s
  FROM
    "earlywarning" "ew"
    JOIN "e_tag" "et" ON ( "ew"."id" = "et"."earlywarning" ) %s`,
      selectTag,
      whereQuery
    );
    return queryString;
  },

  queryByTags: async function(req) {
    const query = SailsExtensions.params(req);
    if (!query.tags || !query.tags.length) {
      return [];
    }

    let queryString = this.buildTagQuery(query);
    const countString = this.buildTagQuery(query, true);
    const escape = SqlUtils.escapeUtil();
    const skip = SailsExtensions.skip(req);
    const limit = SailsExtensions.limit(req);
    if (limit) {
      queryString += escape(' LIMIT %s', limit);
    }

    if (skip) {
      queryString += escape(' OFFSET %s', limit);
    }

    const countResults = await this.queryAsync(countString);
    const [countObject] = countResults.rows;
    const count = countObject.total;
    const results = await this.queryAsync(queryString);
    const eventIds = results.rows.map(e => this.getId(e));
    const events = await this.find()
      .where({ id: eventIds })
      .populateAll();
    return {
      events,
      count
    };
  },

  bindStorage: function(node = {}, storage = []) {
    return {
      node: node,
      ewStorage: storage
    };
  },

  grind: async function(node, schema, domain, parent, earlywarnings = []) {
    const scheme = schema.schema;
    const eUtils = new EwsActionUtils();
    const stored = await eUtils.buildIssues(node, earlywarnings, scheme);
    if (!stored.length) {
      return this.bindStorage(node);
    }
    node.alarm = true;
    const updated = await Node.save(node, schema);
    if (!Site.isInTestMode() && !parent) {
      Jobs.processEarlyWarnings.add({
        ews: stored,
        node: updated,
        domain: domain
      });
    }
    return this.bindStorage(updated, stored);
  },

  setProcessQuery: function(node, locals, parent) {
    const device = locals.device;
    const schema = locals.schema;
    const station = locals.station || node.station;
    const query = {
      station: station,
      node: NodeSchema.getId(schema),
      active: true,
      device: Device.getId(device),
      parent: EarlyWarning.getId(parent)
    };

    return query;
  },

  process: async function(node, locals, parent) {
    const schema = locals.schema;
    const domain = locals.domain;
    const query = this.setProcessQuery(node, locals, parent);
    const ewS = await EarlyWarning.find().where(query);
    if (!ewS.length) {
      return this.bindStorage(node);
    }
    return this.grind(node, schema, domain, parent, ewS);
  },

  clearRegistrationValues: function(values = {}) {
    values.public_id = null;
    if (!values.meta) {
      return;
    }
    const meta = values.meta || {};
    delete meta.registrationUrl;
    values.meta = meta;
  },

  generatePublicId: function(values = {}) {
    if (!values.public && values.public_id) {
      return this.clearRegistrationValues(values);
    } else if (!values.public || values.public_id) {
      return;
    }
    values.public_id = Tracker.buildRandomId('short');
  },

  beforeCreate: function(values, next) {
    if (!values.color) {
      values.color = Utils.color();
    }

    if (values.parent && !values.fragment_id) {
      values.fragment_id = Tracker.buildRandomId('uuid');
    }

    this.generatePublicId(values);

    next();
  },

  beforeUpdate: function(values, next) {
    this.generatePublicId(values);
    next();
  },

  registrationPath: function() {
    return process.env.EW_REGISTRATION_PATH || `events/register`;
  },

  buildRegistrationUrl: function(
    config = {},
    publicIds = [],
    userSchemaIds = []
  ) {
    return `${Site.buildUrl(
      config
    )}/${this.registrationPath()}?ew=${publicIds.join(',')}&domain=${
      config.domain ? this.getId(config.domain) : 'default'
    }&schemas=${userSchemaIds.join(',')}`;
  }
};
