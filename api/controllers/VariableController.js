/**
 * VarialbleController
 *
 * @description :: Server-side logic for managing varialbles
 * @help        :: See http://sailsjs.org/#!/documentation/concepts/Controllers
 */

const actionUtil = require('../../node_modules/sails/lib/hooks/blueprints/actionUtil');
const sailsUpdate = require('../../node_modules/sails/lib/hooks/blueprints/actions/update');
const sailsCreate = require('../../node_modules/sails/lib/hooks/blueprints/actions/create');
const sailsFind = require('../../node_modules/sails/lib/hooks/blueprints/actions/find');
const User = require('../models/User');

module.exports = {
  create: function(req, res) {
    const params = req.params.all();
    if (params.key === Translates.translateIdentity) {
      sails.sockets.blast('variable_change_event', {
        event: 'create',
        data: params
      });
    }
    return sailsCreate(req, res);
  },

  update: async function(req, res) {
    const params = req.params.all();
    const domain = res.locals.domain;

    if (params.key === Translates.translateIdentity) {
      sails.sockets.blast('variable_change_event', {
        event: 'update',
        data: params
      });
      const user = req.user;
      const where = 'AND "user_access_disabled" = FALSE;';
      User.setGlobalMeta(
        {
          clear_language: true
        },
        where,
        user
      );
    }
    if (!params.domain && !Utils.hasSize(domain)) {
      return sailsUpdate(req, res);
    }
    let foundVar = await Variable.findOneById(params.id);
    // we are updating a variable that
    // that we intend to
    if (foundVar && foundVar.domain == Domain.getId(domain)) {
      return sailsUpdate(req, res);
    }

    delete params.id;
    params.domain = Domain.getId(domain);
    params.locked = false;
    let newInstance;

    try {
      newInstance = await Variable.create(params);
    } catch (e) {
      sails.log.error(e);
      return res.negotiate(e);
    }

    if (req._sails.hooks.pubsub) {
      if (req.isSocket) {
        Model.subscribe(req, newInstance);
        Model.introduce(newInstance);
      }
      // Make sure data is JSON-serializable before publishing
      const publishData = _.isArray(newInstance)
        ? _.map(newInstance, function(instance) {
            return instance.toJSON();
          })
        : newInstance.toJSON();
      Model.publishCreate(publishData, !req.options.mirror && req);
    }
    // Send JSONP-friendly response if it's supported
    res.created(newInstance);
  },

  find: function(req, res) {
    const params = req.params.all();
    if (params.id) {
      return sailsFind(req, res);
    }
    const domain = res.locals.domain;
    const surveySite = (res.locals.siteData || {}).survey;

    if (surveySite) {
      const whereV = actionUtil.parseCriteria(req);
      delete whereV.domain;
      if (whereV.where) {
        delete whereV.where.domain;
      }
      return Variable.find()
        .where(whereV)
        .limit(actionUtil.parseLimit(req))
        .skip(actionUtil.parseSkip(req))
        .sort(actionUtil.parseSort(req))
        .then(function(variables) {
          res.send(variables);
        })
        .catch(Utils.serverError(res));
    }

    // boolean for where
    let where = Utils.hasSize(params.where);
    let or = where ? Utils.hasSize(params.where.or) : Utils.hasSize(params.or);
    if (domain && !or) {
      let dId = Model.getId(domain);
      let inject = [{ domain: null }, { domain: dId }];
      if (where) {
        params.where.or = inject;
        delete params.where.domain;
      } else {
        params.or = inject;
      }
      // catch all, just in case
      delete params.domain;
    }

    _.each(['limit', 'skip', 'sort'], function(key) {
      delete params[key];
    });

    Variable.find()
      .where(params)
      .limit(actionUtil.parseLimit(req))
      .skip(actionUtil.parseSkip(req))
      .sort(actionUtil.parseSort(req))
      .then(function(variables) {
        Variable.mergeVariables(variables, domain)
          .then(function(vars) {
            Utils.subscribeModels(Variable, req, vars);
            res.send(vars);
          })
          .catch(function(err) {
            sails.log.error(err);
            res.serverError(err);
          });
      })
      .catch(Utils.serverError(res));
  },

  getKeys: async function(_, res) {
    const query = 'SELECT key FROM variable GROUP BY key';
    const data = await Variable.queryAsync(query);

    const variables = (data.rows || [])
      .map(item => item.key)
      .filter(item => item);

    res.send(variables);
  }
};
