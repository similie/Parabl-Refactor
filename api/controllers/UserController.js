/**
 * UserController
 *
 * @description :: Server-side logic for managing users
 * @help        :: See http://sailsjs.org/#!/documentation/concepts/Controllers
 */

const sailsFind = require('../../node_modules/sails/lib/hooks/blueprints/actions/find');
const sailsFindOne = require('../../node_modules/sails/lib/hooks/blueprints/actions/findOne');
const sailsUpdate = require('../../node_modules/sails/lib/hooks/blueprints/actions/update');

const validator = require('validator');
const SailsExtensions = require('../services/SailsExtensions');

module.exports = {
  clearLanguage: async function(req, res) {
    const params = req.params.all();
    if (!params.id) {
      return res.badRequest();
    }
    const where = `"id" = ${params.id};`;
    const user = await User.setGlobalMeta(
      {
        clear_language: false
      },
      where
    );
    return res.send(user.pop());
  },
  /**
   * Returns the ids of the people in with secific query
   * conditions
   * @todo implement
   */
  people: async function(req, res) {
    const params = req.params.all();
    sails.log.debug('User.peope CONTROLLER', params);
    res.send([]);
  },

  terminateSession: async function(req, res) {
    if (req.method !== 'POST' || !User.is(req.user, Roles.USER_ADMIN)) {
      return res.forbidden({ error: 'Route unavailable' });
    }

    const params = req.params.all();
    if (!params.id) {
      return res.badRequest({ error: 'Invalid Request. ID required' });
    }
    const user = await User.findOneById(params.id);
    if (!user) {
      return res.badRequest({
        error: 'Invalid Request. A valid user is required'
      });
    }

    user.socketMessage(Const.sockets.FORCE_LOGOUT);

    try {
      await User.killSingleSession(user);
    } catch (e) {
      sails.log.error(e);
      return res.badReqest({ error: e });
    }

    res.send({ terminated: true });
  },

  localPasswordChange: async function(req, res) {
    if (req.method !== 'POST' || !User.is(req.user, Roles.USER_ADMIN)) {
      return res.forbidden({ error: 'Route unavailable' });
    }

    const params = req.params.all();
    if (!params.id) {
      return res.badRequest({ error: 'Invalid Request. ID required' });
    }
    if (!params.password) {
      return res.badRequest({
        error: 'Invalid Request. A valid password is required'
      });
    }
    const user = await User.findOneById(params.id);
    if (!user) {
      return res.badRequest({
        error: 'Invalid Request. A valid user is required'
      });
    }
    user.force_reset = true;
    await User.saveAsync(user);
    const passport = await User.resetLocalPassword(user, params.password);
    if (!passport) {
      return res.serverError();
    }
    User.passwordReset(
      user.username,
      res.locals.siteData,
      Const.ADMIN_TOKEN_GENERATION /* expire 7 days */,
      err => {
        if (err) {
          sails.log.error(err);
        }
      }
    );

    return res.send(user);
  },

  build: async function(req, res) {
    if (req.method !== 'POST' || !User.is(req.user, Roles.USER_ADMIN)) {
      return res.forbidden({
        error: 'This route is only availbe to User Administrators or higher'
      });
    }

    const params = req.params.all();
    if (!params.id) {
      return res.badRequest({ error: 'Invalid Request. ID required' });
    }
    if (!params.password) {
      return res.badRequest({
        error: 'Invalid Request. A valid password is required'
      });
    }
    const user = await User.findOneById(params.id);
    if (!user || !user.email) {
      return res.badRequest({
        error: 'Invalid Request. A valid user is required'
      });
    }
    if (!user.username) {
      try {
        user.username = await user.buildUsername();
      } catch (e) {
        sails.log.error(e);
        return res.badRequest(e);
      }
    }
    user.user_access_disabled = false;
    user.force_reset = true;
    await User.saveAsync(user);
    try {
      const _user = await User.finishActivation(params, user, err => {
        if (err) {
          throw new Error(err);
        }
      });

      User.passwordReset(
        _user.username,
        res.locals.siteData,
        7 /* expire 7 days */,
        err => {
          if (err) {
            sails.log.error(err);
          }
        }
      );

      res.send(_user);
    } catch (e) {
      res.serverError(e);
    }
  },

  createUsername: async function(req, res) {
    const params = req.params.all();
    if (!params.id) {
      return res.badRequest({ error: 'Invalid Request. ID required' });
    }
    const user = await User.findOneById(params.id);
    if (!user || !user.email) {
      return res.badRequest({
        error: 'Invalid Request. A valid user is required'
      });
    }

    if (user.username) {
      return res.send(user.username);
    }
    try {
      const username = await user.buildUsername();
      return res.send(username);
    } catch (e) {
      sails.log.error(e);
      return res.badRequest(e);
    }
  },
  personnel: async function(req, res) {
    const params = req.params.all();
    if (!params.station) {
      return res.badReqest({ errors: 'Station ID Required' });
    }

    const common = _.filter(
      await Station.commonStationTags(params.station),
      f => !!f
    );
    const reqs = await Requisition.find().where({
      station: common,
      user: { '!': null }
    });
    const persons = _.pluck(reqs, 'user');
    const query = {
      id: persons,
      or: [
        { first_name: { contains: params.search } },
        { last_name: { contains: params.search } },
        { employee_id: { contains: params.search } },
        { email: { contains: params.search } },
        { title: { contains: params.search } }
      ]
    };
    const personnel = await User.find().where(query);
    res.send(personnel);
  },

  convert: async function(req, res) {
    if (req.method !== 'POST') {
      return res.badRequest({ error: 'Request unavailable' });
    }

    const params = req.params.all();
    if (!params.id) {
      return res.badRequest({ error: 'A user id is required' });
    }
    const role = params.role || Roles.REPORTER;
    const domain = res.locals.domain;

    try {
      const user = await User.convertToSiteUser(
        params.id,
        domain,
        role,
        req.user
      );

      res.send(user);
    } catch (e) {
      sails.log.error(e);
      res.badRequest({ error: e.message });
    }
  },

  is: async function(req, res) {
    const params = req.params.all();
    const domain = res.locals.domain;
    if (!params.identifier || !params.password) {
      return res.badRequest({ error: 'Credentials Required' });
    }
    const isEmail = validator.isEmail(params.identifier);

    const user = await User.findOne({
      [isEmail ? 'email' : 'username']: params.identifier
    });
    if (!user) {
      return res.badRequest({ error: 'User not found' });
    }
    const passport = await Passport.findOne({
      protocol: 'local',
      user: user.id,
      inactive: false
    });
    if (!passport) {
      return res.badRequest({ error: 'Active account not found' });
    }
    const isValid = await passport.validatePassword(params.password);
    if (!isValid) {
      return res.badRequest({ error: 'Invalid Credentials' });
    }

    if (!params.is) {
      res.send(user);
    }

    let is = params.is;
    let notFound = true;
    if (!Utils.isNumeric(params.is)) {
      for (const k in Roles) {
        const n = Roles[k];
        if (k === is && Utils.isNumeric(n)) {
          notFound = false;
          is = n;
          break;
        }
      }
    }

    if (notFound && !Utils.between(is, Roles.ANONYMOUS, Roles.SIMILIE_ADMIN)) {
      return res.badRequest({ error: 'Invalid Role' });
    }

    user.role = await User.getRole(user, domain);
    if (User.is(user, is)) {
      return res.send(user);
    }

    res.badRequest({ error: 'User is not a the required role' });
  },

  update: async function(req, res) {
    const domain = res.locals.domain;
    const params = req.params.all();
    const pk = SailsExtensions.primaryKey(req);
    let user;
    try {
      user = await User.findOneById(pk);
    } catch (e) {
      sails.log.error(e);
      return res.negotiate(e);
    }

    if (params.role && params.role !== user.role) {
      try {
        // the front end won't let us set a domain admin under the
        // non-null domain
        if (domain && !User.is(params, Roles.DOMAIN_ADMIN)) {
          User.addDomainMembership(params, domain, params.role);
        } else if (
          !domain &&
          params.role !== params.site_role &&
          !User.is(params, Roles.DOMAIN_ADMIN)
        ) {
          // we need to update the site role too
          Utils.forceRequestParameters(req, {
            model: 'user',
            query: [{ type: 'integer', key: 'site_role', value: params.role }]
          });
          await User.addDomainMembership(params, Const.NULL, params.role);
        } else if (
          !domain &&
          params.role !== params.site_role &&
          User.is(params, Roles.DOMAIN_ADMIN)
        ) {
          // we need to update the site role too
          Utils.forceRequestParameters(req, {
            model: 'user',
            query: [{ type: 'integer', key: 'site_role', value: params.role }]
          });
        }
      } catch (e) {
        sails.log.error(e);
      }
    }

    sailsUpdate(req, res);
  },

  findDefault: function(req, res) {
    sailsFind(req, res);
  },

  domain: async function(req, res) {
    const params = req.params.all();
    const user = req.user;
    const method = req.method;
    if (
      (user && !User.is(user, Roles.DOMAIN_ADMIN)) ||
      !Utils.leastOne(method, 'post', 'delete', 'POST', 'DELETE', 'get', 'GET')
    ) {
      return Utils.sendErrorCode(res, Utils.setErrorCode(Const.code.FORBIDDEN));
    }
    let altered;
    try {
      if (Utils.leastOne(method, 'post', 'POST')) {
        altered = await User.addDomainMembership(
          params.user,
          params.domain,
          params.role
        );
        const alteredUser = altered.user;
        Utils.publishUpdates(User, req, alteredUser);
      } else if (Utils.leastOne(method, 'get', 'GET')) {
        const all = !params.domain;
        const cParams = SailsExtensions.params(req);
        delete cParams.user;
        delete cParams.domain;
        const domain = params.domain === -1 ? Const.NULL : params.domain;
        let users;
        if (cParams.id) {
          const hold = await User.findOne({ id: cParams.id }).populateAll();
          if (!hold) {
            return Utils.sendErrorCode(
              res,
              Utils.setErrorCode(Const.code.BAD_REQUEST)
            );
          }
          users = [hold];
        } else {
          cParams.or = [
            { site_role: Const.NULL },
            { site_role: { '<': Roles.DOMAIN_ADMIN } }
          ];
          users = await User.find()
            .limit(SailsExtensions.limit(req))
            .skip(SailsExtensions.skip(req))
            .sort(SailsExtensions.sort(req))
            .where(cParams)
            .populateAll();
        }
        Utils.subscribeModels(User, req, users);
        if (all) {
          altered = await User.getDomainRoles(users);
        } else {
          try {
            altered = await User.getDomainMembers(users, domain);
          } catch (e) {
            res.send(Utils.sendErrorCode(res, e));
          }
        }
      } else {
        altered = await User.removeDomainMembership(params.user, params.domain);
        Utils.publishUpdates(User, req, altered);
      }
    } catch (e) {
      return Utils.sendErrorCode(res, e);
    }
    return res.send(altered);
  },

  current: async function(req, res) {
    const user = req.user;
    if (!user) {
      return res.send(user);
    }

    (user || { easterEgg: _.noop }).easterEgg();
    Utils.subscribeModels(User, req, [user]);
    await UserLicense.verify(user, res.locals.siteData);
    res.send(user);
  },

  domainCount: async function(req, res) {
    const count = await Domain.getMemberCountForController(req);
    const total = { total: count || 0 };
    return res.send(total);
  },

  count: async function(req, res) {
    const domain = res.locals.domain;
    const user = req.user;
    const count = { total: 0 };
    const cParams = SailsExtensions.params(req);
    if (domain != null) {
      // if error, we fallback to buggy solution
      try {
        return this.domainCount(req, res);
      } catch (e) {
        sails.log.error(e);
      }
      cParams.role = { '<=': Roles.DOMAIN_ADMIN };
    }
    delete cParams.last_domain;
    cParams.site_role = { '<=': user.site_role };
    const c = await User.count().where(cParams);
    count.total = c;
    res.send(count);
  },

  find: async function(req, res) {
    const user = req.user;
    const domain = user.last_domain;
    // If an `id` param was specified, use the findOne blueprint action
    // to grab the particular instance with its primary key === the value
    // of the `id` param.   (mainly here for compatibility for 0.9, where
    // there was no separate `findOne` action)
    if (SailsExtensions.primaryKey(req)) {
      return sailsFindOne(req, res);
    }

    if (!User.is(user, Roles.DOMAIN_ADMIN)) {
      return sailsFind(req, res);
    }

    const cParams = _.clone(SailsExtensions.params(req));
    delete cParams.last_domain;
    let users;
    if (domain == null) {
      cParams.site_role = { '<=': user.site_role };
      users = await User.find()
        .limit(SailsExtensions.limit(req))
        .skip(SailsExtensions.skip(req))
        .sort(SailsExtensions.sort(req))
        .populateAll()
        .where(cParams);
    } else {
      users = await Domain.getMembers(user, domain, req);
    }
    if (_.size(users)) {
      Utils.subscribeModels(User, req, users);
      await User.setActivities(users);
    }
    res.ok(users);
  },

  create: async function(req, res) {
    const params = req.params.all();
    const demoUser = params.demo || false;
    delete params.demo;
    const user = req.user;
    const domain = res.locals.domain;
    let maxUsers;
    let count;
    if (
      res.locals.siteData &&
      res.locals.siteData.max_users &&
      User.is(user, Roles.SIMILIE_ADMIN)
    ) {
      maxUsers = res.locals.siteData.max_users;
      count = await User.count().where({
        last_domain: Domain.getId(domain),
        role: { '<': Roles.DOMAIN_ADMIN }
      });
      if (count >= maxUsers) {
        return res.badRequest('warning.USER_SEATS_FILLED');
      }
    }

    try {
      Utils.itsRequired(params);
    } catch (e) {
      return res.badRequest(e);
    }

    // just in case this happens. Shouldn't from the ui
    if (User.is(params, Roles.DOMAIN_ADMIN)) {
      delete params.last_domain;
    }

    let createdUser;
    try {
      createdUser = await User.createWithDomain(params, domain);
    } catch (e) {
      return res.serverError(e);
    }

    Utils.subscribeModels(User, req, [createdUser]);

    if (!createdUser.user_access_disabled && !demoUser) {
      try {
        createdUser.activateEmail(req, res, _.noop);
      } catch (e) {
        sails.log.error(e);
      }
    }

    res.send(createdUser.toJSON());
  },

  avatar: function(req, res) {
    const params = req.params.all();
    if (!params.avatar) {
      return res.badRequest('errors.INVALID_MODEl');
    }

    if (!params.user) {
      return res.badRequest('errors.INVALID_USER');
    }

    User.findOneById(User.getId(params.user)).exec((err, user) => {
      if (err) {
        return res.serverError(err);
      }

      user.avatar = params.avatar;

      user.save(err => {
        if (err) {
          return res.serverError(err);
        }
        res.send(user);
      });
    });
  },

  pdf: async function(req, res) {
    const params = req.params.all();
    const userId = params.id;
    const config = res.locals.siteData;
    const language = Translates.getLanguage(req, res);

    if (!userId) {
      return res.badRequest({ error: 'Invalid Request. ID required' });
    }

    Jobs.pdf.add({ id: userId, config, language });

    res.ok();
  },

  search: async function(req, res) {
    const params = req.params.all();
    const where = Utils.params(req);
    if (!where.search) {
      return this.find(req, res);
    }
    try {
      const users = await User.searchUsersByString(params);
      return res.send(users);
    } catch (e) {
      sails.log.error(e);
      res.send({ error: e });
    }
  },

  domainMemberships: async function(req, res) {
    const params = req.params.all();
    try {
      if (params.not) {
        // id is for the user being search
        const domains = await Domain.findDomainWhereMemberIsNot(params.id);
        return res.send(domains);
      }

      const domains = await Domain.findDomainWhereMemberIs(params.id);
      return res.send(domains);
    } catch (e) {
      return res.negotiate(e);
    }
  },

  hasEmail: async function(req, res) {
    const params = req.params.all();
    const email = params.email;
    const user = await User.find().where({ email });
    const valid = !user.length;
    res.send({ valid });
  },

  hasPhone: async function(req, res) {
    const params = req.params.all();
    const phone = params.phone.replace(/\D/g, '');
    const user = await User.find().where({ phone: { contains: phone } });
    const valid = !user.length;
    res.send({ valid });
  }
};
