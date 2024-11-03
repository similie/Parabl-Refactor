/**
 * Requisition.js
 *
 * @description :: A model definition.  Represents a database table/collection/etc.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

const { TimeUtils, SqlUtils } = require('similie-api-services');
const CareerTrack = require('./CareerTrack');
const SailsExtensions = require('../services/SailsExtensions');
const { Common } = require('../model-utilities/common/common');
const now_ = TimeUtils.constants.now_;

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    user: {
      model: 'user'
    },

    assigned_by: {
      model: 'user'
    },

    completed_by: {
      model: 'user'
    },

    satisfied_by: {
      model: 'user'
    },

    qualification: {
      type: 'integer',
      defaultsTo: 0
    },

    personnel: {
      defaultsTo: false,
      type: 'boolean'
    },

    station: {
      required: true,
      model: 'station'
    },

    role: {
      type: 'integer',
      min: Roles.ANONYMOUS,
      defaultsTo: Roles.REPORTER,
      max: Roles.MANAGER
    },

    parent: {
      model: 'requisition'
    },

    domain: {
      model: 'domain'
    },

    complete: {
      type: 'boolean',
      defaultsTo: false
    },

    jobtemplate: {
      model: 'jobtemplate'
    },

    jobdescription: {
      model: 'jobdescription'
    },

    stationasset: {
      model: 'stationasset'
    },

    started_on: {
      type: 'datetime'
    },

    completed_on: {
      type: 'datetime'
    },

    satisfied: {
      type: 'boolean',
      defaultsTo: false
    },

    archived: {
      type: 'boolean',
      defaultsTo: false
    },

    back_filled: {
      type: 'boolean',
      defaultsTo: false
    },

    locked: {
      type: 'boolean',
      defaultsTo: false
    },

    weight: {
      defaultsTo: 0,
      type: 'integer'
    },

    memo: {
      type: 'text'
    },

    primary: {
      type: 'boolean',
      defaultsTo: false
    },

    category_weight: {
      defaultsTo: 0,
      type: 'integer'
    }
  },
  peopleGroupQuery: function(stations) {
    const query = `SELECT
    "u"."id" as "id",
    "u"."first_name",
    "u"."last_name",
    "u"."middle_name",
    "u"."email",
    "u"."title",
    "u"."employee_id",
    "u"."schema" as "schema",
    "r"."id" as "requisition",
    "r"."role" as "role",
    "s"."id" as "station",
    "s"."station_id" as "cost_code",
    "s"."local_name" as "station_name",
    "ns"."title" as "person_type",
    "ns"."name" as "person"
  FROM
    "requisition" "r"
    JOIN "user" "u" ON "u"."id" = "r"."user"
    LEFT JOIN "nodeschema" "ns" ON "u"."schema" = "ns"."id"
    LEFT JOIN "station" "s" ON "r"."station" = "s"."id" 
  WHERE
    "r"."personnel" = true AND 
    "r"."archived" = false AND
    "r"."station" %s
  `;
    const escape = SqlUtils.escapeUtil();
    return escape(query, SqlUtils.setInString(stations));
  },

  getStationPeopleSearchQuery: async function(params, userSearchText) {
    const parents = await Station.ancestors(params.station);
    const stations = _.pluck(parents, 'id');
    let peopleQuery = this.peopleGroupQuery(stations);
    peopleQuery += ` AND (${userSearchText})`;
    if (params.role) {
      const build = { '"role"': params.role };
      peopleQuery += ` AND  ("r".${SqlUtils.buildWhereString(build).substring(
        1
      )}`;
    }
    return peopleQuery;
  },

  assignRequisitionThroughPos: async function(transaction, client) {
    if (transaction.requisition) {
      const is_return = transaction.is_return;
      let user = null;
      const date = {};
      const date_verb = 'started_on';
      if (!is_return) {
        date[date_verb] = TimeUtils.isoFormattedDate(now_);
        user = User.getId(client);
      } else {
        date[date_verb] = null;
      }

      const req = await Requisition.update(
        { id: transaction.requisition },
        { user: user, ...date }
      );
      return req;
    }
    return false;
  },

  buildTracker: async function(req, res) {
    const params = await req.params.all();
    const tracking = await Tracker.findCodeBody('short');
    const socket = sails.sockets.getId(req);

    const send = {
      tracking: tracking,
      socket: socket,
      domain: Domain.getId(res.locals.domain)
    };
    Jobs.findQualifiedCandidates.add({
      ...params,
      ...send
    });
    res.send(send);
  },

  checkout: async function(req, res) {
    const params = req.params.all();
    if (!params.id) {
      return res.badRequest({
        error: 'Requisition ID required'
      });
    }

    if (!params.user) {
      return res.badRequest({
        error: 'User ID required'
      });
    }

    const requisition = await Requisition.findOneById(params.id).populateAll();

    if (!requisition) {
      return res.badRequest({
        error: 'Requistition not found'
      });
    }

    const stationasset = requisition.stationasset;
    const ownerStation = stationasset.station;
    const assetStation = stationasset.asset;
    const aStation = await Station.findOneById(assetStation);
    const nSerial = await NodeSerial.findOneById(
      stationasset.serial_bind
    ).populateAll();

    const oSchema = nSerial.owned_by_schema;
    const pSchema = nSerial.possessed_by_schema;
    // const assetSchema = await Station.findOneById(params.asset);
    // const serial = assetSchema.schema[result.serial_param];
    const helpers = Module._helpers.logistics();
    // const schema = await NodeSchema.findOneById(result.schema);
    const logParams = helpers.logParams(oSchema.schema);
    const serialParams = helpers.logParams(pSchema.schema);
    const node = await Node.findOneById(nSerial.owned_by_node, oSchema);
    const serialNode = await Node.findOneById(
      nSerial.possessed_by_node,
      pSchema
    );

    const serial = serialNode[serialParams('sku')];

    const items = [
      {
        requisition: Requisition.getId(requisition), // pos transaction requisition
        client: User.getId(params.user), // the person getting the course
        client_type: 'personnel', // this is always personnel for this entity, possible values are 'personnel' | 'user'
        scan: node[logParams('sku')], // the sku of the main node3
        temp_schema: StationSchema.getId(oSchema),
        quantity: 1, // duh
        serials: [
          {
            scan: serial,
            serial: {
              id: StationSchema.getId(pSchema), // these are related to the serial values values
              param_name: nSerial.via_param,
              name: pSchema.name,
              title: pSchema.title,
              items: []
            }
          }
        ],
        direct: false
      }
    ];

    const payload = {
      requisition: Requisition.getId(requisition), // might remove
      owner: ownerStation, // primary station
      items: items,
      asset: assetStation,
      via_param: nSerial.via_param,
      station_type: aStation.station_type,
      serial_node: nSerial.possessed_by_node
      // put your workorder id here
    };

    PointOfSale.redirectedTransactions(req, res, payload);

    // res.send(payload);
  },

  scoreUsers: function(users, board) {
    const scoreBoard = board.scoreBoard || {};
    _.each(users, u => {
      u.requisition_score = scoreBoard[User.getId(u)] || 0;
    });
  },

  getBasePersonnelRequistionQuery: function(domain = null, asCount = false) {
    const escape = SqlUtils.escapeUtil();
    const domainQuery = domain ? escape('= %s', this.getId(domain)) : 'IS NULL';
    const selectStatement = asCount
      ? 'COUNT("u"."id")::INT'
      : '"u"."id" as "id", "d"."role" as "role" , "n"."id" as "node"';
    return escape(
      `SELECT %s FROM "user" "u" 
      JOIN "domainrole" "d" ON ("u"."id" = "d"."user") 
      JOIN "nodeschema" "n" ON ("u"."schema" = "n"."id") 
      WHERE "d"."domain" %s AND "n"."personnel" = true `,
      selectStatement,
      domainQuery
    );
  },

  sendZeroCountQueryValues: function() {
    return {
      count: 0,
      personnel: []
    };
  },

  getBasePersonnelCount: async function(req, domain) {
    const escape = SqlUtils.escapeUtil();
    const params = await req.params.all();
    const searchObj = User.textSearchQuery(params.search);
    const search = Domain.bindOrToUser(
      SqlUtils.generateOrQueryString(searchObj.or)
    );
    const baseCountQuery = this.getBasePersonnelRequistionQuery(domain, true);
    const countQuery = escape(`${baseCountQuery} AND (%s)`, search);
    const results = await this.queryAsync(countQuery);
    const [countRow] = results.rows;
    return countRow.count || 0;
  },

  getBasePersonnel: async function(req, domain = null) {
    const escape = SqlUtils.escapeUtil();
    const params = await req.params.all();
    const searchObj = User.textSearchQuery(params.search);
    const search = Domain.bindOrToUser(
      SqlUtils.generateOrQueryString(searchObj.or)
    );
    const sort = { first_name: 'ASC', last_name: 'ASC', employee_id: 'ASC' };
    const sortQuery = Domain.bindSortToUser(SqlUtils.buildSort(sort));
    const baseQuery = this.getBasePersonnelRequistionQuery(domain);
    let query = escape(`${baseQuery} AND (%s) %s `, search, sortQuery);

    const limit = SailsExtensions.limit(req);
    const skip = SailsExtensions.skip(req);
    if (limit) {
      query += escape(' LIMIT %s ', limit);
    }

    if (skip) {
      query += escape(' OFFSET %s ', skip);
    }
    const results = await this.queryAsync(query);
    const ids = results.rows.map(r => r.id);
    return User.find()
      .where({ id: ids })
      .populateAll();
  },
  findSearchUsers: async function(req, domain = null) {
    const count = await this.getBasePersonnelCount(req, domain);
    if (count === 0) {
      return this.sendZeroCountQueryValues();
    }
    const personnel = await this.getBasePersonnel(req, domain);
    return {
      count,
      personnel
    };
  },

  applyBackupUserSearch: async function(req, domain = null) {
    const params = await req.params.all();
    const search = params.search;
    const dRs = await DomainRole.find().where({
      domain: Domain.getId(domain)
    });
    if (!dRs.length) {
      return this.sendZeroCountQueryValues();
    }
    const limit = SailsExtensions.limit(req);
    const skip = SailsExtensions.skip(req);
    const query = {
      id: _.pluck(dRs, 'user'),
      ...User.textSearchQuery(search)
    };
    const count = await User.count().where(query);
    const personnel = await User.find()
      .where(query)
      .sort({ first_name: 'ASC', last_name: 'ASC', employee_id: 'ASC' })
      .limit(limit)
      .skip(skip)
      .populateAll();
    return {
      count,
      personnel
    };
  },

  buildSeachQueryForReqWithFallback: async function(req, domain = null) {
    try {
      return this.findSearchUsers(req, domain);
    } catch (e) {
      sails.log.error(e);
    }
    return this.applyBackupUserSearch(req, domain);
  },

  buildUserScoreBoard: async function(req, scoreboard) {
    const limit = SailsExtensions.limit(req);
    const skip = SailsExtensions.skip(req);
    const limiter = scoreboard.order.splice(skip, skip + limit);
    const users = await User.find()
      .where({
        id: limiter
      })
      .populateAll();
    const uCache = Common.buildBasicItemCache(users);
    const userSearch = [];
    _.each(limiter, l => {
      userSearch.push(uCache[User.getId(l)]);
    });
    return userSearch;
  },

  findQualifiedPersonnel: async function(req, res) {
    const params = await req.params.all();
    if (!params.id) {
      return res.badRequest({
        error: 'Requisition ID required'
      });
    }
    if (!params.tracking) {
      return this.buildTracker(req, res);
    }

    let scoreboard;
    try {
      scoreboard = await CacheStore.get(params.tracking);
      if (!scoreboard) {
        return this.buildTracker(req, res);
      }
    } catch (e) {
      sails.log.error(e);
      return res.send(this.sendZeroCountQueryValues());
    }

    try {
      let personnel;
      let count = 0;
      if (params.search) {
        const personnelObjects = await this.buildSeachQueryForReqWithFallback(
          req,
          res.locals.domain
        );
        count = personnelObjects.count;
        personnel = personnelObjects.personnel;
      } else if (!scoreboard || !_.size(scoreboard.order)) {
        return res.send(this.sendZeroCountQueryValues());
      } else {
        count = _.size(scoreboard.order);
        personnel = await this.buildUserScoreBoard(req, scoreboard);
      }
      this.scoreUsers(personnel, scoreboard);
      res.send({
        personnel,
        count
      });
    } catch (e) {
      sails.log.error(e);
      return res.send(this.sendZeroCountQueryValues());
    }
  },

  pullAudience: async function(station, roles) {
    const reqs = await Requisition.find()
      .where({
        station: Station.getId(station),
        role: roles
      })
      .populate('user');
    if (_.size(reqs)) {
      return [];
    }
    const has = {};
    _.each(reqs, r => {
      has[r.id] = false;
    });
    const site = await Site.thisSiteAsync(station.domain);
    const _everyone = [
      ..._.map(_.pluck(reqs, 'user'), u => {
        return { ...u, type: 'user' };
      }),
      ..._.map(
        _.pluck(
          _.filter(reqs, f => {
            // the don't already have a user account
            return !f.user;
          }),
          'personnel'
        ),
        u => {
          return { ...u, type: 'personnel' };
        }
      )
    ];

    const everyone = [];
    // we make abslutely certain there
    // are no redundancies
    _.each(_everyone, e => {
      if (!has[e.id]) {
        e.id = true;
        everyone.push(e);
      }
    });
    return _.map(everyone, e => {
      return {
        id: e.id,
        type: e.type,
        email: e.email,
        phone: e.phone,
        // -2 for personnel
        role: e.role || -2,
        language: e.preferred_language || site.default_language
      };
    });
  },

  requisitionRole: async (user, station, roleString) => {
    if (sails.models.user.is(user, Roles.USER_ADMIN)) {
      return true;
    }
    let role = roleString;

    if (_.isString(roleString)) {
      role = Roles[roleString];
    }

    if (!role) {
      throw new Error('Role not defined');
    }

    const uId = User.getId(user);
    const sId = Station.getId(station);
    const u = _.clone(user);
    if (sId === -1) {
      return User.is(u, role);
    }

    const s = await Station.findOneById(sId);

    if (!s.members_only) {
      return User.is(u, role);
    }

    const r = await Requisition.findOne({
      station: sId,
      user: uId
    });

    if (_.size(r)) {
      u.role = r.role;
      return User.is(u, role);
    }
    const primary = await Requisition.findOne({
      primary: true,
      user: uId
    });

    if (!_.size(primary)) {
      return false;
    }

    const children = await Station.children(Station.getId(primary.station));
    const found = _.filter(children, c => c.id === sId);
    if (_.size(found)) {
      u.role = primary.role;
      return User.is(u, role);
    } else {
      return false;
    }
  },

  beforeCreate: async (values, next) => {
    await unsetPrimary(values);
    const jtID = JobTemplate.getId(values.jobtemplate);
    if (jtID) {
      try {
        const jt = await JobTemplate.findOneById(jtID);
        values.role = (jt || {}).default_role || Roles.REPORTER;
        values.category_weight = jt.category_weight;
      } catch (e) {
        return next(e);
      }
    }
    next();
  },

  beforeUpdate: async (values, next) => {
    await unsetPrimary(values);
    if (values.id) {
      const req = await Requisition.findOneById(values.id);
      if (values.user) {
        const uId = User.getId(values.user);
        const requId = User.getId(req.user);
        if (!requId || requId !== !uId) {
          values.started_on = TimeUtils.isoFormattedDate(now_);
        }
        // here we auto update the title for the personnel profiles
        // remove false
        if (req.jobdescription && req.personnel && req.primary) {
          const u = await User.findOneById(User.getId(values.user));
          const description = await JobDescription.findOneById(
            JobDescription.getId(req.jobdescription)
          );
          if (u.title !== description.title) {
            u.title = description.title;
            u.save(err => {
              if (err) {
                sails.log.error(err);
              }
            });
          }
        }
      }
      if (values.jobtemplate && !req.jobtemplate) {
        const jt = await JobTemplate.findOneById(
          JobTemplate.getId(values.jobtemplate)
        );
        values.category_weight = jt.category_weight;
      }
    }
    next();
  },

  filteredByConditons: function(requirement, search) {
    const condition = requirement.condition;
    const step = TimeUtils.timeCategoryInDays(requirement.time_category);
    const days = step * requirement.time;
    const saved = [];
    switch (condition) {
      case 'time_in':
        _.each(search, s => {
          if (s.days >= days) {
            saved.push(s);
          }
        });
        return saved;
      case 'satisfactory':
        return _.where(search, { satisfied: true });
      case 'complete':
        return _.where(search, { complete: true });
      default:
        return [];
    }
  },

  queryActions: function(action, searchField) {
    const byCat = (payload, type) => {
      const template = payload.template;
      const rank = template.requisition_category_weight;
      const requirement = payload.requirement;
      const user = payload.user;
      const searchThreshold = 5;
      let min = rank - searchThreshold;
      const delta = min < 0 ? Math.abs(min) : 0; // - 2
      const removal = 100 / (searchThreshold - delta);
      min = min < 0 ? 0 : min;
      const max = rank - 1;
      let score = 100;
      const selector = {
        category: 'requisition_category',
        speciality: 'requisition_sub_category'
      };
      const subCategories = _.where(searchField, {
        [type]: Variable.getId(template[selector[type]])
      });

      for (let j = max; j >= min; j--) {
        const search = _.where(subCategories, {
          user: User.getId(user),
          rank: j
        });

        const filtered = this.filteredByConditons(requirement, search, action);
        if (_.size(filtered)) {
          break;
        } else {
          score -= removal;
        }
      }
      if (score < 1) {
        score = 0;
      }
      return Math.floor(score);
    };

    const valueOneCondition = (requirement, node) => {
      const name = requirement.name;
      const condition = requirement.condition;
      switch (condition) {
        case 'variable':
          return Variable.getId(node[name]);
        default:
          return node[name];
      }
    };

    const actions = {
      category: async payload => {
        return byCat(payload, 'category');
      },
      speciality: async payload => {
        return byCat(payload, 'speciality');
      },
      requisition: async payload => {
        const requirement = payload.requirement;
        const attr = requirement.attr;
        const user = payload.user;
        const found = _.where(searchField, {
          jobtemplate: attr,
          user: User.getId(user)
        });
        const filtered = this.filteredByConditons(
          requirement,
          found,
          'requisition'
        );
        return _.size(filtered) ? 100 : 0;
      },
      rank: () => {
        //
      },
      attr: async payload => {
        //
        const requirement = payload.requirement;
        const schema = requirement.attr;
        const value = requirement.value;
        const user = payload.user;
        try {
          const ns = await NodeSchema.findOneById(schema);
          if (!ns) {
            throw new Error('errors.INVALID_NODE_SCHEMA');
          }
          const nodes = await Node.findNodes(
            {
              where: {
                observer: User.getId(user)
              }
            },
            ns
          );
          if (!_.size(nodes)) {
            throw new Error('errors.NO_VALID_USER_DATA');
          }
          let has = false;
          for (let i = 0; i < _.size(nodes); i++) {
            const node = nodes[i] || {};
            if (valueOneCondition(requirement, node) === value) {
              has = true;
              break;
            }
          }
          return has ? 100 : 0;
        } catch (e) {
          sails.log.error(e);
          return 0;
        }
      }
    };

    return async payload => {
      return ((await actions[action]) || _.noop)(payload);
    };
  },

  pullPotentialCandidate: async function(weight, jobTemplateId, orgs, domain) {
    const escape = SqlUtils.escapeUtil();
    const domainParam = SqlUtils.formatDomainQuery(domain);
    // supports domain and a user cannot be selected for a req previously held
    const oq = `
    SELECT 
      "u"."id" AS "user",
      "jt"."id" AS "jobtemplate",
      "ct"."organization" AS "org",
      "jt"."requisition_category" AS "category",
      "jt"."requisition_sub_category" AS "speciality",
      "jt"."requisition_category_weight" AS "rank",
      bool_or( "req"."complete" ) AS "complete",
      bool_or( "req"."satisfied" ) AS "satisfied",
      SUM (
        COALESCE (
          EXTRACT (DAY FROM (
            COALESCE ("req"."completed_on", now())) - "req"."started_on"
            )
          ,0)
        ) AS "days" 
    FROM
      "careertrack" "ct" 
      JOIN "jobtemplate" "jt" ON ("ct"."jobtemplate" = "jt"."id")
      JOIN "requisition" "req" ON ( "req"."jobtemplate" = "jt"."id" )
      JOIN (
        SELECT "_u".* 
        FROM "domainrole" "dr" 
        JOIN "user" "_u" ON ( "dr"."user" = "_u"."id" ) 
        WHERE "dr".%s
      ) "u" ON ( "u"."id" = "req"."user") 
    WHERE
      "jt"."requisition_category_weight" <= %s 
      AND "req"."personnel" = TRUE
      AND "jt"."id" <> %s
      AND "ct"."organization" %s  
    GROUP BY 1,2,3,4,5 
    ORDER BY "rank" DESC, "category", "speciality";
    `; // Query for the case where we have an organization list

    const nOq = `
    SELECT
      "u"."id" as "user",
      "jt"."id" AS "jobtemplate",
      "jt"."requisition_category" as "category",
      "jt"."requisition_sub_category" as "speciality",
      "jt"."requisition_category_weight" AS "rank",
      bool_or("req"."complete") as "complete",
      bool_or("req"."satisfied") as "satisfied",
      SUM (
        COALESCE (
          EXTRACT (DAY FROM (
            COALESCE ("req"."completed_on", now())) - "req"."started_on"
            )
          ,0)
        ) AS "days" 
    FROM
      "jobtemplate" "jt"
      JOIN "requisition" "req" ON ( "req"."jobtemplate" = "jt"."id" )
      JOIN (
    		SELECT "_u".* 
        FROM "domainrole" "dr" 
        JOIN "user" "_u" ON ("dr"."user" = "_u"."id") 
        WHERE "dr".%s
      ) "u" ON ( "u"."id" = "req"."user" )
    WHERE
      "jt"."requisition_category_weight" <= %s
      AND "req"."personnel" = true
    	AND "jt"."id" <> %s
    GROUP BY 1,2,3,4,5
    ORDER BY "rank" DESC, "category", "speciality";
    `; // Query for the case where we DO NOT have an organization list

    let query = '';
    if (_.size(orgs)) {
      const orgsInStatement = SqlUtils.setInString(orgs);
      query = escape(oq, domainParam, weight, jobTemplateId, orgsInStatement);
    } else {
      query = escape(nOq, domainParam, weight, jobTemplateId);
    }
    const results = await Model.queryAsync(query);
    return results.rows;
  },

  recursiveRules: async function(template, searchField, user) {
    const requirements = template.requirements;
    if (!_.size(requirements)) {
      return 100;
    }
    // const scoreCount = _.size(requirements); // 3;
    // let totalScore = 0;
    let max = 0;
    /**
     * This is an OR condition
     */
    for (let i = 0; i < _.size(requirements); i++) {
      const _requirements = requirements[i];
      const reqSize = _.size(_requirements);
      let localScore = 0;
      /**
       * This is an ANDING condition
       **/
      for (let j = 0; j < _.size(_requirements); j++) {
        const requirement = _requirements[j];
        const process = this.queryActions(requirement.action, searchField);
        const score = await process({
          template: template,
          user: user,
          requirement: requirement
        });
        localScore += score;
        // if (score === 100) {
        //   max = score;
        //   // break;
        // } else if (score > max) {
        //   max = score;
        // }
      }
      const current = Math.ceil(localScore / reqSize);
      if (current > max) {
        max = current;
      }
    }
    return max;
  },

  pullUsersFromOrganization: async function(candidateIds, orgs, requisition) {
    const template = requisition.jobtemplate || {};
    if (template.requisition_category_weight == null || !_.size(orgs)) {
      return await User.find().where({
        id: candidateIds
      });
    }
    const escape = SqlUtils.escapeUtil();
    const query = `SELECT DISTINCT
      "u"."id",
      "u"."first_name",
      "b"."id" AS "badge",
      "bw"."weight" AS "rank" 
    FROM
      "public"."user" "u"
      LEFT JOIN "badge" "b" ON "u"."rank_badge" = "b"."id"
      LEFT JOIN "badgeweight" "bw" ON "b"."id" = "bw"."badge" 
    WHERE
      (
        "u"."id" %s 
        OR ("u"."specialty" = %s AND "u"."trade" = %s)
      ) 
      AND "bw"."organization" %s
      AND "bw"."weight" <= %s ;`;

    const q = escape(
      query,
      _.size(candidateIds) ? SqlUtils.setInString(candidateIds) : '!=0',
      Model.getId(template.requisition_category),
      Model.getId(template.requisition_sub_category),
      SqlUtils.setInString(orgs),
      template.requisition_category_weight
    );
    const candiates = await Model.queryAsync(q);
    const users = await User.find().where({
      id: _.unique(_.pluck(candiates.rows, 'id'))
    });

    return users;
  },

  processCandidates: async function(data) {
    const tracking = data.tracking;
    const id = data.id;
    const socket = data.socket;
    const domain = Domain.getId(data.domain);
    const requisition = await Requisition.findOneById(id).populateAll();

    const updateSocket = (percent, tracking) => {
      if (tracking) {
        sails.sockets.broadcast(socket, tracking, {
          percent_complete: percent,
          tracking: tracking
        });
      }
    };

    const buildSendObject = () => {
      const send = {
        scoreBoard: {},
        order: []
      };
      return send;
    };

    const buildSend = () => {
      const send = buildSendObject();
      const scored = _.sortBy(users, 'score').reverse();
      _.each(scored, s => {
        send.scoreBoard[s.id] = s.score;
        send.order.push(s.id);
      });
      return send;
    };

    const store = async (send, tracking) => {
      if (tracking) {
        await CacheStore.set(tracking, JSON.stringify(send));
      }
      return send;
    };

    const sendNothing = async () => {
      const send = buildSendObject();
      await store(send, tracking);
      updateSocket(100, tracking);
      return send;
    };

    if (!requisition || !requisition.jobtemplate) {
      return await sendNothing();
    }

    const template = requisition.jobtemplate;
    const orgs = await CareerTrack.getOrgIdsOnTemplate(template);
    const candidates = await this.pullPotentialCandidate(
      requisition.jobtemplate.requisition_category_weight || 0,
      JobTemplate.getId(requisition.jobtemplate),
      orgs,
      domain
    );
    const uIds = _.unique(_.pluck(candidates, 'user'));
    if (!_.size(uIds)) {
      return await sendNothing();
    }

    const users = await this.pullUsersFromOrganization(uIds, orgs, requisition);
    const totalCount = _.size(users);
    if (!totalCount) {
      return await sendNothing();
    }

    const chunkPercent = 0.05;
    const chuckCount = Math.ceil(totalCount * chunkPercent);
    for (let i = 0; i < totalCount; i++) {
      const user = users[i];
      const processedPercent = Math.round(((i + 1) / totalCount) * 100);
      const score = await this.recursiveRules(template, candidates, user);
      user.score = score;
      if (i % chuckCount === 0 || processedPercent >= 100) {
        if (processedPercent >= 100) {
          const send = buildSend();
          await store(send, tracking);
          updateSocket(processedPercent, tracking);
          return send;
        } else {
          updateSocket(processedPercent, tracking);
          sails.log.debug('PROCESSING Cadidates at::', processedPercent);
        }
      }
    }

    return {};
  },

  _processors: [
    {
      name: 'findQualifiedCandidates',
      process: async function(job) {
        const data = job.data;
        const results = await Requisition.processCandidates(data);
        return results;
      },

      stats: Utils.stats({
        completed: function(job, result) {
          sails.log.debug('Jobs.findQualifiedCandidates::COMPLETE::', result);
        },
        failed: function(job, err) {
          sails.log.error('Jobs.findQualifiedCandidates::ERR::', err);
        }
      })
    }
  ]
};

