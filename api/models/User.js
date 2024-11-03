const uuid = require('uuid');
const validator = require('validator');
const Q = require('q');
const _lo = require('lodash');
const crypto = require('crypto');
const SailsExtensions = require('../services/SailsExtensions');
const { TimeUtils, SqlUtils, Pdf } = require('similie-api-services');
const CacheStore = require('../services/CacheStore');
const tz = TimeUtils.constants.timeZone;
const now_ = TimeUtils.constants.now_;
const TimePeriod = TimeUtils.constants.ENUMS.timePeriods;
const escape = SqlUtils.escapeUtil();
const Formats = TimeUtils.constants.formats;

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    username: {
      type: 'string',
      unique: true
    },

    domains: {
      collection: 'domain'
    },

    last_domain: {
      model: 'domain'
    },

    email: {
      type: 'email',
      unique: true
      // required: true
    },

    phone: {
      type: 'string',
      maxLength: 25
    },

    secondary_email: 'array',
    secondary_phone: 'array',

    passports: {
      collection: 'Passport',
      via: 'user'
    },

    dob: {
      type: 'datetime'
    },

    title: {
      type: 'string'
    },

    first_name: {
      type: 'string'
    },

    middle_name: {
      type: 'string'
    },

    last_name: {
      type: 'string'
    },

    role: {
      type: 'integer',
      min: 0,
      max: Roles.SIMILIE_ADMIN,
      defaultsTo: Roles.SURVEYOR,
      required: true
    },

    site_role: {
      type: 'integer',
      min: 0,
      max: Roles.SIMILIE_ADMIN
    },

    preferred_language: {
      type: 'string',
      maxLength: 4
    },

    online: {
      type: 'boolean',
      defaultsTo: false
    },

    active: {
      type: 'boolean',
      defaultsTo: false
    },

    archive: {
      type: 'boolean',
      defaultsTo: false
    },

    requestor: {
      model: 'user'
    },

    session_key: {
      type: 'string'
    },

    api_session: {
      type: 'string'
    },

    api_key: {
      type: 'string',
      unique: true
    },

    avatar: {
      type: 'json'
    },

    rank_badge: {
      model: 'badge'
    },

    organization: {
      model: 'organization'
    },

    sounds: {
      type: 'boolean',
      defaultsTo: true
    },

    tags: {
      collection: 'tag'
    },

    employee_id: {
      type: 'string'
    },

    state_key: {
      model: 'statekeys'
    },

    // user_type: {
    //   model: "userschema"
    // },
    force_reset: { type: 'boolean', defaultsTo: false },
    schema: {
      model: 'nodeschema'
    },

    primary_district: {
      type: 'string'
    },

    meta: {
      type: 'json'
    },

    personnel: {
      type: 'boolean',
      defaultsTo: false
    },

    user_access_disabled: {
      type: 'boolean',
      defaultsTo: false
    },

    enlistement_date: {
      type: 'datetime'
    },

    primary_station_route: {
      type: 'boolean',
      defaultsTo: false
    },

    specialty: {
      type: 'integer'
    },
    trade: {
      type: 'integer'
    },

    style_mode: {
      type: 'string'
    },

    ldap_enabled: {
      type: 'boolean',
      defaultsTo: false
    },

    location: {
      type: 'json'
    },

    offline: async function() {
      this.online = false;
      await User.update(this.id, { online: false });
      return this.toObject();
    },

    safeUser: function() {
      const user = this.toObject();
      return {
        id: user.id,
        full_name: User.fullName(user),
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        phone: user.phone,
        tags: user.tags || [],
        primary_district: user.primary_district,
        avatar: user.avatar
      };
    },

    language: function(siteConfig) {
      const user = this.toObject();
      const lang =
        user.preferred_language ||
        (siteConfig || {}).default_language ||
        Translates.fallbackLanguage;
      return lang;
    },

    socketMessage: async function(message, params) {
      const user = this.toObject();
      User.socketMessage(user, message, params);
    },

    torchSession: async function(session_key) {
      const user = this.toObject();
      const session = await UserSession.destroy({
        user: User.getId(user),
        session_key: session_key
      });
      return session;
    },

    lightSession: async function(session_key, session_type) {
      const user = this.toObject();
      const session = {
        user: User.getId(user),
        session_key: session_key,
        session_type: session_type || 'local'
      };
      const update = await UserSession.findOrCreate(session);
      update.last_touched = TimeUtils.isoFormattedDate(now_); // [sg] Time.getMoment().format();
      update.save(err => {
        if (err) {
          sails.log.error(err);
        }
      });

      return update;
    },

    easterEgg: function() {
      if (!_.size(this.tags)) {
        return;
      }
      let eggHunt;
      _.each(this.tags, t => {
        if (t.meta && t.meta.easter_egg) {
          const frequency = t.meta.frequency ? parseInt(t.meta.frequency) : 10;
          t.meta.frequency = frequency;
          t.meta.random = _.random(1, frequency);
          if (t.meta.random === _.random(1, frequency)) {
            eggHunt = t.meta.easter_egg;
          }
        }
      });

      if (eggHunt) {
        this.easter_egg = eggHunt;
      }
    },

    buildUsername: async function() {
      const user = this.toObject();
      const split = user.email.split('@');
      let base = split[0];
      if (base.length < User.USERNAME_MIN_LENGTH) {
        const extra = User.USERNAME_MIN_LENGTH - base.length;
        const stuff = await Tracker.buildRandomId('short', extra);
        base += stuff;
      }
      let found = false;
      let i = 0;
      const RESTRICT = 20;
      let send = '';
      while (!found && i < RESTRICT) {
        let check = base;
        if (i > 0) {
          check = base + '-' + i;
        }
        const user = await User.findOne().where({ username: check });
        if (!user) {
          found = true;
          send = check;
        }
        i++;
      }

      if (!found) {
        throw new Error(`Could not find a username in ${RESTRICT} passes`);
      }

      return send;
    },

    contentDomainUser: async function(req, res) {
      const headers = req.headers || {};
      const sendFallback = () => {
        return req.user || this.similieUser(res.locals.domain);
      };
      if (!headers['Content-User']) {
        return sendFallback();
      }
      const userValue = +headers['Content-User'];
      if (Number.isNaN(userValue)) {
        return sendFallback();
      }
      const user = await this.findOneById(userValue);
      if (!user) {
        return sendFallback();
      }
      return user;
    },

    hasAccess: function(params, access) {
      const self = this.toJSON();
      return User.hasAccess(self, params, access);
    },

    toJSON: function() {
      const user = this.toObject();
      delete user.requestor;
      delete user.passports;
      delete user.session_key;
      // delete user.socket_id;
      delete user.api_session;
      delete user.api_key;
      return user;
    },

    activateEmail: function(req, res, cb) {
      const user = this;
      const expire = 7;
      const dateNow = TimeUtils.date(now_).tz(tz);
      Invite.create({
        email: user.email,
        user: user.id,
        requestor: User.getId(user.requestor),
        target: user.id,
        target_model: Invite.actions().action.CREATE_ACCOUNT,
        expire: dateNow.plus(expire, TimePeriod.days).toISO,
        // [sg] moment().add(expire, 'days').format(),
        meta: {
          tags: ['account activate request']
        }
      }).exec((err, invite) => {
        const config = res.locals.siteData || {};
        const name = User.fullName(user);
        const host = User.inviteURL(config, invite);
        Jobs.sendEmail.add({
          to: {
            address: user.email,
            name: name
          },
          locals: {
            inviteURL: host,
            name: name,
            site_name: config.site_name,
            days: expire + ' days',
            host: Utils.pullHost(config)
          },
          default_language: user.preferred_language || config.default_language,
          template: 'invite',
          variables: Email.variables.invite.key,
          tags: ['user requested', 'password reset']
        });
        (cb || _.noop)(err);
      });
    },
    /*
     * Sends password reset for users
     */

    /*
     * Sends email for newly created users
     */
    sendUserInviteEmail: function(data, cb) {
      const user = this.toObject();

      let name = 'New User';

      if (user.first_name && user.last_name) {
        name = user.first_name + ' ' + user.last_name;
      }
      Email.create(
        {
          to: {
            address: user.email,
            name: name
          },
          subject: sails.__(
            'ACTIVATE_ACCOUT_EMAIL_TITLE',
            sails.config.Const.name
          ),
          tags: ['user account', 'create account'],
          template: 'invite'
        },
        (err, email) => {
          if (err) {
            return cb(new Error(err));
          }

          email.setDefaults();
          email.send(
            {
              user: user,
              invite: data.invite,
              host: data.host,
              __: sails.__
            },
            (err, res, msg) => {
              if (err) {
                sails.log.error(err);
              }
              cb(err, res, msg);
            }
          );
        }
      );
    }
  },

  USERNAME_MIN_LENGTH: 8,
  notDomainQueryable: true,
  hasPeople: true,
  personasQuery: function(domain, limit = 20) {
    const domainId = this.getId(domain);
    const escape = SqlUtils.escapeUtil();
    return escape(
      `SELECT
    "u".ID,
    "u"."avatar" :: JSON,
    "u"."schema",
    "u"."first_name",
    "u"."last_name",
    "ns"."meta" ->> 'oracle' :: TEXT AS oracles 
  FROM
    "nodeschema" "ns"
    JOIN "user" "u" ON ( "ns"."id" = "u"."schema" ) 
  WHERE
    "ns"."user_assigned" = TRUE 
    AND "ns"."meta" -> 'oracle' IS NOT NULL
    AND "ns"."domain" %s ORDER BY "id" ASC LIMIT %s;`,
      domainId ? escape('=  %s', domainId) : 'IS NULL',
      limit
    );
  },
  parseAvatarToBase64: async function(avatar) {
    if (!avatar || !avatar.thumb) {
      return null;
    }
    const thumb = avatar.thumb;
    if (thumb.startsWith('data:image/')) {
      return thumb;
    }
    const split = thumb.split('/');
    // we want to know that it comes from our api
    if (split.indexOf('sysfiles') === -1) {
      return null;
    }
    const id = +split[split.length - 1];
    if (Number.isNaN(id)) {
      return null;
    }
    return SysFile.convertLocalFileToBase64(id);
  },
  /**
   * @name applyFullNames
   * @description apply full names to user models
   * @param {User[]} users
   */
  applyFullNames: function(users = []) {
    for (const user of users) {
      user.name = this.fullName(user);
    }
  },
  /**
   * @name applyBase64Avatars
   * @description apply base64 avatars to user models
   * @param {User[]} users
   */
  applyBase64Avatars: async function(users = []) {
    for (const user of users) {
      const base64 = await this.parseAvatarToBase64(user.avatar);
      if (!base64) {
        continue;
      }
      user.avatar64 = base64;
    }
  },
  /**
   * @name personas
   * @description pulls persona users
   * @param {Domain} domain
   * @returns {User[]}
   */
  personas: async function(domain) {
    const query = this.personasQuery(domain);
    const results = await this.queryAsync(query);
    const rows = results.rows;
    await this.applyBase64Avatars(rows);
    this.applyFullNames(rows);
    return results.rows;
  },
  getAnonymousUser: function(req, role = null) {
    const survey = NodeSurvey.validSurvey(req);
    const _role = role || (survey ? Roles.SURVEYOR : Roles.ANONYMOUS);
    const user = req.session.holduser || {
      first_name: 'not',
      last_name: 'authenticated',
      role: _role,
      id: -1,
      session_key: uuid.v4()
    };
    return user;
  },

  assignSessionKey: async function(req) {
    if (req.signedCookies && req.signedCookies[sails.config.session.key]) {
      return req.signedCookies[sails.config.session.key];
    } else if (req.sessionID) {
      return req.sessionID;
    }

    const session = await UserSession.findSession(req);
    if (session) {
      return session.session_key;
    }
    return Tracker.buildRandomId('uuid');
  },
  getPeopleSchemaName: async function(user) {
    if (!user.schema) {
      return 'user';
    }
    if (_.isObject(user.schema)) {
      return user.schema.name || '____EMPTY____';
    }
    const sId = User.getId(user.schema);
    const schema = await NodeSchema.findOneById(sId);
    return (schema || {}).name || '____EMPTY____';
  },
  buildWhereNotInQuery: function(params) {
    const query = Object.keys(params)
      .map(key => {
        const data = params[key]['!'];
        const value = Array.isArray(data) ? data.join(',') : data;

        if (!value) return '';

        return `AND ${key} NOT IN(${value})`;
      })
      .filter(value => value)
      .join(' ');

    return query;
  },
  buildPeopleQuery: function(params) {
    const schemas = [];
    let hasNull = false;
    _.each(params.schema, s => {
      if (s === null) {
        hasNull = true;
      } else {
        schemas.push(s);
      }
    });
    let queryString = '';
    if (!_.size(schemas) && !hasNull) {
      return queryString;
    }
    // setInString
    delete params.schema;
    if (hasNull) {
      queryString += `("schema" IS NULL `;
    }

    if (_.size(schemas)) {
      queryString += `${hasNull ? 'OR ' : '('}"schema" ${SqlUtils.setInString(
        schemas
      )}) `;
    } else if (hasNull) {
      queryString += ') ';
    }

    if ((hasNull || _.size(schemas)) && _.size(params.or)) {
      queryString += `AND (${SqlUtils.generateOrQueryString(params.or)})`;
      delete params.or;
    }

    if ((hasNull || _.size(schemas)) && _.size(params)) {
      queryString += this.buildWhereNotInQuery(params);
    }

    return queryString;
  },

  byTags: async function(tags = [], archived = false) {
    if (!_.size(tags)) {
      throw new Error('Error: Tags required');
    }
    const collection = [
      {
        model: 'user',
        key: 'tags',
        collection: 'tag',
        ids: tags.map(t => this.getId(t)).filter(t => !!t)
      }
    ];
    const taggedIds = await SailsExtensions.queryCollections(collection);
    return await User.find({
      id: taggedIds.user,
      active: !archived,
      archive: archived
    }).populateAll();
  },

  userKey: function(user, language, type = 'user') {
    return {
      type: type,
      id: user.id,
      name: User.fullName(user),
      email: _.isArray(user.email) ? Contact.getPrimary(user) : user.email,
      phone: _.isArray(user.phone)
        ? Contact.getPrimary(user, 'phone')
        : user.phone,
      language:
        user.preferred_language ||
        language ||
        Translates.fallbackLanguage ||
        'en'
    };
  },

  applyUserKeys: async function(users = [], domain = null) {
    const language = await Site.siteLanguage(domain);
    const send = [];
    for (const user of users) {
      const userAsKey = this.userKey(user, language);
      send.push(userAsKey);
    }
    return send;
  },

  mergeUserTypes: function(users) {
    const byType = _lo.groupBy(users, 'type');
    const map = {};
    const send = [];
    for (const type in byType) {
      const users = byType[type];
      map[type] = {};
      for (let i = 0; i < _.size(users); i++) {
        const user = users[i];
        const uId = User.getId(user);
        if (!map[type][uId]) {
          send.push(user);
          map[type][uId] = true;
        }
      }
    }
    return send;
  },

  /**
   * We are attempting to split up a namefield search
   * Therefore, if someone types, Adam Smith or Adam Thomas Smith
   * We search the names accordingly
   *
   * @param {string} search
   * @returns array
   */
  splitNameForSearch: function(search) {
    const split = search.split(' ');
    const send = [];

    if (split.length === 1) {
      const fill = [];
      _.times(3, () => fill.push(search));
      send.push(...fill);
    } else if (split.length === 2) {
      send.push(...[split[0], split[1], search]);
    } else if (split.length >= 3) {
      const last_name = split[split.length - 1];
      let middle = '';
      // we dont want the first or last index, just the stuff
      // in between
      for (let i = 1; i < split.length - 1; i++) {
        const namePart = split[i];
        middle += namePart + ' ';
      }
      send.push(...[split[0], last_name, middle.trim()]);
    }
    return send;
  },

  getNameSplitIndex: function(key) {
    const split_indices = {
      first_name: 0,
      last_name: 1,
      middle_name: 2
    };
    return split_indices[key];
  },

  searchNameNameKeys: function() {
    const keys = [
      'first_name',
      'last_name',
      'middle_name',
      'email',
      'username',
      'employee_id',
      'title'
    ];

    return keys;
  },

  textSearchQuery: function(search, append) {
    const keys = this.searchNameNameKeys();
    const send = { or: [] };
    const split = this.splitNameForSearch(search);

    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const key = `${append ? `${append}` + '.' : ''}${k}`;
      const nIndex = this.getNameSplitIndex(k);
      if (nIndex == null) {
        send.or.push({ [key]: { contains: search } });
      } else {
        send.or.push({ [key]: { contains: split[nIndex] } });
      }
    }

    return send;
  },

  formatSearchString: function(search) {
    const lower = (search || '').toLowerCase();
    return lower.replaceAll(' ', '_');
  },

  getUserQueryForTextSearch: function(domain) {
    const escape = SqlUtils.escapeUtil();
    return `SELECT * FROM (SELECT
      concat (
        regexp_replace ( LOWER ( first_name ), ' ', '_', 'g' ),
        '_',
        regexp_replace ( LOWER ( middle_name ), ' ', '_', 'g' ),
        '_',
        regexp_replace ( LOWER ( last_name ), ' ', '_', 'g' ) 
      ) AS "_full_name", 
      concat (
        regexp_replace ( LOWER ( first_name ), ' ', '_', 'g' ),
        '_',
        regexp_replace ( LOWER ( last_name ), ' ', '_', 'g' ) 
      ) AS "_fist_last_name", 
    "us".* 
    FROM
      "public"."user" "us"${
        domain
          ? escape(
              ` JOIN "domainrole" "dr" ON ("dr"."user" = "us"."id") WHERE "dr".${SqlUtils.formatDomainQuery(
                '%s'
              )}`,
              domain
            )
          : ''
      }) "u"`;
  },

  generateOrWhereString: function(search) {
    const keys = [
      '_full_name',
      '_fist_last_name',
      ...this.searchNameNameKeys()
    ];
    const size = keys.length;
    let searchWhereString = '';
    const _search = this.formatSearchString(search);
    for (let i = 0; i < size; i++) {
      const key = keys[i];
      searchWhereString += `"${key}" ILIKE '%${_search}%'`;
      if (i < size - 1) {
        searchWhereString += ' OR ';
      }
    }
    return searchWhereString;
  },

  generateNameSearchQuery: function(query) {
    let where = null;
    if (Reflect.has(query, 'where')) {
      where = query.where;
    } else {
      where = query;
    }
    const search = where.search;
    const domain = where.domain || where.last_domain;
    delete where.search;
    delete where.last_domain;
    delete where.domain;
    const orWhere = this.generateOrWhereString(search, domain);
    const extraQuery = SqlUtils.setQueryString(query);
    const q = `${this.getUserQueryForTextSearch(domain)} WHERE (${orWhere})${
      extraQuery ? ` AND ${extraQuery.replace('WHERE', '')}` : ';'
    }`;
    return q.trim();
  },

  wrapUserQueryForIdsOnly: function(query) {
    return `SELECT "ids"."id" as "id" FROM (${query}) "ids"`;
  },

  searchUsersByString: async function(query) {
    const q = this.generateNameSearchQuery(query);
    const _q = this.wrapUserQueryForIdsOnly(q);
    const results = await User.queryAsync(_q);
    const ids = _.pluck(results.rows, 'id');
    if (!_.size(ids)) {
      return [];
    }
    return User.find()
      .where({ id: ids })
      .populateAll();
  },

  similieUser: async domain => {
    domain = domain || null;
    const config = await Site.thisSiteAsync(domain);
    const lang = config.default_language || Translates.fallbackLanguage;
    const bot = (await Variable.findOne({
      key: 'system_translation',
      identity: 'bot_name'
    })) || {
      value: {
        [lang]: 'Bot'
      }
    };
    return new User._model({
      id: -1,
      username: config.site_name,
      first_name: config.site_name,
      last_name: bot.value[lang],
      avatar: {
        desktop: `${config.logos.bot_desktop || config.logos.navbar}`,
        thumb: `${config.logos.bot_thumb || config.logos.navbar}`,
        tiny: `${config.logos.bot_tiny || config.logos.navbar}`
      },
      online: true,
      active: true,
      preferred_language: lang,
      email: config.site_email,
      last_domain: domain,
      site_role: Roles.SIMILIE_ADMIN,
      role: Roles.SIMILIE_ADMIN
    });
  },

  setActivities: () => {
    //
  },

  is: function(user, role) {
    if (!user && role === 0) {
      return true;
    }

    if (!user) {
      return false;
    }

    if (user.site_role != null && user.site_role >= Roles.DOMAIN_ADMIN) {
      return user.site_role >= role;
    }

    return (
      (user.role == null ? user.site_role || Roles.ANONYMOUS : user.role) >=
      role
    );
  },

  /*
   * changeDomain
   *
   * changes the domain a user is assigned to
   *
   * @param {Object|Integer} userModel - the user
   * @param {Object|Integer} domainModel - the domain
   *
   */
  changeDomain: async function(userModel, domainModel) {
    const userId = this.getId(userModel);
    const domainId = this.getId(domainModel) || null;
    let domain = null;

    if (domainId != null) {
      domain = await Domain.findOneById(domainId);
      Utils.itsRequired(domain)({
        message: Const.err.ENTITY_DOES_NOT_EXIST
      });
    }

    const membership = await this.hasDomainMembership(userModel, domainModel);
    // if they aren't allow, reject
    if (!membership) {
      const restricted = {
        code: Const.code.FORBIDDEN,
        error: Const.err.NON_MEMBERS_NOT_ALLOWED
      };
      throw restricted;
    }
    // find the user
    const user = await User.findOneById(userId);

    Utils.itsRequired(user)();
    // set the domain
    user.last_domain = domainId;
    // pull and set the role
    const dR = await User.getRole(userModel, domainModel);
    Utils.itsRequired(dR)();

    user.role = dR;
    // save that puppy
    await User.saveAsync(user);
    // and pull it with all associates attached
    return await User.findOneById(user.id).populateAll();
  },
  /*
   * createWithDomain
   *
   * creates a user assigned to a specific domain
   *
   * @param {Object|Integer} userModel - the user
   * @param {Object|Integer} domainModel - the domain
   *
   */
  createWithDomain: async function(userModel, domainModel, update) {
    Utils.itsRequired(userModel)();
    const domainId = this.getId(domainModel);
    userModel.last_domain = domainId;
    if (domainId && userModel.role < Roles.DOMAIN_ADMIN) {
      userModel.domains = [domainId];
    }

    let madeUser;

    if (update && this.getId(userModel)) {
      madeUser = await User.update({ id: User.getId(userModel) }, userModel);
    } else {
      madeUser = await User.create(userModel);
    }

    return madeUser;
  },
  /*
   * getRole
   *
   * pulls the user's role form the domain
   *
   * @param {[Object]|Integer} userModel - the user
   * @param {Object|Integer} domainModel - the domain
   *
   */
  getDomainRoles: async function(userModels) {
    const uIds = _.pluck(userModels, 'id');
    if (!_.size(uIds)) {
      return userModels;
    }
    const roles = await DomainRole.find({
      user: uIds
    });

    if (!_.size(roles)) {
      return userModels;
    }

    const roleCache = {};
    _.each(roles, function(role) {
      roleCache[role.user] = roleCache[role.user] || {};
      roleCache[role.user][role.domain] = role.role;
    });
    _.each(userModels, function(user) {
      const cached = roleCache[user.id];
      _.each(user.domains, function(domain) {
        domain.role = cached[domain.id];
      });
    });

    return userModels;
  },

  getRole: async function(userModel, domainModel) {
    Utils.itsRequired(userModel)();
    const userId = this.getId(userModel);
    const domainId = this.getId(domainModel);
    const user = await User.findOneById(userId);

    Utils.itsRequired(user)();
    // if we do not have a domain, return the site role
    if (User.is(user, Roles.DOMAIN_ADMIN)) {
      if (user.site_role == null) {
        throw new Error({
          error: Const.err.PROBLEM_INDENTIFY_SITE_ROLE,
          code: Const.code.FORBIDDEN
        });
      }
      return user.site_role;
    }

    if (!domainId) {
      // this means user have ANONYMOUS access
      return user.site_role || Roles.ANONYMOUS;
    }

    const dR = await DomainRole.findOne({
      user: userId,
      domain: domainId || null
    });

    return (dR || {}).role || Roles.ANONYMOUS;
  },

  getDomainMembers: async function(userModels, domainModel) {
    const dId = this.getId(domainModel) || Const.NULL;
    const dRs = await DomainRole.find({
      domain: dId,
      role: {
        '<=': Roles.SIMILIE_ADMIN
      }
    });
    const dRchache = {};
    _.each(dRs, function(dr) {
      dRchache[dr.user] = dr.role;
    });
    _.each(userModels, function(u) {
      if (dRchache[u.id]) {
        u.role = dRchache[u.id];
      } else {
        u.role = Const.NULL;
      }
    });

    return userModels;
  },
  /*
  }
  * hasDomainMembership
  *
  * looks to see if a user is a memember
  *
  * @param {Object|Integer} userModel - the user
  * @param {Object|Integer} domainModel - the domain
  *
  */
  hasDomainMembership: async function(userModel, domainModel = Const.NULL) {
    Utils.itsRequired(userModel)();
    if (typeof domainModel === 'undefined') {
      Utils.itsRequired(domainModel)();
    }

    const userId = this.getId(userModel);
    const domainId = this.getId(domainModel);
    const user = await User.findOneById(userId);
    // if we have a domain administrator
    // they always have membership
    if (User.is(user, Roles.DOMAIN_ADMIN)) {
      return Const.ALLOWED;
    }
    const dR = await DomainRole.findOne({
      user: userId,
      domain: domainId || Const.NULL
    });
    return !!dR;
  },
  /*
   * removeDomainMembership
   *
   * removes membership
   *
   * @param {Object|Integer} userModel - the user
   * @param {Object|Integer} domainModel - the domain
   *
   */
  removeDomainMembership: async function(userModel, domainModel) {
    // these iten
    Utils.itsRequired(userModel)();
    if (typeof domainModel === 'undefined') {
      Utils.itsRequired(domainModel)();
    }

    const userId = this.getId(userModel);
    const domainId = this.getId(domainModel);
    const user = await User.findOneById(userId).populate('domains');

    if (domainId) {
      user.domains.remove(domainId);
    }

    if (user.last_domain === domainId) {
      // this means we need to have a means
      // in our policy to set this value
      if (
        user.domains.length &&
        user.last_domain &&
        user.last_domain.id !== user.domains[0].id
      ) {
        user.last_domain = user.domains[0];
      } else {
        user.last_domain = Const.NULL;
      }
    }

    if (domainId === Const.NULL && user.site_role) {
      user.site_role = Const.NULL;
    }

    await User.saveAsync(user);
    await DomainRole.destroyAsync({
      user: user.id,
      domain: domainId
    });

    return await User.findOneById(userId).populateAll();
  },

  setGlobalMeta: async function(values, whereString, ...avoid) {
    let idString = '';
    whereString = whereString || '';
    if (_.size(avoid)) {
      const ids = [];
      _.each(avoid, a => {
        ids.push(User.getId(a));
      });
      idString = `"id" NOT ${SqlUtils.setInString(ids)}`;
    }
    for (const key in values) {
      const value = values[key];
      const query = `UPDATE "user"
    SET "meta" = jsonb_set (
      COALESCE ( "meta" :: JSONB, '{}' :: JSONB ),
      '{${key}}',
      '${value}'
    )
    WHERE
      ${idString}
      ${whereString}`;
      try {
        const results = await User.queryAsync(query);
        return results.rows;
      } catch (e) {
        sails.log.error(e);
      }
    }
  },

  /*
   * addDomainMembership
   *
   * adds a user to a domain
   *
   * @param {Object|Integer} userModel - the user
   * @param {Object|Integer} domainModel - the domain
   * @param {Integer} role - the rold
   *
   */
  addDomainMembership: async function(userModel, domainModel, role) {
    // these iten
    Utils.itsRequired(userModel)();
    // as a promise the code is more inline
    const userId = this.getId(userModel);
    const domainId = this.getId(domainModel);
    const user = await User.findOneById(userId);
    if (User.is(user, Roles.DOMAIN_ADMIN)) {
      throw Utils.setErrorCode(Const.code.BAD_REQUEST);
    }

    // let domain = await Domain.findOneById(domainId);
    const setRole = Roles.getRole(user, role);
    // we are going to make this role ephemeral and change
    // throughout. This way, we don't have to alter
    // client-side code
    // user.role = setRole;
    if (domainId) {
      user.domains.add(domainId);
    } else if (!domainId && !user.site_role) {
      user.site_role = setRole;
    }
    // may not need to change this
    // user.last_domain = domain.id;
    await User.saveAsync(user);
    // we want to be absolutely certain we kill all remnats of prior domian roles
    await DomainRole.destroyAsync({
      user: userId,
      domain: domainId
    });

    const dRole = await DomainRole.create({
      user: userId,
      domain: domainId, // may need to update the user profile to get this functional
      role: setRole
    });
    // I decided to send the popluated domain role object
    const domainAll = await DomainRole.findOneById(dRole.id).populateAll();
    return domainAll;
  },

  hasAccess: function(self, params, access) {
    if (!_.size(access) || User.is(self, Roles.SIMILIE_ADMIN)) {
      return true;
    }

    const clone = Utils.stripObjects(access);
    const passports = _.where(clone, params);

    if (!_.size(passports)) {
      return true;
    }

    let hasAccess = false;

    _.each(passports, pass => {
      const users = pass.users;
      const roles = pass.roles;
      const tags = pass.tags;

      if (!_.size(users) && !_.size(roles) && !_.size(tags)) {
        hasAccess = true;
        return;
      }

      if (_.contains(users, self.id)) {
        hasAccess = true;
        return;
      }

      if (_.contains(roles, self.role)) {
        hasAccess = true;
        return;
      }
      // we can make elements hidden to a site ADMIN
      if (
        _.size(roles) === 1 &&
        _.contains(roles, Roles.SIMILIE_ADMIN) &&
        _.contains(roles, self.role)
      ) {
        hasAccess = true;
        return;
      }

      if (
        _.size(roles) === 1 &&
        User.is(self, Roles.SITE_ADMIN) &&
        !_.contains(roles, Roles.SIMILIE_ADMIN)
      ) {
        hasAccess = true;
        return;
      }

      // basically we can block site admins but add other users by selecting them specifically or with tags
      if (_.size(roles) !== 1 && User.is(self, Roles.SITE_ADMIN)) {
        hasAccess = true;
        return;
      }

      const tIds = _.pluck(self.tags, 'id');
      _.each(tIds, t => {
        if (_.contains(tags, t)) {
          hasAccess = true;
        }
      });
    });

    return hasAccess;
  },

  pullFromToken: async function(token, cb) {
    Invite.findOne({
      token: token,
      active: true
    }).exec((err, token) => {
      if (err) {
        return cb(err);
      }

      if (!token || !token.target) {
        return cb({
          error: 'errors.TOKEN_NOT_FOUND'
        });
      }

      User.findOneById(token.target)
        .populateAll()
        .exec((err, user) => {
          if (err) {
            return cb(err);
          }

          if (!user) {
            return cb({
              error: 'errors.TOKEN_NOT_VALID'
            });
          }
          cb(null, user.toJSON());
        });
    });
  },

  inviteURL: function(config, invite) {
    const host = Utils.pullHost(config);
    return host + '/login/activate-account?token=' + (invite || {}).token;
  },

  beforeUpdate: function(values, next) {
    if (values.archive) {
      values.online = false;

      sails.models.site
        .findOne({
          active: true
        })
        .then(site => {
          return site;
        })
        .then(site => {
          const GOD_MODE = site.gods || [];

          sails.models.user.findOneById(values.id).exec((err, user) => {
            if (err) {
              return next(err);
            }
            // there are users who can never be deleted
            if (user && GOD_MODE.indexOf(user.email) !== -1) {
              return next('I CANNOT BE ARCHIVED');
            }
            // if the user is not a site-level domain admin
            // and we are trying to change
            // @todo:: write some tests to prove this
            if (
              values.role &&
              !User.is(user, Roles.DOMAIN_ADMIN) &&
              // and there is an attempt to make the user a domain admin or higher
              User.is(values, Roles.DOMAIN_ADMIN) &&
              // while the user is in a non null domain
              // we reject because this should not happen
              (user.last_domain || values.last_domain)
            ) {
              return next('errors.INVALID_ROLE_REQUEST');
            }

            user.socketMessage(Const.sockets.FORCE_LOGOUT);
            // we force logout the user if there is a potential change

            next();
          });
        })
        .catch(next);
    } else {
      return next();
    }
  },

  _timers: [
    {
      interval: Const.timers.THIRTY_MINUTE, // Const.timers.THIRTY_MINUTE,
      name: 'user_purge',
      action: function() {
        return {
          do: function() {
            Jobs.userPurge.add();
          }
        };
      }
    }
  ],

  killSingleSession: async function(user) {
    const sessions = await UserSession.find().where({ user: User.getId(user) });
    for (let i = 0; i < _.size(sessions); i++) {
      const sess = sessions[i];
      if (!sess || !sess.session_key) {
        continue;
      }
      await CacheStore.destroy(sess.session_key);
      await UserSession.destroyAsync(sess);
    }
    user.online = false;
    user.session_key = null;
    user.api_session = null;
    return await User.saveAsync(user);
  },

  _processors: [
    /*
     * This processor looks for users who are still considered offline,
     * but their session has expired. It there is no suession data, we set the
     * user to their offline state
     */

    {
      name: 'convertToSiteUser',
      process: function(job) {
        const data = job.data;
        const user = data.id;
        const role = data.role;
        const domain = data.domain;
        const requestor = data.requestor;
        return User.convertToSiteUser(user, domain, role, requestor);
      },

      stats: Utils.stats({
        completed: function() {
          // sails.log.debug('All Users Purged');
        },
        failed: function(_job, err) {
          console.error('JOB convertToSiteUser ERROR::', err);
          // Utils.sendexcelMessage(err, job.data);
        }
      })
    },

    {
      name: 'userPurge',
      process: async function() {
        sails.log.debug('PURGING INACTIVE USERS');
        const users = await User.find({ online: true });
        for (let i = 0; i < users.length; i++) {
          const user = users[i];
          try {
            const session = await UserSession.findSession({ user });
            if (!session) {
              return await User.killSingleSession(user);
            }
            const values = await CacheStore.get(session.session_key);
            if (values) {
              continue;
            }
            await user.offline();
          } catch (err) {
            sails.log.error(
              `JOBS::userPurge::ERROR::user:${user.id}`,
              err.message
            );
          }
        }
      },

      stats: Utils.stats({
        completed: function() {
          // sails.log.debug('All Users Purged');
        },
        failed: function(job, err) {
          console.error('JOB UserPurge ERROR::', err);
          // Utils.sendexcelMessage(err, job.data);
        }
      })
    },

    {
      name: 'pdf',
      process: async function(job) {
        const { id, config, language } = job.data;

        const pdf = await User.generatePdf(id, config, language);

        if (!pdf) {
          sails.sockets.blast(`user-pdf-request-${id}`, {
            data: null,
            message: 'download_failed',
            success: false
          });
          return;
        }

        const pdfPromise = new Promise((resolve, reject) => {
          const bufferSize = 9007199254740991;

          const chunks = [];
          let result;
          pdf.on('readable', async () => {
            let chunk;
            while ((chunk = pdf.read(bufferSize)) !== null) {
              chunks.push(chunk);
            }
          });
          pdf.on('error', err => {
            reject(err);
          });
          pdf.on('end', async () => {
            result = Buffer.concat(chunks);
            const res = result.toString('base64');
            resolve([res, id]);
          });

          pdf.end();
        });

        return await pdfPromise;
      },
      stats: Utils.stats({
        completed: function(job, result) {
          sails.sockets.blast(`user-pdf-request-${result[1]}`, {
            data: result[0],
            message: 'download_success',
            success: true
          });
        },
        failed: function(job, err) {
          sails.log.error('User::pdf:job:error', err);
          sails.sockets.blast(`user-pdf-failed`, {
            data: null,
            message: err,
            success: false
          });
        }
      })
    }
  ],

  ensureMinRole: function(user) {
    if (!user.role || user.role <= Roles.SURVEYOR) {
      user.role = Roles.REPORTER;
    }
  },

  convertToSiteUser: async function(user, domain, role, requestor) {
    const _user = await User.findOneById(User.getId(user));
    if (!_user || !_user.user_access_disabled || _user.active) {
      throw new Error('Conversion requires a valid user');
    }

    if (!_user.email) {
      throw new Error('A valid email is required');
    }

    const count = await User.count().where({
      id: {
        '!': User.getId(_user)
      },
      email: _user.email
    });

    if (count) {
      throw new Error("A user's email must be unique");
    }
    role = role || Roles.REPORTER;

    _user.user_access_disabled = false;
    _user.role = role;
    _user.requestor = User.getId(requestor);
    _user.meta = _user.meta || {};
    _user.meta.invited = true;
    if (!domain && (!_user.site_role || _user.site_role < role)) {
      _user.site_role = role;
    }
    let updatedUser = await User.createWithDomain(_user, domain, true);
    if (_.isArray(updatedUser)) {
      updatedUser = updatedUser.pop();
    }

    const site = await Site.thisSiteAsync(domain);
    const res = {
      locals: {
        siteData: site
      }
    };
    await new Promise((resolve, reject) => {
      updatedUser.activateEmail(null, res, err => {
        if (err) {
          sails.log.error(err);
          return reject(err);
        }
        resolve();
      });
    });
    return updatedUser;
  },

  pullFullName: async function(user = {}) {
    const uId = this.getId(user);
    const thisUser = await this.findOneById(uId);
    return this.fullName(thisUser);
  },

  fullName: function(user, dUserName) {
    let name = '';
    if (user && user.first_name && user.last_name) {
      name = user.first_name + ' ' + user.last_name;
    } else if (user && user.first_name) {
      name = user.first_name;
    } else {
      name = dUserName == null ? 'Site User' : dUserName;
    }

    return name;
  },

  generateApiKey: function() {
    return crypto.randomBytes(48).toString('base64');
  },

  beforeCreate: async function(values, next) {
    // basically if we are creating a user
    // under the main site
    values.session_key = uuid.v4();
    values.api_key = User.generateApiKey();

    if (values.last_domain == null) {
      values.site_role = values.role;
    }

    if (!values.email && values.user_access_disabled === true) {
      return next();
    } else if (!values.email) {
      return next({ error: 'User email required' });
    } else {
      const where = {
        email: values.email
      };
      const count = await User.count().where(where);
      if (count) {
        return next({ errors: 'The user email must be unique' });
      }
    }

    next();
  },

  afterDestroy: async function(value, next) {
    _.each(_.isArray(value) ? value : [value], v => {
      const id = User.getId(v);
      DomainRole.destroy({
        user: id
      }).exec(_.noop);
    });
    next();
  },

  socketMessage: async function(user, message, params) {
    const sessions = await UserSession.find().where({
      user: User.getId(user),
      socket_id: { '!': null }
    });

    for (let i = 0; i < _.size(sessions); i++) {
      const session = sessions[i];
      sails.sockets.broadcast(session.socket_id, message, params);
    }
  },

  afterCreate: async function(values, next) {
    StateKeys.registerState(values, 'user', 'user_type');
    const req = UserActivity.all(values.id);
    /*
     * This is how we create an activity
     * for this creation
     */

    req.method = 'POST';
    req.user = values;

    UserActivity.set(
      UserActivity.USER_ACCOUNT_CREATED,
      {
        meta: {
          user: values
        }
      },
      req
    );

    DomainRole.create({
      user: values.id,
      domain: values.last_domain,
      role: values.role
    })
      .then(() => next(), next)
      .catch(next);
  },

  passwordResetToken: function(token) {
    return `/login/password?token=${token}`;
  },

  paswordRestURL: function(config, invite) {
    const host = Utils.pullHost(config);
    return host + this.passwordResetToken((invite || {}).token);
  },

  createPasswordChangeInvite: async function(user, expire) {
    expire = expire || 2;
    const dateNow = TimeUtils.date(now_).tz(tz);
    await Invite.update(
      {
        email: user.email,
        target: user.id,
        target_model: Invite.actions().action.PASSWORD_RESET,
        active: true
      },
      {
        active: false
      }
    );

    const invite = await Invite.create({
      email: user.email,
      target: user.id,
      target_model: Invite.actions().action.PASSWORD_RESET,
      expire: dateNow.plus(expire, TimePeriod.days).toISO,
      // [sg] moment().add(expire, 'days').format(),
      meta: {
        tags: ['password reset']
      }
    });
    return invite;
  },

  findPasswordChangeInviteToken: async function(user, expire) {
    const invite =
      (await Invite.findOne().where({
        email: user.email,
        target: user.id,
        active: true,
        target_model: Invite.actions().action.PASSWORD_RESET,
        or: [{ expire: null }, { expire: { '>=': new Date() } }]
      })) || (await this.createPasswordChangeInvite(user, expire));
    if (!invite || !invite.token) {
      throw new Error('We could not product an invite tokent');
    }
    return invite.token;
  },

  passwordReset: async function(identifier, config, expire, cb) {
    const isEmail = validator.isEmail(identifier);
    const query = {};

    if (isEmail) {
      query.email = identifier;
    } else {
      query.username = identifier;
    }

    query.active = true;

    sails.models.user.findOne(query).exec(async (err, user) => {
      if (err || !user) {
        return cb(
          {
            error: 'info.NO_USER_FOUND',
            cssClass: 'warning'
          },
          user
        );
      }

      try {
        const invite = await this.createPasswordChangeInvite(user, expire);
        const name = User.fullName(user);
        const host = User.paswordRestURL(config, invite);
        Jobs.sendEmail.add({
          to: {
            address: user.email,
            name: name
          },
          locals: {
            inviteURL: host,
            name: name,
            site_name: config.site_name,
            days: expire + ' days',
            host: Utils.pullHost(config)
          },
          default_language: user.preferred_language || config.default_language,
          template: 'password',
          variables: Email.variables.password.key,
          tags: ['user requested', 'password reset']
        });
        return cb(null, {
          message: 'info.PASSWORD_RESET_FOUND',
          cssClass: 'info'
        });
      } catch (e) {
        return cb(e);
      }
    });
  },

  beforeDestroy: function(values, next) {
    const id = (values.where || values).id;

    if (!id) {
      sails.log.error('DESTROY USER:: There is no id for deletion');
      return next(true);
    }

    sails.models.site
      .findOne({
        active: true
      })
      .then(site => {
        return site;
      })
      .then(site => {
        const GOD_MODE = site.gods || [];
        sails.models.user.findOneById(id).exec((err, user) => {
          if (err) {
            sails.log.error(err);
            return next(err);
          }

          if (user && GOD_MODE.indexOf(user.email) !== -1) {
            return next('YOU CANNOT DESTROY ME');
          }
          user.socketMessage(Const.sockets.FORCE_LOGOUT);
          next();
        });
      })
      .catch(next);
  },

  finishActivation: async function(params, user, cb = _.noop) {
    const password = params.password;
    const userID = User.getId(user);
    delete params.password;
    delete params.password_validate;
    // no idea why that's there
    delete params.user;
    const meta = params.meta || {};
    meta.invited = false;
    const update = {
      ...params,
      ...{ meta: meta },
      active: true
    };

    delete update.created_at;
    delete update.updated_at;
    delete update.token;
    let _user;
    try {
      const _u = await sails.models.user.update(
        {
          id: userID
        },
        update
      );
      _user = _u.pop();
      if (!_user) {
        throw new Error('User not found');
      }
    } catch (e) {
      sails.log.error(e);
      return cb(e);
    }
    try {
      const passport = await sails.models.passport.create({
        password: password,
        user: userID,
        accessToken: crypto.randomBytes(48).toString('base64')
      });

      _user.passports.add(Model.getId(passport));
      await User.saveAsync(_user);

      if (params.token) {
        sails.models.invite
          .update(
            {
              token: params.token
            },
            {
              active: false
            }
          )
          .exec(err => {
            if (err) {
              sails.log.error(err);
            }
          });
      }
    } catch (e) {
      sails.log.error(e);
      return cb(e);
    }
    const u = _user.toJSON();
    cb(null, u);
    return u;
  },

  replacePassword: async function(user, password) {
    const uId = User.getId(user);
    const query = {
      protocol: 'local',
      inactive: false,
      user: uId
    };

    await Passport.update(query, {
      inactive: true
    });

    const passport = await Passport.create({
      password: password,
      accessToken: crypto.randomBytes(48).toString('base64'),
      ...query
    });

    return passport;
  },

  resetLocalPassword: async function(user, password) {
    await this.replacePassword(user, password);

    if (_.isObject(user)) {
      user.passports.add(Model.getId(passport));
      await User.saveAsync(user);
    }

    return passport;
  },

  pullPassports: async function(user) {
    const passports = _.where(user.passports, {
      protocol: 'local',
      inactive: false
    });
    // we don't need to wait for this
    for (let i = 0; i < passports.length; i++) {
      const passport = passports[i];
      passport.inactive = true;
      await Passport.saveAsync(passport);
    }
  },

  resetPassword: function(params, cb, noinvite) {
    sails.models.user
      .findOne({
        id: params.user
      })
      .populate('passports')
      .then(async user => {
        // update the password
        await User.pullPassports(user);
        await User.replacePassword(user, params.password);
        user.force_reset = false;
        await User.saveAsync(user);

        return user;
      })
      .then(user => {
        // here we consume the invite
        if (!noinvite) {
          sails.models.invite
            .update(
              {
                token: params.token
              },
              {
                active: false
              }
            )
            .exec((err, invite) => {
              if (err) {
                sails.log.error(err);
              }
              cb(err, invite);
            });
        } else {
          return cb(null, user);
        }
      })
      .catch(cb);
  },

  csvIdentity: function() {
    return ['username', 'email'];
  },

  reports: function(dependents) {
    const reporting = {
      identifier: 'user'
    };
    const user = dependents.user;
    const domain = dependents.domain;
    const isDomainAdmin = User.is(user, Roles.DOMAIN_ADMIN) && !domain;

    return Q.fcall(() => {
      const deferred = Q.defer();
      let q = `SELECT
        count(*) AS total_users,
        count(nullif(active, false)) AS active,
        count(nullif(active, true)) AS not_active
      FROM "user" `;

      if (!isDomainAdmin) {
        q += `WHERE ${SqlUtils.formatDomainQuery(
          domain,
          'last_domain'
        )} AND role < ${Roles.DOMAIN_ADMIN}`;
      }

      q += ';';

      sails.models.user.query(
        escape(q),
        (err, result) => {
          if (err) {
            throw new Error(err);
          }

          reporting.counts = result.rows;

          deferred.resolve(reporting);
        },
        deferred.reject
      );
      return deferred.promise;
      // SELECT count(*) as total_users, count(nullif(active, false)) as active, count(nullif(active, true)) as not_active FROM "user"
    })
      .then(() => {
        const deferred = Q.defer();
        let q = `SELECT
          id,
          email,
          avatar,
          first_name,
          last_name,
          username,
          role,
          activity
        FROM "user" LEFT JOIN (
          SELECT "user" AS user_id,
          COUNT("user") AS activity from "activity" GROUP BY 1
        ) AS activity ON ("user".id = activity.user_id)
        WHERE activity.activity IS NOT NULL`;

        if (!isDomainAdmin) {
          q += ` AND ${SqlUtils.formatDomainQuery(
            domain,
            'last_domain'
          )} AND role < ${Roles.DOMAIN_ADMIN}`;
        }

        q += ' ORDER BY activity DESC;';
        sails.models.user.query(
          escape(q),
          (err, result) => {
            if (err) {
              throw new Error(err);
            }

            reporting.activities = result.rows;

            deferred.resolve(reporting);
          },
          deferred.reject
        );
        return deferred.promise;
      })
      .then(() => {
        const deferred = Q.defer();
        const schema = dependents.schema;

        Q.fcall(() => {
          return dependents;
        })
          .then(dependents => {
            const tables = dependents.tables;
            const names = _.pluck(tables, 'table_name');
            const template = _.template(
              'SELECT count("observer") As count, "observer", \'<%=table_name%>\' As table_name FROM "<%=schema%>".<%=table_name%> GROUP BY 2'
            );
            let concat = Utils.concatTableNames(names, template, schema);
            const deferred = Q.defer();

            if (!concat) {
              deferred.resolve([]);
              return deferred.promise;
            }

            concat += 'ORDER BY table_name ASC, "count" DESC;';
            Model.query(escape(concat), (err, result) => {
              if (err) {
                return deferred.reject(err);
              }

              deferred.resolve(
                (
                  result || {
                    rows: []
                  }
                ).rows
              );
            });

            return deferred.promise;
          })
          .then(result => {
            const query =
              'SELECT sum(g.count) as activity_total, g.observer, u.first_name, u.last_name, u.username, u.email, u.role, u.avatar::jsonb FROM json_populate_recordset(NULL::"public".query_recordset, \'%s\') as g JOIN public.user as u ON (u.id = g.observer) GROUP BY 2,3,4,5,6,7,8 ORDER BY activity_total DESC;';

            const deferred = Q.defer();

            if (!result || !_.size(result)) {
              return deferred.resolve({
                nodes: result,
                user: []
              });
            }

            Model.query(escape(query, JSON.stringify(result)), (err, r) => {
              if (err) {
                return deferred.reject(err);
              }

              deferred.resolve({
                users: result,
                nodes: (
                  r || {
                    rows: []
                  }
                ).rows
              });
            });

            return deferred.promise;
          })
          .then(payload => {
            if (!payload || !_.size(payload.nodes)) {
              return deferred.resolve(reporting);
            }

            const send = [];
            const order = _lo.groupBy(payload.nodes, 'observer');
            _.each(order, (o, uId) => {
              const user = o.pop() || {};

              user.nodes = {};

              const observer = _.where(payload.users, {
                observer: parseInt(uId)
              });
              _.each(observer, p => {
                user.nodes[p.table_name] = p.count;
              });

              send.push(user);
            });
            reporting.imports = send;
            deferred.resolve(reporting);
          })

          .catch(why => {
            sails.log.error(why);
            deferred.reject(why);
          });

        return deferred.promise;
      });
  },

  // PDF functions ====================================================
  pdfGetTranslation: async function(language = '') {
    let varCache = {};

    try {
      varCache = Variable.varCache(
        await Variable.find({
          or: [
            {
              key: Translates.translateIdentity,
              identity: [
                'labels.FIRST_NAME',
                'labels.LAST_NAME',
                'labels.PERSONNEL_DETAILS__OTHER_NAME',
                'labels.PERSONNEL_DETAILS__DOB',
                'labels.ENLISTMENT_DATE',
                'labels.EMPLOYEE_ID_PERSONNEL',
                'labels.POSITION',
                'labels.EMAIL',
                'labels.TAGS',
                'labels.PHONE_NUMBER',
                'labels.BADGES_RANK',
                'labels.PRIMARY_DISTRICT',
                'labels.BASIC_INFORMATION',
                'labels.CONTACT_DETAILS',
                'labels.LOCATION_DETAILS',
                'labels.LAST_UPDATED',
                'labels.RANK_HISTORY',
                'labels.DATE_ASSIGNED',
                'labels.ASSIGNMENT_MEMO',
                'labels.CAREER_PROGRESSION',
                'labels.REQUISION_CATEGORY',
                'labels.REQUISION_SPECIALTY',
                'labels.POSITIONS',
                'labels.COMPETENCIES',
                'labels.TITLE',
                'labels.ASSINGED_BY',
                'labels.STARTED_ON',
                'labels.TIME_IN',
                'labels.CURRENT',
                'labels.COMPLETED',
                'labels.SATISFACTORY',
                'labels.COMPLETED_ON',
                'labels.PERFORMANCE_MEMO',
                'labels.ARCHIVED',
                'labels.YES',
                'labels.COMPLETE',
                'labels.INCOMPLETE',
                'labels.SATISFIED',
                'labels.NOT_YET_SATISFIED',
                'labels.YEARS',
                'labels.YEAR',
                'labels.MONTHS',
                'labels.MONTH',
                'labels.DAYS',
                'labels.DAY',
                'labels.HOURS',
                'labels.HOUR',
                'labels.MINUTES',
                'labels.MINUTE',
                'labels.SECONDS',
                'labels.SECOND',
                'labels.MILISECONDS',
                'labels.MILISECOND'
              ]
            }
          ]
        }),
        language
      );
    } catch (err) {
      sails.log.error('PDF ERROR get translation = ', err);
    }

    return {
      firstName: varCache['labels.FIRST_NAME'] || 'First Name',
      lastName: varCache['labels.LAST_NAME'] || 'Last Name',
      otherName: varCache['labels.PERSONNEL_DETAILS__OTHER_NAME'] || 'Nickname',
      dob: varCache['labels.PERSONNEL_DETAILS__DOB'] || 'Date of Birth',
      enlistementDate: varCache['labels.ENLISTMENT_DATE'] || 'Enlistment Date',
      nim: varCache['labels.EMPLOYEE_ID_PERSONNEL'] || 'NIM',
      position: varCache['labels.POSITION'] || 'Position',
      email: varCache['labels.EMAIL'] || 'Email',
      tags: varCache['labels.TAGS'] || 'Tags',
      phone: varCache['labels.PHONE_NUMBER'] || 'Phone Number',
      badge: varCache['labels.BADGES_RANK'] || 'Badge Rank',
      district: varCache['labels.PRIMARY_DISTRICT'] || 'Primary District',
      basicInfo: varCache['labels.BASIC_INFORMATION'] || 'Basic Information',
      contactDetails: varCache['labels.CONTACT_DETAILS'] || 'Contact Details',
      locationDetails:
        varCache['labels.LOCATION_DETAILS'] || 'Location details',
      lastUpdate: varCache['labels.LAST_UPDATED'] || 'Last Updated',
      rankHistory: varCache['labels.RANK_HISTORY'] || 'Rank History',
      dateAssign: varCache['labels.DATE_ASSIGNED'] || 'Date Assign',
      memo: varCache['labels.ASSIGNMENT_MEMO'] || 'Memo',
      careerProgression:
        varCache['labels.CAREER_PROGRESSION'] || 'Career Progression',
      requisionCategory:
        varCache['labels.REQUISION_CATEGORY'] || 'Requision Category',
      requisionSpeciality:
        varCache['labels.REQUISION_SPECIALTY'] || 'Requision Specialty',
      positions: varCache['labels.POSITIONS'] || 'Positions',
      competencies: varCache['labels.COMPETENCIES'] || 'Competencies',
      title: varCache['labels.TITLE'] || 'Title',
      assignBy: varCache['labels.ASSINGED_BY'] || 'title',
      startedOn: varCache['labels.STARTED_ON'] || 'Started On',
      timeIn: varCache['labels.TIME_IN'] || 'Time In',
      current: varCache['labels.CURRENT'] || 'Current',
      completed: varCache['labels.COMPLETED'] || 'Completed',
      satisfactory: varCache['labels.SATISFACTORY'] || 'Satisfactory',
      completedOn: varCache['labels.COMPLETED_ON'] || 'Completed On',
      performanceMemo:
        varCache['labels.PERFORMANCE_MEMO'] || 'Performance Memo',
      archived: varCache['labels.ARCHIVED'] || 'Archived',
      yes: varCache['labels.YES'] || 'Yes',
      complete: varCache['labels.COMPLETE'] || 'Complete',
      incomplete: varCache['labels.INCOMPLETE'] || 'Incomplete',
      satisfied: varCache['labels.SATISFIED'] || 'Satisfied',
      notYetSatisfied:
        varCache['labels.NOT_YET_SATISFIED'] || 'Not yet satisfied',
      years: varCache['labels.YEARS'] || 'Years',
      year: varCache['labels.YEAR'] || 'Year',
      months: varCache['labels.MONTHS'] || 'Months',
      month: varCache['labels.MONTH'] || 'Month',
      days: varCache['labels.DAYS'] || 'Days',
      day: varCache['labels.DAY'] || 'Day',
      hours: varCache['labels.HOURS'] || 'Hours',
      hour: varCache['labels.HOUR'] || 'Hour',
      minutes: varCache['labels.MINUTES'] || 'Minutes',
      minute: varCache['labels.MINUTE'] || 'Minute',
      seconds: varCache['labels.SECONDS'] || 'Seconds',
      second: varCache['labels.SECOND'] || 'Second',
      miliseconds: varCache['labels.MILISECONDS'] || 'Miliseconds',
      milisecond: varCache['labels.MILISECOND'] || 'Milisecond'
    };
  },

  pdfRenderNationalities: async function(identity = '', value = '') {
    if (!identity) return '';

    const flag = identity.toLowerCase();
    const path = `${sails.config.__parentDir}/assets/images/flags/1x1/${flag}.svg`;

    const image = await PdfHelper.generateImageBase64(path || '');
    return Pdf.Components.basic.column([
      Pdf.Components.basic.image(
        image,
        {
          alignment: 'left',
          width: 10,
          height: 10
        },
        true
      ),
      value
    ]);
  },

  iterateValuesAgainstNode: async function(anotherNodeContent, key) {
    const values = [];
    for (const ac of anotherNodeContent) {
      const store = [];
      for (const { name, type } of key) {
        const sanitizedVal = Pdf.Helper.sanitizeValue(type, ac[name]);

        let value = sanitizedVal;

        if (type === Pdf.Constant.Node.COUNTRY) {
          value = await this.pdfRenderNationalities(
            (ac[name] && ac[name][0]) || '',
            sanitizedVal
          );
        }
        store.push(value);
      }
      values.push(store);
    }
    return values;
  },

  pdfRenderNodeTable: async function(
    value = [],
    node = null,
    translation = {}
  ) {
    // get node schema
    const nSchema = await NodeSchema.findOneById(node);

    if (!nSchema) return [];

    // get node data
    const anotherNodeContent = value.length
      ? await Node.findNodes(
          {
            where: {
              id: value
            }
          },
          nSchema
        )
      : [];

    // prepare header
    const key = nSchema.schema.map(ns => {
      return {
        label: ns.label,
        type: ns.type,
        name: ns.name
      };
    });
    // add custom field
    key.push({
      type: Pdf.Constant.Node.DATE,
      label: translation.lastUpdate,
      name: 'updatedAt'
    });

    // create table header
    const tableHeader = key.map(({ label }) => label);
    const tableBody = await this.iterateValuesAgainstNode(
      anotherNodeContent,
      key
    );
    // render basic table for nodes
    return Pdf.Components.basic.basicTable(tableHeader, tableBody, {
      autoHeader: true
    });
  },

  pdfRenderMultiSelect: async function(field = '', value = []) {
    if (!value.length) return '';

    const lang = await Variable.find().where({
      id: value
    });

    return Pdf.Components.basic.body([
      {
        field,
        value: Pdf.Components.basic.tags(
          lang.map(t => t.value.en),
          { background: '#06c4de' }
        )
      }
    ]);
  },

  pdfRenderSection: async function(val = '', border = false) {
    return Pdf.Components.basic.section(val, { border });
  },

  pdfRenderFile: async function(field = '', value = []) {
    if (!value.length) return '';

    return Pdf.Components.basic.body([
      {
        field,
        value: Pdf.Components.basic.column(
          value.map(async v => {
            const image = await PdfHelper.generateImageBase64(
              v ? `/api/v1/sysfiles/download/${v}` : ''
            );

            return Pdf.Components.basic.image(
              image,
              {
                width: 50,
                height: 50,
                alignment: 'left'
              },
              true
            );
          })
        )
      }
    ]);
  },

  pdfRenderNodeValue: async function(type, field, node, val, translation = {}) {
    try {
      let content;
      const value = Pdf.Helper.sanitizeValue(type, val);

      switch (type) {
        case Pdf.Constant.Node.NODE:
          content = await this.pdfRenderNodeTable(value, node, translation);
          break;
        case Pdf.Constant.Node.MULTI_SELECT:
          content = await this.pdfRenderMultiSelect(field, value);
          break;
        case Pdf.Constant.Node.TAB_SET:
          content = await this.pdfRenderSection(field, true);
          break;
        case Pdf.Constant.Node.PARAM_GROUP:
          content = await this.pdfRenderSection(field, true);
          break;
        case Pdf.Constant.Node.FILE_STORY:
          content = await this.pdfRenderFile(field, value);
          break;

        default:
          content = Pdf.Components.basic.body([{ field, value }]);
          break;
      }

      return content;
    } catch (err) {
      sails.log.error('PDF ERROR render node value = ', err);
      return [];
    }
  },

  pdfMappingSingleNode: async function(
    data = [],
    schemas,
    nodeData,
    translation
  ) {
    try {
      // node schema child/data
      const nodeContent = await Promise.all(
        data.map(async value => {
          const findSchema = schemas.find(f => f.name === value);

          if (!findSchema) {
            return [];
          }

          const { label: field, type, node } = findSchema;

          // render content from node schema
          const content = await this.pdfRenderNodeValue(
            type,
            field,
            node,
            nodeData[value],
            translation
          );

          return content;
        })
      );

      return nodeContent;
    } catch (err) {
      sails.log.error('PDF ERROR mapping single node = ', err);
      return [];
    }
  },

  pdfMappingGroupNode: async function(
    data = [],
    schemas,
    nodeData,
    translation
  ) {
    try {
      const mappingContent = await Promise.all(
        data.map(async ({ label, map }) => {
          // node schema parent/title
          const schemaContent = [[Pdf.Components.basic.section(label)]];

          // node schema child/data
          const nodeContent = await this.pdfMappingSingleNode(
            map,
            schemas,
            nodeData,
            translation
          );

          // merge title and content
          if (nodeContent.length) {
            schemaContent.push([nodeContent]);
          }

          // node schema content
          return schemaContent;
        })
      );

      return mappingContent;
    } catch (err) {
      sails.log.error('PDF ERROR mapping group node = ', err);
      return [];
    }
  },

  pdfGenerateDynamicContent: async function(id, user, translation) {
    try {
      const schemas = (user && user.schema && user.schema.schema) || {};
      const mappings = (user && user.schema && user.schema.mappings) || [];

      // Get node schema data
      const node = await Node.findNodes(
        {
          where: {
            observer: id
          }
        },
        user.schema
      );
      const nodeData = node.length ? node[0] : {};

      // prepare node schema content
      const dynamicsData = await Promise.all(
        mappings.map(async ({ map, label, group }) => {
          // node schema content
          const mappingContent = group
            ? await this.pdfMappingGroupNode(
                map,
                schemas,
                nodeData,
                translation
              )
            : await this.pdfMappingSingleNode(
                map,
                schemas,
                nodeData,
                translation
              );

          // sidebar title
          return [[Pdf.Components.basic.section(label)], ...mappingContent];
        })
      );

      sails.sockets.blast(`user-pdf-request-${id}`, {
        message: 'generate_dynamic_content',
        success: true
      });

      // node schema data
      return Pdf.Components.basic.column([dynamicsData]);
    } catch (err) {
      sails.log.error('PDF ERROR generate dynamic content = ', err);
      sails.sockets.blast(`user-pdf-request-${id}`, {
        message: 'generate_dynamic_content',
        success: false
      });

      return [];
    }
  },

  pdfGenerateStaticContent: async function(id, user, config, translation) {
    try {
      let organization = {};
      let districtInfo = [];

      // Get org data
      const orgId = (user.organization && user.organization.badge) || '';
      if (orgId) {
        const org = await Badging.findOneById(orgId).populateAll();
        if (org) {
          organization = org;
        }
      }

      // Get district data
      const district = await District.pullRegions(user.primary_district);
      // render district into to pdf
      if (district.length) {
        districtInfo = district
          .sort((a, b) => a.district_type.order - b.district_type.order)
          .map(m => {
            return {
              field: m.district_type.value.en,
              value: m.name.en
            };
          });
      }

      const badgeData = user.rank_badge || {};
      const badge = (badgeData.icon && badgeData.icon.desktop) || '';
      const avatar = (user.avatar && user.avatar.desktop) || '';
      const logo = config.logos.sidebar;
      const secondaryPhone = (user.secondary_phone || []).map(p => ({
        field: p.label,
        value: p.resource
      }));

      // basic info data
      const basicInfo = [
        {
          field: translation.firstName,
          value: user.first_name
        },
        {
          field: translation.lastName,
          value: user.last_name
        },
        {
          field: translation.otherName,
          value: user.middle_name
        },
        {
          field: translation.dob,
          value: TimeUtils.formattedDate(user.dob, Formats.Date.full)
        },
        {
          field: translation.enlistementDate,
          value: TimeUtils.formattedDate(
            user.enlistement_date,
            Formats.Date.full
          )
        },
        {
          field: translation.nim,
          value: user.id
        },
        {
          field: translation.position,
          value: user.title
        }
      ];

      // badge data
      if (badge) {
        const imageBadge = await PdfHelper.generateImageBase64(badge || '');

        basicInfo.push({
          field: translation.badge,
          value: Pdf.Components.basic.image(
            imageBadge,
            {
              alignment: 'left',
              width: 20,
              height: 20
            },
            true
          )
        });
      }
      // contact info data
      const contactInfo = [
        {
          field: translation.email,
          value: user.email
        },
        {
          field: translation.phone,
          value: user.phone
        },
        ...secondaryPhone
      ];

      // tags data
      const tagsContent = user.tags.length
        ? [
            Pdf.Components.basic.section(),
            Pdf.Components.basic.body([
              {
                field: translation.tags,
                value: Pdf.Components.basic.tags(
                  (user.tags || []).map(t => t.name),
                  { background: '#06c4de' }
                )
              }
            ])
          ]
        : [];

      sails.sockets.blast(`user-pdf-request-${id}`, {
        message: 'generate_static_content',
        success: true
      });

      const logoImage = await PdfHelper.generateImageBase64(
        organization.url || logo
      );
      const image = await PdfHelper.generateImageBase64(avatar || '');

      return [
        Pdf.Components.basic.logo(
          logoImage,
          organization.name || user.schema.title,
          true
        ),
        Pdf.Components.basic.section(badgeData.name || translation.basicInfo),
        Pdf.Components.basic.column([
          [Pdf.Components.basic.body(basicInfo)],
          {
            width: 170,
            columns: [
              Pdf.Components.basic.image(
                image,
                {
                  alignment: 'left',
                  width: 150,
                  height: 150
                },
                true
              )
            ]
          }
        ]),
        Pdf.Components.basic.section(translation.contactDetails),
        Pdf.Components.basic.body(contactInfo),
        Pdf.Components.basic.section(translation.locationDetails),
        Pdf.Components.basic.body([
          {
            field: translation.district,
            value: user.primary_district
          },
          ...districtInfo
        ]),
        ...tagsContent
      ];
    } catch (err) {
      sails.log.error('PDF ERROR generate static content = ', err);
      sails.sockets.blast(`user-pdf-request-${id}`, {
        message: 'generate_static_content',
        success: false
      });

      return [];
    }
  },

  pdfGenerateUserBadeInfo: async function(id, translation) {
    try {
      let userBadgeInfo = [];

      // Get user badges
      const userBadge = await UserBadge.find({ user: id }).populateAll();
      if (userBadge.length) {
        // create table header
        const userBadgeHeader = [
          translation.badge,
          translation.dateAssign,
          translation.memo,
          translation.lastUpdate
        ];

        // create table body
        const userBadgeBody = await Promise.all(
          userBadge
            .sort((a, b) => b.date_assigned - a.date_assigned)
            .map(async ub => {
              const image = await PdfHelper.generateImageBase64(
                ub.badge.icon.tiny || ''
              );

              return [
                Pdf.Components.basic.column([
                  Pdf.Components.basic.image(
                    image,
                    {
                      alignment: 'left',
                      width: 10,
                      height: 10
                    },
                    true
                  ),
                  ub.badge.name
                ]),
                TimeUtils.formattedDate(ub.date_assigned, Formats.Date.full),
                ub.memo,
                TimeUtils.formattedDate(ub.updatedAt, Formats.Date.full)
              ];
            })
        );

        // render user badges to pdf
        userBadgeInfo = [
          Pdf.Components.basic.section(translation.rankHistory),
          Pdf.Components.basic.basicTable(userBadgeHeader, userBadgeBody, {
            autoHeader: true
          })
        ];
      }

      sails.sockets.blast(`user-pdf-request-${id}`, {
        message: 'generate_user_badge_content',
        success: true
      });

      return userBadgeInfo;
    } catch (err) {
      sails.log.error('PDF ERROR generate user badge info = ', err);
      sails.sockets.blast(`user-pdf-request-${id}`, {
        message: 'generate_user_badge_content',
        success: false
      });

      return [];
    }
  },

  pdfUserCareerProgressionInfo: async function(id, user, translation) {
    try {
      let userCareerProgressionInfo = [];

      // Get career progression
      const requisition = await Requisition.find({
        user: id
      }).populateAll();
      if (requisition.length) {
        const requisionData = _lo.groupBy(requisition, 'primary');
        const requisitionHeader = [
          translation.title,
          translation.assignBy,
          translation.startedOn,
          translation.timeIn,
          translation.current,
          translation.completed,
          translation.satisfactory,
          translation.completedOn,
          translation.performanceMemo
        ];

        const requisitionBody = (type = 'true') =>
          (requisionData[type] || []).map(p => {
            const assigned_by = p.assigned_by || {};
            const assignBy = [
              assigned_by.first_name || '',
              assigned_by.middle_name || '',
              assigned_by.last_name || ''
            ]
              .filter(f => f !== '')
              .join(' ');

            return [
              p.jobdescription.title,
              assignBy,
              TimeUtils.formattedDate(p.started_on, Formats.Date.full),
              TimeUtils.autoFormatDuration(p.completed_on, p.started_on, {
                year: { singular: translation.year, plural: translation.years },
                month: {
                  singular: translation.month,
                  plural: translation.months
                },
                day: { singular: translation.day, plural: translation.days },
                hour: { singular: translation.hour, plural: translation.hours },
                minute: {
                  singular: translation.minute,
                  plural: translation.minutes
                },
                second: {
                  singular: translation.second,
                  plural: translation.seconds
                },
                millisecond: {
                  singular: translation.milisecond,
                  plural: translation.miliseconds
                }
              }),
              p.complete || p.archived ? translation.archived : translation.yes,
              p.complete ? translation.complete : translation.incomplete,
              p.satisfied ? translation.satisfied : translation.notYetSatisfied,
              TimeUtils.formattedDate(p.completed_on, Formats.Date.full),
              p.memo || ''
            ];
          });

        const requisionVariable = await Variable.find().where({
          or: [{ id: user.specialty }, { id: user.trade }]
        });

        const getRequisionVariable = index => {
          return (
            (requisionVariable[index] &&
              requisionVariable[index].value &&
              requisionVariable[index].value.en) ||
            ''
          );
        };

        // render user careers progression to pdf
        userCareerProgressionInfo = [
          Pdf.Components.basic.section(translation.careerProgression),
          Pdf.Components.basic.column([
            [
              Pdf.Components.basic.body([
                {
                  field: translation.requisionCategory,
                  value: getRequisionVariable(0)
                }
              ])
            ],
            [
              Pdf.Components.basic.body([
                {
                  field: translation.requisionSpeciality,
                  value: getRequisionVariable(1)
                }
              ])
            ]
          ]),
          Pdf.Components.basic.section(translation.positions, {
            border: false
          }),
          Pdf.Components.basic.basicTable(
            requisitionHeader,
            requisitionBody('true'),
            { autoHeader: true }
          ),
          Pdf.Components.basic.section(translation.competencies, {
            border: false
          }),
          Pdf.Components.basic.basicTable(
            requisitionHeader,
            requisitionBody('false'),
            { autoHeader: true }
          )
        ];
      }

      sails.sockets.blast(`user-pdf-request-${id}`, {
        message: 'generate_user_career_progression_content',
        success: true
      });

      return userCareerProgressionInfo;
    } catch (err) {
      sails.log.error('PDF ERROR generate user career progression = ', err);
      sails.sockets.blast(`user-pdf-request-${id}`, {
        message: 'generate_user_career_progression_content',
        success: false
      });

      return [];
    }
  },
  // End PDF functions ====================================================

  generatePdf: async function(id, config, language) {
    if (!id) return null;

    // Get user data
    const user = await User.findOneById(id).populateAll();
    if (!user) {
      return null;
    }

    // Get translation
    const translation = await this.pdfGetTranslation(language);

    // Get static content
    const statics = await this.pdfGenerateStaticContent(
      id,
      user,
      config,
      translation
    );

    // Get dynamic content
    const dynamics = await this.pdfGenerateDynamicContent(
      id,
      user,
      translation
    );

    // Get user badge info content
    const userBadgeInfo = await this.pdfGenerateUserBadeInfo(id, translation);

    // Get user career progression content
    const userCareerProgressionInfo = await this.pdfUserCareerProgressionInfo(
      id,
      user,
      translation
    );

    const content = {
      content: [...statics, dynamics, userBadgeInfo, userCareerProgressionInfo]
    };

    const generated = await Pdf.Helper.print(
      content,
      Pdf.Layouts.basic,
      PdfHelper.fonts
    );

    return generated;
  }
};
