/**
 * Domain.js
 *
 * @description :: TODO: You might write a short summary of how this model works and what it represents here.
 * @docs        :: http://sailsjs.org/documentation/concepts/models-and-orm/models
 */
// @TODO: Refactor to CommonUtils in similie-api-services module
const Utils = require('../services/Utils');

const generate = require('project-name-generator');
const plural = require('pluralize');
const { SqlUtils, CommonUtils } = require('similie-api-services');
const SailsExtensions = require('../services/SailsExtensions');
const { Common } = require('../model-utilities/common/common');
const escape = SqlUtils.escapeUtil();

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    name: {
      unique: true,
      required: true,
      type: 'string'
    },

    urls: {
      type: 'array'
    },

    site: {
      model: 'site'
    },

    avatar: {
      type: 'json'
    },

    color: {
      type: 'string'
    },

    node_schema: {
      type: 'string'
    },

    tags: {
      collection: 'tag'
    },

    state_key: {
      model: 'statekeys'
    },

    bind_default: {
      type: 'boolean',
      defaultsTo: false
    },

    meta: {
      type: 'json'
    }
  },

  findDomainThroughUser: async function(user) {
    const uId = this.getId(user);
    if (!uId) {
      throw new Error('A valid user ID is required');
    }
    const fullUser = await User.findOneById(user);
    const dId = fullUser.last_domain;
    return dId;
  },

  findIdFromParamsOrRes: function(params, res) {
    const domain =
      (((res || {}).locals || {}).domain || {}).id ||
      (((res || {}).locals || {}).siteData || {}).domain ||
      params.domain ||
      null;

    return this.getId(domain);
  },

  mergeCommonDomainWithSelfDomain: async function(domainModel) {
    const ids = await this.commonDomainTags(domainModel);
    return _.union([this.getId(domainModel)], ids);
  },

  findBoundedDomainIds: async function() {
    const domains = await this.find().where({ bind_default: true });
    return domains.map(d => this.getId(d));
  },

  commonDomainTags: async function(domainModel) {
    Utils.itsRequired(domainModel)(Utils.setErrorCode(Const.code.BAD_REQUEST));
    const domainId = this.getId(domainModel);
    if (!domainId) {
      return null;
    }

    const domainComplete = await Domain.findOneById(domainId).populate('tags');
    const boundToDefault = domainComplete.bind_default;
    const send = boundToDefault ? [null] : [];
    const tags = domainComplete.tags.map(t => this.getId(t));
    if (!_.size(tags)) {
      return send;
    }

    const collection = {
      model: 'domain',
      key: 'tags',
      collection: 'tag'
    };
    const qCompoents = SailsExtensions.queryCollection(collection);
    const q = 'SELECT %s as id, %s as tag FROM %s where %s %s';
    const query = escape(
      q,
      qCompoents.model_row,
      qCompoents.collection_row,
      qCompoents.table,
      qCompoents.collection_row,
      SqlUtils.setInString(tags)
    );
    const common = await this.queryAsync(query);
    const commonDomains = common.rows;
    const ids = _.pluck(commonDomains, 'id');
    send.push(..._.unique(ids));
    return send;
  },

  populateMembersOnRoles: async function(domain = null, roles = []) {
    try {
      const dId = this.getId(domain);
      const domainModel = {
        id: dId || -1
      };
      const values = await this.getMembersOnRoles(domainModel, roles);
      return User.find().where({ id: values.map(v => this.getId(v)) });
    } catch {
      return [];
    }
  },

  getMembersOnRoles: async function(domainModel, roles) {
    CommonUtils.guardItsRequired(
      Utils.setErrorCode(Const.code.BAD_REQUEST),
      domainModel
    );
    let domain = Domain.getId(domainModel);
    if (domain === -1) {
      domain = 'NULL';
    }
    const q = escape(
      `SELECT * FROM "domainrole" WHERE domain ${
        domain === 'NULL' ? 'IS' : '='
      } %s AND role %s`,
      domain,
      SqlUtils.setInString(roles)
    );
    const dRs = await DomainRole.queryAsync(q);
    const rows = dRs.rows;
    return rows.map(r => r.user);
  },

  exceedsMemberCounts: async function(roleCriteria, where, skip) {
    const drCount = await DomainRole.domainRoleUserCount(roleCriteria);
    if (skip >= drCount) {
      return true;
    }
    const excessiveTotalCount = await this.exceedsTotalMemberCounts(
      roleCriteria,
      this.stripForDomain(where),
      skip
    );
    return excessiveTotalCount;
  },

  getProtectedMemberSort: function(req) {
    const sort = SailsExtensions.sort(req);
    _.each(User._attributes, (_, k) => {
      delete sort[k];
    });
    return sort;
  },

  stripForDomain: function(query = {}, members = []) {
    const startQuery = {};
    if (members.length) {
      startQuery.id = members;
    }

    Object.assign(startQuery, query);
    const params = ['last_domain', 'role'];
    for (let i = 0; i < params.length; i++) {
      delete startQuery[params[i]];
    }
    return startQuery;
  },

  applySelectedUserRoles: function(selectedUsers = [], domainRoles = []) {
    const roles = {};
    const users = [];
    for (let i = 0; i < selectedUsers.length; i++) {
      roles[selectedUsers[i].id] = selectedUsers[i];
    }

    for (let i = 0; i < domainRoles.length; i++) {
      if (domainRoles[i] && roles[domainRoles[i].user]) {
        roles[domainRoles[i].user].role = domainRoles[i].role;
        users.push(roles[domainRoles[i].user]);
      }
    }
    return users;
  },

  applyComplexPrefix: function(queryString = '', prefix = '') {
    const split = queryString.split('(');
    const joined = [];
    for (let i = 0; i < split.length; i++) {
      let peice = split[i];
      if (peice.startsWith('"') && prefix) {
        peice = `"${prefix}".${peice}`;
      }
      joined.push(peice);
    }
    return joined.join('(');
  },

  getMembersCountQuery: function(criteria, where) {
    const drWhere = SqlUtils.buildWhereString(criteria, true);
    const whereString = SqlUtils.buildWhereString(where, true);
    let queryBase = `SELECT
    count(*) 
  FROM
    "user" "u"
    JOIN "domainrole" "dr" ON ( "u"."id" = "dr"."user" ) 
    `;

    if (drWhere) {
      queryBase += `WHERE ${this.applyComplexPrefix(drWhere, 'dr')}`;
    }
    if (whereString) {
      queryBase += `${
        queryBase.includes('WHERE') ? ' AND ' : ' WHERE '
      } ${this.applyComplexPrefix(whereString, 'u')}`;
    }

    return queryBase;
  },

  getMembersCount: async function(criteria, where) {
    const query = this.getMembersCountQuery(criteria, where);
    const results = await this.queryAsync(query);
    const value = results.rows.pop() || {};
    return value.count || 0;
  },

  exceedsTotalMemberCounts: async function(criteria, where, skip = 0) {
    const count = await this.getMembersCount(criteria, where);
    return skip >= count;
  },

  pullUsersFromDomainRole: function(domainrole = []) {
    return domainrole.map(dr => dr.user);
  },

  setRoleCriteria: async function(userModel, domainModel, where = {}) {
    const domainId = this.getId(domainModel);
    const domainRole = await User.getRole(userModel, domainModel);
    const criteria = {};
    criteria.domain = domainId;
    if (!where.role) {
      criteria.role = {
        '<=': domainRole
      };
    } else {
      criteria.role = where.role;
      delete where.role;
    }
    return criteria;
  },

  findDomainWhereMemberIsOrIsNotQuery: function(user, not = false) {
    const escape = SqlUtils.escapeUtil();
    const uId = this.getId(user);

    let subWhere = '"mem"."user" = %s';
    if (not) {
      subWhere = '"mem"."user" IS NULL OR "mem"."user" <> %s';
    }
    const query = escape(
      `SELECT
    * 
  FROM
    "domain" "domain"
    LEFT JOIN (
    SELECT DISTINCT ON
      ( "dr"."domain" ) "dr"."domain",
      "dr"."user"
    FROM
      "user" "u"
      JOIN "domainrole" "dr" ON ( "u"."id" = "dr"."user" ) 
    WHERE
      "dr"."user" = %s
      AND "dr"."domain" IS NOT NULL 
    ORDER BY
      "dr"."domain" 
    ) "mem" ON ( "mem"."domain" = "domain"."id" )
     WHERE ${subWhere}`,
      uId,
      uId
    );

    return query;
  },

  buildDefaultSiteAvatar: function(site = {}) {
    const logos = site.logos || {};
    const avatar = {
      desktop: logos.bot_desktop,
      thumb: logos.bot_thumb,
      tiny: logos.bot_tiny
    };
    return avatar;
  },

  getDefaultDomain: async function() {
    const site = await Site.thisSiteAsync(null);
    const defaults = Domain.defaultElements();
    defaults.name = site.site_name;
    defaults.urls = [site.site_url];
    defaults.site = this.getId(site);
    defaults.color = `dark-grey`;
    defaults.node_schema = 'nodes';
    defaults.avatar = this.buildDefaultSiteAvatar(site);
    return defaults;
  },

  addDefaultDomainForMember: async function(user, domains = [], not = false) {
    const defaultDomain = await this.getDefaultDomain();
    const thisUser = CommonUtils.isThis(user).numericIsh
      ? await User.findOneById(this.getId(user))
      : user;
    // we have a user and we need it
    // we do not
    const requiresDomain =
      (thisUser.site_role && !not) || (!thisUser.site_role && not);
    if (!requiresDomain) {
      return;
    }
    domains.unshift(defaultDomain);
  },

  findDomainWhereMemberIsNot: async function(user) {
    const query = this.findDomainWhereMemberIsOrIsNotQuery(user, true);
    const results = await this.queryAsync(query);
    const domains = results.rows;
    await this.addDefaultDomainForMember(user, domains, true);
    return domains;
  },

  findDomainWhereMemberIs: async function(user) {
    const query = this.findDomainWhereMemberIsOrIsNotQuery(user);
    const results = await this.queryAsync(query);
    const domains = results.rows;
    await this.addDefaultDomainForMember(user, domains);
    return domains;
  },

  appendWhereToDomainRole: function(where = {}) {
    const hold = {};
    for (const key in where) {
      if (key === 'last_domain' || key === 'domain') {
        hold[`d+^${'domain'}^`] = where[key];
      } else {
        hold[`u+^${key}^`] = where[key];
      }
    }
    return hold;
  },

  bindSortToUser: function(sort = '') {
    const orderBySplit = sort.split(',');
    const orderByJoin = [];
    for (let i = 0; i < orderBySplit.length; i++) {
      const value = orderBySplit[i];
      const indexOf = value.indexOf('"');
      const preString = value.substring(0, indexOf);
      const postString = value.substring(indexOf, value.length);
      const peice = `${preString} "u".${postString.trim()} `;
      orderByJoin.push(peice);
    }
    return orderByJoin.join(',');
  },

  bindOrToUser: function(or = '') {
    const orSplit = or.split('OR');
    const orJoin = [];
    for (let i = 0; i < orSplit.length; i++) {
      const split = orSplit[i];
      orJoin.push(`${i > 0 ? ' ' : ''}"u".${split.trim()} `);
    }
    return orJoin.join('OR');
  },

  mergeOrJoinedToQuery: function(...queries) {
    return queries
      .filter(f => f)
      .map(q => '(' + q + ')')
      .join(' AND ');
  },

  stripAwayInAndNot: function(where) {
    let buildQuery = '';
    let i = 0;
    for (const key in where) {
      const isArray = Array.isArray(where[key]);

      if (
        typeof where[key] !== 'object' ||
        !(
          Common.objectify(where[key], '!') ||
          Common.objectify(where[key], 'not') ||
          isArray
        )
      ) {
        continue;
      }
      const param = `"u"."${key}"`;
      const values = isArray ? where[key] : where[key]['!'] || where[key].not;
      delete where[key];
      const equals = isArray ? ' = ' : ' != ';

      buildQuery += Array.isArray(values)
        ? escape(
            `${param} ${isArray ? ' ' : ' NOT '} %s`,
            SqlUtils.setInString(values)
          )
        : escape(`${param} ${equals} %s`, values);
      if (i > 0) {
        buildQuery += ' AND ';
      }
      i++;
    }
    return buildQuery;
  },

  appendDomainRolesToQuery: function(queryString, user = {}, strict = false) {
    if (strict || !user.site_role || user.site_role < Roles.DOMAIN_ADMIN) {
      return queryString;
    }
    const breakQueryString = queryString.split(' AND ');
    if (!breakQueryString.length) {
      return queryString;
    }
    const escape = SqlUtils.escapeUtil();
    for (let i = 0; i < breakQueryString.length; i++) {
      const qString = breakQueryString[i];
      if (!qString.match(/\("d"."domain"\) = /)) {
        continue;
      }
      breakQueryString[i] = escape(
        `(${qString}OR "u"."site_role" <= %s)`,
        user.site_role
      );
    }

    return breakQueryString.join(' AND ');
  },

  buildDomainRoleWhereQuery: function(where = {}, user, strict = false) {
    let orQuery = '';
    if (where.or && where.or.length) {
      const or = [...where.or];
      delete where.or;
      orQuery = this.bindOrToUser(SqlUtils.generateOrQueryString(or));
    }
    const notQuery = this.stripAwayInAndNot(where);
    const appendedWhere = this.appendWhereToDomainRole(where);
    let strictQuery = SqlUtils.buildWhereString(appendedWhere, true);
    strictQuery = strictQuery.replaceAll('+', '.');
    strictQuery = strictQuery.replaceAll('^', '"');
    return this.mergeOrJoinedToQuery(
      this.appendDomainRolesToQuery(strictQuery, user, strict),
      orQuery,
      notQuery
    );
  },

  buildDomainFindQueryPreLimit: function(req, count = false) {
    const where = SailsExtensions.params(req) || {};
    const params = req.params.all();
    const escape = SqlUtils.escapeUtil();
    let query = count
      ? `SELECT COUNT("u"."id") "count" FROM "user" "u" JOIN "domainrole" "d" ON ("u"."id" = "d"."user") `
      : `SELECT "u"."id" as "user", "d"."domain", "d"."role" FROM "user" "u" JOIN "domainrole" "d" ON ("u"."id" = "d"."user") `;
    const whereQ = this.buildDomainRoleWhereQuery(
      where,
      req.user,
      params.strict
    );
    if (whereQ) {
      query += escape(`WHERE %s`, whereQ);
    }
    return query;
  },

  getMemberCountForController: async function(req) {
    const query = this.buildDomainFindQueryPreLimit(req, true);
    const result = await this.queryAsync(query);
    const [row] = result.rows;
    return row.count || 0;
  },

  buildMemDomainFindQuery: function(req) {
    let query = this.buildDomainFindQueryPreLimit(req);
    const escape = SqlUtils.escapeUtil();
    const sort = SailsExtensions.sort(req);

    if (sort) {
      query += this.bindSortToUser(SqlUtils.buildSort(sort));
    }

    const limit = SailsExtensions.limit(req);

    if (limit) {
      query += escape(' LIMIT %s ', limit);
    }

    const skip = SailsExtensions.skip(req);
    if (skip) {
      query += escape(' OFFSET %s ', skip);
    }
    return query;
  },

  getMembersThroughJoin: async function(req) {
    const query = this.buildMemDomainFindQuery(req);
    const results = await this.queryAsync(query);
    return results.rows;
  },

  buildMembersOverride: async function(req) {
    const domainMergedUsers = await this.getMembersThroughJoin(req);
    if (!domainMergedUsers.length) {
      return [];
    }
    const domainUsers = await User.find()
      .where({ id: domainMergedUsers.map(u => this.getId(u.user)) })
      .populateAll();
    return this.applySelectedUserRoles(domainUsers, domainMergedUsers);
  },

  getMembers: async function(userModel, domainModel, req) {
    CommonUtils.guardItsRequired(
      CommonUtils.getErrorForCode(Const.code.UNKNOWN_ERROR),
      userModel,
      domainModel,
      req
    );

    try {
      return this.buildMembersOverride(req);
    } catch (e) {
      console.error(e);
    }
    // fallback to old and buggy options
    const where = SailsExtensions.params(req) || {};
    const criteria = await this.setRoleCriteria(userModel, domainModel, where);
    const limit = SailsExtensions.limit(req);
    const skip = SailsExtensions.skip(req);
    const exceedsCount = await this.exceedsMemberCounts(criteria, where, skip);

    if (exceedsCount) {
      return [];
    }
    const dRs = await DomainRole.find()
      .where(criteria)
      .limit(limit)
      .skip(skip)
      .sort(this.getProtectedMemberSort(req));

    const members = this.pullUsersFromDomainRole(dRs);
    if (!members.length) {
      return [];
    }

    const userQuery = this.stripForDomain(where, members);
    const selected = await User.find()
      .where(userQuery)
      .sort(SailsExtensions.sort(req))
      .populateAll();

    return this.applySelectedUserRoles(selected, dRs);
  },
  /*
   * rejectNotUniqueUrl
   *
   * We can use this function to find a domain by its url
   * @param {Object} values - the domain
   * @return {Promise} resolved true when reject, false when pass
   */
  rejectNotUniqueUrl: async function(values) {
    const value = this.filterParsedUrlsStrings(values);
    const urls = value.urls || [];
    try {
      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        const domain = await this.findDomainWithURL(url);
        if (domain == null) {
          continue;
        }
        throw new Error('errors.DUPLICATE_DOMAIN_HOST_NOT_ALLOWED');
      }
    } catch (e) {
      return true;
    }
    return false;
  },

  findHostValuesForRows: function(url, rows = []) {
    const urlValue = {};
    for (let i = 0; i < rows.length; i++) {
      const row = this.filterParsedUrlsStrings(rows[i]);
      const urls = row.urls || [];
      for (let j = 0; j < urls.length; j++) {
        const host = urls[j];
        if (host !== url || urlValue[host]) {
          continue;
        }
        urlValue[host] = this.getId(row);
      }
    }
    return urlValue;
  },

  pullDomainForHostFromUrlObject: function(rows = [], urlValue = {}) {
    const hostValues = Object.values(urlValue);
    if (hostValues.length > 1) {
      throw new Error('errors.URL_MATCHES_MULTIPLE_DOMAINS');
    }
    const domainId = this.getId(hostValues.pop());
    const domainRows = rows.filter(row => this.getId(row) === domainId);
    return domainRows.pop();
  },

  filterParsedUrlsStrings: function(domain = {}) {
    return CommonUtils.params.parseObjectValue(domain, 'urls');
  },
  /*
   * findDomainWithURL
   *
   * We can use this function to find a domain by its url
   * @param {String} url - the url search
   * @return {Promise} reolved when value, rejected when not
   */
  findDomainWithURL: async function(url) {
    const escape = SqlUtils.escapeUtil();
    const query = escape(
      'SELECT * FROM "domain" WHERE "urls" ILIKE \'%%%s%%\';',
      url
    );
    const results = await this.queryAsync(query);
    const foundRows = results.rows || [];
    const rows = foundRows.filter(row => {
      let urls = row.urls || [];
      if (!Array.isArray(urls)) {
        urls = JSON.parse(urls);
      }
      return urls.indexOf(url) !== -1;
    });
    const rowLength = rows.length;
    if (!rowLength) {
      return null;
    } else if (rowLength === 1) {
      return this.filterParsedUrlsStrings(rows.pop());
    }
    const urlValue = this.findHostValuesForRows(url, rows);
    const domainRow = this.pullDomainForHostFromUrlObject(rows, urlValue);
    return this.filterParsedUrlsStrings(domainRow);
  },

  costcodeName: domain => {
    domain = domain || Domain.defaultElements();
    return `${domain.name}/${domain.id}`;
  },

  defaultElements: () => {
    return {
      ...{
        id: -1,
        name: 'default'
      }
    };
  },

  afterCreate: async (values, next) => {
    const siteId = values.site;
    /*
     * We will cross polinate the site with newly created domain
     */
    await StateKeys.registerState(values, 'domain');

    Site.findOneById(siteId)
      .then(function(site) {
        site.domain = values.id;
        site.save(next);
      })
      .catch(next);
  },

  generateDomainSchemaName: function() {
    const name = generate({
      number: true
    }).raw;
    return name.join('_');
  },

  generateDomainSchema: async function() {
    const generatedName = this.generateDomainSchemaName();
    /*
     * We create a new schema for the domains nodes
     */
    //
    const connection = (sails.config.models || {}).connection;
    const creds = sails.config.connections[connection];
    const ormHelper = SqlUtils.knex(sails.models.knex).credentials(creds);
    return new Promise((resolve, reject) => {
      ormHelper.createSchemaFail(generatedName, err => {
        if (err) {
          sails.log.error(err);
          return reject(err);
        }
        resolve(generatedName);
      });
    });
  },

  beforeCreate: async function(values, next) {
    const isNotUnique = await Domain.rejectNotUniqueUrl(values);
    if (isNotUnique) {
      return next('errors.FAILED_UNIQUE_URL');
    }
    try {
      const defaultSite = Site.rawDefaultSite();
      const site = await Site.create(defaultSite);
      values.site = site.id;
      values.node_schema = await this.generateDomainSchema();
      next();
    } catch (e) {
      return next(e.message);
    }
  },

  setDomain: async (req, res, modelAttrs, domain, next) => {
    const params = req.params.all();
    const user = req.user;
    /*
     * If we have a delete, get, or update and an id
     * param, then we are looking for a specific element.
     * however, we need to make sure that the element is still in the same
     * domain, se wait
     */
    // if we have an id param, we've
    // areay made sure they have access to the domain
    // to the param
    const m = sails.models[modelAttrs.model];

    res.locals.domain = domain;
    if (params.id) {
      if (params.id === 'undefined' || params.id === 'null') {
        return Utils.sendErrorCode(
          res,
          Utils.setErrorCode(Const.code.BAD_REQUEST)
        );
      }

      if (User.is(user, Roles.DOMAIN_ADMIN)) {
        return next();
      }

      // we have to populate all due to the collections
      let model;
      try {
        model = await m.findOneById(params.id).populateAll();
      } catch (e) {
        sails.log.error(e);
      }

      // @todo:: ensure this is logically correct
      if (!model) {
        return next();
      }
      const ids = [];
      try {
        /*
         * IF there is a request for a specific id, then we make sure
         * the user has access to that id element
         */
        for (let i = 0; i < _.size(modelAttrs.query); i++) {
          const q = modelAttrs.query[i];
          // this is the most likely case, just one domain parameter for the model
          // should pull null or undefined if we have the null domain
          if (model && q.type === 'model') {
            ids.push(
              await User.hasDomainMembership(user, model[q.key] || Const.NULL)
            );
          } else if (model && q.type === 'collection') {
            /*
             * Unlikely used, but
             * We'll check them all just in case
             */
            for (let i = 0; i < _.size(model[q.key]); i++) {
              const cDomain = model[q.key][i] || Const.NULL;
              ids.push(await User.hasDomainMembership(user, cDomain));
            }
          } else {
            ids.push(false);
          }
        }
      } catch (e) {
        sails.log.error('DOMAIN.setDomain::ERRROR ' + modelAttrs.model, e);
        return res.negotiate(e);
      }
      /*
       * If there are all the ids we end it
       */
      if (!_.some(ids)) {
        return res.forbidden('errors.NO_DOMAIN_ACCESS_AVAILABLE');
      }
      // let the user pass
      return next();
    }
    Domain.setQueryString(req, domain, modelAttrs);
    Utils.forceRequestParameters(req, modelAttrs);
    // now we go and let the domain
    // be automatically selected
    next();
  },

  setQueryString: function(req, domain, modelAttrs) {
    let querystring = 'body';
    if (
      CommonUtils.isThis(req.method).oneOf('get', 'delete', 'GET', 'DELETE')
    ) {
      querystring = _.size(req.body) ? 'body' : 'query';
    }
    req[querystring] = req[querystring] || {};
    const dId = (
      domain || {
        id: null
      }
    ).id;
    _.each(modelAttrs.query, function(q) {
      q.value = dId;
    });
  },

  bypassDomain: function(req) {
    if (req.query && !req.body) {
      if (_.isString(req.query)) {
        const query = JSON.parse(req.query);
        delete query.domian;
        if (_.isString(query.where)) {
          query.where = JSON.parse(query.where);
        }
        if (query.where) {
          delete query.where.domain;
        }
        req.query = JSON.stringify(query);
      } else if (_.isString(req.query.where)) {
        const query = JSON.parse(req.query.where);
        if (query) {
          delete query.domain;
          req.query.where = query;
        }
      } else {
        delete req.query.domain;
      }
    } else if (req.body) {
      if (_.isString(req.body)) {
        const query = JSON.parse(req.body);
        delete query.domain;
        if (query.where) {
          delete query.where.domain;
        }
        req.body = JSON.stringify(query);
      } else {
        delete req.body.domain;
        if (req.body.where) {
          delete req.body.where.domain;
        }
      }
    }
  },

  searchTransience: async function(req, res, next) {
    const params = req.params.all();
    const user = req.user;
    const method = req.method;
    // when testing you'll need to mock this model
    // and so we need to find a way to add and remove
    // this for each test
    const m = Model.findModelNameFromReq(req);
    const model = sails.models[m];
    if (!Utils.leastOne(method, 'get', 'GET') || !model) {
      return next();
    }

    const config = res.locals.siteData;
    // if its not there or blocked move on
    if (
      !config.permits[m] ||
      !config.permits[m].transient ||
      config.permits[m].transient === -1
    ) {
      return next();
    }

    // if the user has not a transience role
    if (!User.is(user, config.permits[m].transient)) {
      return next();
    }

    const attrs = model._attributes;
    if (!CommonUtils.containsValue(attrs, 'domain', 'model')) {
      return next();
    }
    // this covers even the null doamin which has no transience
    if (Domain.domainHasNoValue(m, attrs, params)) {
      return next();
    }

    Utils.forceRequestParameters(
      req,
      Domain.orAttributes(m, attrs, params, req)
    );

    next();
  },

  setDomainAttrs: function(params, domain, m) {
    const attrs = m._attributes;
    if (
      CommonUtils.containsValue(attrs, 'domain', 'model') &&
      !m.notDomainQueryable
    ) {
      const modelAttrs = Domain.getDomainParams(m, attrs);
      _.each(modelAttrs.query, m => {
        params[m.key] = Domain.getId(domain);
      });
    }
  },

  cutQueryParam: function(attr, req) {
    if (_.size(req.body)) {
      if (_.isString(req.body)) {
        const where = JSON.parse(req.body);
        delete where[attr];
        req.body = where; // JSON.stringify(where);
      }

      delete req.body[attr];
      if (req.body.where) {
        if (_.isString(req.body.where)) {
          const where = JSON.parse(req.body.where);
          delete where[attr];
          req.body.where = where; // JSON.stringify(where);
        }

        delete req.body.where[attr];
      }
    }

    if (_.size(req.query)) {
      if (_.isString(req.query)) {
        const where = JSON.parse(req.query);
        delete where[attr];
        req.query = where; // JSON.stringify(where);
      }

      delete req.query[attr];
      if (req.query.where) {
        if (_.isString(req.query.where)) {
          const where = JSON.parse(req.query.where);
          delete where[attr];
          req.query.where = where; // JSON.stringify(where);
        }

        delete req.query.where[attr];
      }
    }
  },

  orAttributes: function(model, attrs, params, req) {
    const attributes = Domain.getDomainParams(model, attrs);
    const a = {};

    if (_.isString(params)) {
      params = JSON.parse(params);
    }

    if (!_.isString(params) && _.isString(params.where)) {
      params.where = JSON.parse(params.where);
    }

    _.each(attributes.query, m => {
      if (params[m.key] || (params.where || {})[m.key]) {
        a[m.key] = params[m.key] || (params.where || {})[m.key];
      }
    });

    _.each(a, function(value, attr) {
      if (_.isObject(value)) {
        return;
      }

      const or = [
        {
          [attr]: null
        },
        {
          [attr]: value
        }
      ];
      const index = Utils.indexOf(attributes.query, 'key', attr);
      const copy = attributes.query[index];
      attributes.query.splice(index, 1);
      Domain.cutQueryParam(attr, req);
      const altered = {
        value: or,
        key: 'or',
        type: copy.type
      };
      attributes.query.push(altered);
    });
    return attributes;
  },

  domainHasNoValue: function(model, attrs, params) {
    const attributes = Domain.getDomainParams(model, attrs);
    let none = true;
    // if we aren't even looking for a domain, return
    attributes.query = attributes.query || [];
    for (let i = 0; i < attributes.query.length; i++) {
      const query = attributes.query[i];
      if (
        params[query.key] !== undefined ||
        (params.where || {})[query.key] !== undefined
      ) {
        none = false;
        break;
      }
    }
    return none;
  },

  getDomainParams: function(model, attrs) {
    const modelAttrs = {
      model: model,
      query: []
    };
    _.each(attrs, (value, key) => {
      // basically if we are working with
      // a model or collection

      if (value.model && value.model === 'domain') {
        // if ((value.model || value.collection)
        //  && (value.model == 'domain' || value.collection == 'domain')) {
        modelAttrs.query.push({
          key: key,
          type: value.model ? 'model' : 'collection'
        });
      }
    });

    return modelAttrs;
  },

  domainSelect: async function(req, res, next) {
    const params = req.params.all();
    const user = req.user || res.locals.newAccount;
    const host = req.headers.host;
    const device = res.locals.device;
    const contentDomain = req.headers['content-domain'];
    // when testing you'll need to mock this model
    // and so we need to find a way to add and remove
    // this for each test
    const model =
      req.headers.model ||
      plural(params.__model || '', 1) ||
      plural(params.model || '', 1) ||
      req.options.model ||
      req.options.controller;
    /*
     * First we check to see if the model has a domain
     */
    /*
     * Check to see if the model we are even
     * quering has a model. If not, go
     */
    const m = sails.models[model];
    // if we are going to a route with no model
    // just go
    // basically I want to make sure to put the domain into locals
    let format = params;

    if (_.isString(format)) {
      format = JSON.parse(format);
    }

    if (_.isString(format.where)) {
      format.where = JSON.parse(format.where);
    }

    const formattedDomain = parseInt(
      format.domain || (format.where || {}).domain
    );

    res.locals.domain =
      contentDomain ||
      (device || {}).domain ||
      (user || {}).last_domain ||
      Const.NULL;
    if (!m || params.domain === true || formattedDomain === -2) {
      if (formattedDomain === -2) {
        // major security implications, we should verify this is applicable
        Domain.bypassDomain(req);
      }

      return next();
    }
    // if we have a domain parameter the we push forward
    // no point in looking elsewhere. We know our domain
    if (CommonUtils.hasKeysShallow(params, 'domain') && user) {
      const domainsQuery = CommonUtils.deepValues(params, 'domain');
      const query = {
        or: []
      };

      // @TODO:: we have to deal with the NULL domain too
      _.each(domainsQuery, val => {
        if (val && val !== 'undefined' && val !== 'null') {
          query.or.push({
            id: _.isObject(val) ? val.id : val
          });
        }
      });

      let d;

      if (_.size(query.or)) {
        try {
          d = await Domain.find().where(query);
        } catch (e) {
          return Utils.sendErrorCode(res, Utils.setErrorCode(Const.NULL));
        }
      }

      /*
       What are the conditions we keep this user out of the system from seeing this domain
       */
      const hasAccess = [];
      for (let i = 0; i < _.size(d); i++) {
        const access = await User.hasDomainMembership(user, d[i]);
        hasAccess.push(access);
      }
      /*
       * Basically if we don't have access to all, we reject
       * they should only have access to the domain their are looing for
       */
      if (!_.every(hasAccess)) {
        return res.forbidden('errors.NO_DOMAIN_ACCESS_AVAILABLE');
      }

      if (user.last_domain) {
        res.locals.domain = user.last_domain;
      }

      return next();
    }

    /*
     * We run this because we need to know
     * what attributes we are going to query
     */
    const attrs = m._attributes;
    /*
     * We look to see if the element has the domain value under a model or collection
     * parameter
     */
    if (!CommonUtils.containsValue(attrs, 'domain', 'model')) {
      return next();
    }

    const modelAttrs = Domain.getDomainParams(model, attrs);

    let urlDomain = null;
    const userDomain = this.getId((user || {}).last_domain);

    if (host) {
      urlDomain = await Domain.findDomainWithURL(host);
    }
    /*
     * Basically checki if this is a non user
     */
    if (!user && urlDomain) {
      return Domain.setDomain(req, res, modelAttrs, urlDomain, next);
    } else if (!user && !urlDomain) {
      return next();
    }
    /*
     * need to consider
     */
    if (
      user &&
      urlDomain &&
      // && userDomain.last_domain == urlDomain.id
      (await User.hasDomainMembership(user, urlDomain))
    ) {
      // it the domains don't match, change to that domain
      if (userDomain !== this.getId(urlDomain)) {
        await User.changeDomain(user, urlDomain);
      }
      // now set it
      return Domain.setDomain(req, res, modelAttrs, urlDomain, next);
    }
    /*
     * If we have the fallback domain, we go to the domain
     * that has not domain url
     */
    if (userDomain && (await User.hasDomainMembership(user, userDomain))) {
      const lastDomain = await Domain.findOneById(userDomain);
      return Domain.setDomain(req, res, modelAttrs, lastDomain, next);
      // otherwise, we have a null domain user
      // if we have a user who has no access to that site, but has access to null, take them there
    } else if (
      userDomain &&
      (await User.hasDomainMembership(user, Const.NULL))
    ) {
      User.changeDomain(user, Const.NULL);
      return Domain.setDomain(req, res, modelAttrs, Const.NULL, next);
      // otherwise, we have a null domain user
    } else if (
      !userDomain &&
      (await User.hasDomainMembership(user, Const.NULL))
    ) {
      return Domain.setDomain(req, res, modelAttrs, Const.NULL, next);
    }
    /*
     * If we get here we are getting desperate. Let's find a backup
     */

    let backupDomain;
    for (let i = 0; i < _.size(user.domains); i++) {
      if (User.getId(userDomain) !== Domain.getId(user.domains[i])) {
        const hasAccess = await User.hasDomainMembership(user, user.domains[i]);
        if (hasAccess) {
          backupDomain = user.domains[i];
        }
      }
    }

    if (backupDomain) {
      return Domain.setDomain(req, res, modelAttrs, backupDomain, next);
    } else {
      return res.forbidden('errors.NO_DOMAIN_ACCESS_AVAILABLE');
    }

    /*
     *
     * First we look for the user: req.user
     * If the user has the last_domain set,
     * we pull this domain. We will then compare this
     * with the url. If the URL is not the same and
     * the user is a member of the domain that it matches.
     * then we send the user to this domain.

     * If there is no user, then we look strickly at the url
     * if this url doesn't exist, then we pull the primary url
     *
     * We set the domain in res.locals and we save the user profile
     * with the domain.
     *
     * If it is a query for a model and the model has a domain attribute.
     * the we put in req.body (post, put), and req.query or req.query.where
     * to place the domain attribute. This allows us to keep the
     * front end from having to change
     *
     * Pull domain role model and populate the user's role.
     *
     */
  },
  /*
  *
  * First we look for the user: req.user
  * If the user has the last_domain set,
  * we pull this domain. We will then compare this
  * with the url. If the URL is not the same and
  * the user is a member of the domain that it matches.
  * then we send the user to this domain.

  * If there is no user, then we look strictly at the url
  * if this url doesn't exist, then we pull the primary url
  *
  * We set the domain in res.locals and we save the user profile
  * with the domain.
  *
  * If it is a query for a model and the model has a domain attribute.
  * the we put in req.body (post, put), and req.query or req.query.where
  * to place the domain attribute. This allows us to keep the
  * front end from having to change
  *
  * Pull domain role model and populate the user's role.
  *
  */

  getDomainAttributes: async (user, baseUrl) => {
    /*
     First we look for the user: req.user
     If the user has the last_domain set,
     we pull this domain. We will then compare this
     with the url. If the URL is not the same and
     the user is a member of the domain that it matches.
     then we send the user to this domain.
     */
    if (user.last_domain !== null && user.last_domain === baseUrl) {
      return user.last_domain;
    }
    /*
     * Last domain will actually be an id to an object
     * or the domain object itself. But lets. make this
     * work for now to pass some tests
     */
    const domain = await Domain.findDomainWithURL(baseUrl);
    // reconsider this
    if (!domain) {
      return baseUrl;
    }

    // TODO: consider the Use Case where the last_domain is a domain the user no longer has access to
    if (user.last_domain !== null && user.last_domain !== baseUrl) {
      // does the user have membership to the baseUrl domain?
      // If not then use the last_domain
    }

    // If there is no user, then we look strictly at the url
    // if this url doesn't exist, then we pull the primary url
    if (user === null || user.last_domain === null) {
      if (domain === null) {
        return 'primary.similie.org';
      } else {
        // the domain url exists in the DB so return the baseUrl provided
        return baseUrl;
      }
    }
  }
};