async function unsetPrimary(values) {
  if (values.id && values.user) {
    const r = await Requisition.findOneById(values.id);
    const user = values.user || r.user;
    const personnel = r.personnel;
    const primary = r.primary;
    // then we have an update situation
    if (!primary || !user) {
      return;
    }

    if (personnel) {
      const reqs = await Requisition.find({
        user: User.getId(user),
        primary: true,
        personnel: true,
        archived: false
      });

      await Requisition.update(
        {
          user: User.getId(user),
          primary: true,
          personnel: true,
          archived: false
        },
        {
          user: null,
          qualification: 0,
          completed: false,
          satisfied: false,
          locked: false,
          started_on: null,
          completed_on: null,
          completed_by: null,
          satisfied_by: null,
          assigned_by: null
        }
      );

      const clones = [];
      _.each(reqs, r => {
        delete r.id;
        delete r.createdAt;
        delete r.updatedAt;
        r.completed_on = r.completed_on || TimeUtils.isoFormattedDate(now_);
        r.complete = true;
        clones.push({
          ...r,
          archived: true
        });
      });
      if (_.size(clones)) {
        await Requisition.create(clones);
      }
    } else {
      await Requisition.update(
        {
          user: User.getId(user)
        },
        {
          primary: false
        }
      );
    }
  }
}
