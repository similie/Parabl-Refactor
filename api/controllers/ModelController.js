/**
 * ModelController
 *
 * @description :: Server-side logic for managing models
 * @help        :: See http://sailsjs.org/#!/documentation/concepts/Controllers
 */
const plural = require('pluralize');
const { TimeUtils, SqlUtils } = require('similie-api-services');
const { ModelActions } = require('../model-utilities/model/model-actions');
const stationcontroller = require('./StationController');
const escape = SqlUtils.escapeUtil();

module.exports = {
  queue: async function(req, res) {
    try {
      const actions = new ModelActions(req, res);
      await actions.buildAction();
    } catch (e) {
      res.badRequest({ error: e });
    }
  },

  parent_trap: function(req, res) {
    if (!User.is(req.user, Roles.SIMILIE_ADMIN)) {
      return res.forbidden();
    }
    const params = req.params.all();

    if (!params.model) {
      return res.badRequest();
    }

    const _mod = plural(params.model, 1);
    const model = sails.models[_mod];
    if (!model) {
      return res.badRequest('MODEL NOT FOUND');
    }
    const actionUtil = Utils.actionUtil();
    const where = actionUtil.parseCriteria(req);
    const parentParam = params.parent || 'parent';
    delete where.model;
    delete where.parent;
    model
      .find()
      .where(where)
      .then(Model.parentTrap(req, res, parentParam));
  },

  tracker: function(req, res) {
    const params = req.params.all();
    const findCodeBody = function(code) {
      Tracker.findOne({
        code: code
      }).exec((err, found) => {
        if (err) {
          return res.serverError(err);
        }

        if (!found) {
          Tracker.create({
            code: code
          }).exec((err, code) => {
            if (err) {
              return res.serverError(err);
            }
            return res.send(code);
          });
        } else {
          const newCode = Tracker.buildRandomId(params.type, params.length);
          findCodeBody(newCode);
        }
      });
    };

    const code = Tracker.buildRandomId(params.type, params.length);
    findCodeBody(code);
  },

  orm_schemas: async (req, res) => {
    const models = [
      'station',
      'tag',
      'message',
      'variable',
      'messaging',
      'nodeschema',
      'stationschema',
      'nodestory',
      'storyboard',
      'nodesurvey',
      'user',
      'domain',
      'district',
      'geofeature',
      'activity',
      'report',
      'icon',
      'useraccess',
      'requisition',
      'earlywarning'
    ];

    const schemas = {};
    schemas.region = {
      districts: {
        type: 'array'
      },
      center: {
        type: 'json'
      },
      id: {
        type: 'string'
      },
      code: {
        type: 'string'
      }
    };

    _.each(models, model => {
      const mod = sails.models[model];
      const attr = mod._attributes;
      attr[Geo.getGeoPoint()] = {
        type: 'json'
      };
      schemas[model] = attr;
    });

    schemas.nodes = {};

    let ns;
    try {
      ns = await NodeSchema.find();
    } catch (e) {
      sails.log.error();
      return res.serverError(e);
    }
    _.each(ns, s => {
      const list = Node.orm(s.schema);
      schemas.nodes[s.name] = list;
    });
    res.send(schemas);
  },

  json: function(req, res) {
    /*
     * This represents a massive security threat!
     */

    let params = req.params.all();
    if (params.query) {
      params = _.merge(params.query, params);
      delete params.query;
    }

    const m = params.model;
    const sM = plural(m, 1);

    const model = sails.models[plural(sM, 1)];
    if (!model || !_.size(params)) {
      return res.badRequest();
    }

    const qParts = {
      qs:
        'SELECT ' +
        (params.count || req.method === 'POST' ? 'COUNT(*)' : '*') +
        ' FROM "' +
        sM +
        '" ',
      sort: '',
      limit: '',
      where: '',
      skip: '',
      vars: []
    };

    const setWhere = () => {
      if (!_.contains(qParts.qs, 'WHERE')) {
        qParts.qs += 'WHERE ';
      }
    };

    _.each(params, (jq, key) => {
      const size = _.size(jq) - 1;
      let index = 0;
      if (!_.isUndefined(qParts[key])) {
        switch (key) {
          case 'limit':
            qParts[key] = escape(' LIMIT %s', jq);
            break;
          case 'skip':
            qParts[key] = escape(' OFFSET %s', jq);
            break;
          case 'where':
            setWhere();
            qParts[key] = SqlUtils.buildWhereString(jq);
            break;
          case 'sort':
            qParts[key] = 'ORDER BY ';
            if (_.isString(jq)) {
              jq = JSON.parse(jq);
            }
            _.each(jq, (i, k) => {
              qParts[key] += escape('"%s" %s', k, i);
              if (index < size) {
                qParts[key] += ', ';
              }
              index++;
            });
            break;
        }
      }
    });

    let q = qParts.qs + qParts.where;

    if (!params.count && req.method === 'GET') {
      q += qParts.sort + qParts.limit + qParts.skip + ';';
    } else {
      q += ';';
    }

    model.query(q, (err, models) => {
      if (err) {
        return res.negotiate(err);
      }

      if (!models) {
        return res.send([]);
      }

      if (params.count || req.method === 'POST') {
        const c = models.rows[0];
        return res.send({
          total: parseInt(c.count || 0)
        });
      }
      res.send(models.rows);
    });
  },

  stream: function(req, res) {
    Utils.streamParser(req, res);
  },

  excel: function(req, res) {
    const params = req.params.all();
    const model = sails.models[plural(params.model, 1)];

    if (!model) {
      return res.badRequest();
    }
    Jobs.generateGenericExcel.add({
      params: params,
      language: req.session.language || 'en',
      model: params.model,
      socket: sails.sockets.getId(req)
    });

    res.send({
      message: 'info.PROCESSING_EXCEL_QUERY'
    });
  },

  csvModel: function(req, res) {
    const params = req.params.all();
    const model = sails.models[plural(params.model, 1)];

    if (!model) {
      return res.badRequest();
    }

    if (model.parseCSV) {
      return model.parseCSV(req, res);
    }

    csv.parseModel(req, res, plural(params.model, 1));
  },

  csv: async function(req, res) {
    const params = req.params.all();
    const self = this;
    const mods = sails.models[plural(params.model, 1)];
    params.__model = params.id;
    Node.pullSchema(params, res)
      .then(node => {
        if (mods && !node) {
          return self.csvModel(req, res);
        }

        if (!node) {
          return res.badRequest();
        }

        if (Utils[params.model] && Utils[params.model].parseCSV) {
          return Utils[params.model].parseCSV(req, res, node);
        }

        csv.parse(req, res, node);
      })
      .catch(err => {
        sails.log.error(err);
        res.serverError(err);
      });
  },

  averages: function(req, res) {
    const params = req.params.all();
    const modelName = plural(params.model, 1);
    const model = sails.models[modelName];

    if (!model) {
      return res.badRequest();
    }

    if (model.paintDivergence) {
      return model.paintDivergence(req, res);
    }

    // 2016-01-28 16:00:00+00

    const attr = model._attributes;

    let query = 'SELECT ';

    const size = _.size(attr) - 1;
    let first = false;
    const restrict = ['id', 'createdAt', 'updatedAt'];
    let param = '';
    _.each(
      attr,
      function(value, key) {
        if (value.type === 'datetime' && restrict.indexOf(key) === -1) {
          param = key;
        }

        if (
          (value.type !== 'float' && value.type !== 'integer') ||
          restrict.indexOf(key) > -1
        ) {
          this.i++;
          return;
        }

        if (this.i < this.size && this.i > 0 && first) {
          query += ', ';
        } else {
          first = true;
        }

        query += 'avg(' + key + ') as ' + key;

        this.i++;
      },
      {
        i: 0,
        size: size
      }
    );

    query += ' FROM ' + modelName;

    let escaped = null;
    // [sg] 2021-09-06
    // @TODO: This query looks like it should work ok with DDMMYYYY date format?
    const format = TimeUtils.constants.formats.Date.monthFirst;
    const dateFrom = TimeUtils.formattedDate(params.from, format);
    const dateTo = TimeUtils.formattedDate(params.to, format);
    if (params.from && params.to) {
      escaped = escape(
        query + " WHERE %s BETWEEN '%s' AND '%s' AND station = %s;",
        param,
        dateFrom /* [sg] moment(params.from).format("L"), */,
        dateTo /* [sg] moment(params.to).format("L"), */,
        params.station
      );
    } else if (params.from) {
      escaped = escape(
        query + " WHERE %s >= '%s' AND station = %s;",
        param,
        dateFrom /* [sg] moment(params.from).format("L"), */,
        params.station
      );
    } else if (params.to) {
      escaped = escape(
        query + " WHERE %s <= '%s' AND station = %s;",
        param,
        dateTo /* [sg] moment(params.to).format("L"), */,
        params.station
      );
    } else {
      escaped = escape(query + ' WHERE station = %s;', params.station);
    }

    model.query(escaped, (err, results) => {
      if (err) {
        return res.serverError(err);
      }

      res.send(results.rows);
    });
  },

  count: function(req, res) {
    const params = req.params.all();
    if (!params.__model) {
      return res.send({
        total: 0
      });
    }

    const modelName = params.__model;
    const mod = plural(modelName, 1);
    if (mod === 'station') {
      return stationcontroller.count(req, res);
    }
    const model = sails.models[mod];

    if (!model) {
      return res.send({
        total: 0
      });
    }

    const actionUtil = Utils.actionUtil();
    const where = actionUtil.parseCriteria(req);
    delete where.__model;
    model
      .count()
      .where(where)
      .exec((err, count) => {
        if (err) {
          sails.log.error(err);
          return res.serverError();
        }
        res.send({
          total: count
        });
      });
  },

  attrs: function(req, res) {
    const params = req.params.all();
    if (!params.model) {
      return res.badRequest();
    }
    const model = sails.models[plural(params.model, 1)];
    if (!model) {
      return res.badRequest();
    }
    res.send(model._attributes);
  },

  schemes: function(_req, res) {
    const models = sails.models;
    const controllers = sails.controllers;
    const policies = sails.config.policies;
    const schemas = {};
    const strips = [
      'globalId',
      'identity',
      'sails',
      'findOne',
      'find',
      'update',
      'destroy',
      'create'
    ];
    // for our default routes find/findOne, remove, update, destroy
    const add = ['get', 'delete', 'post', 'put'];
    for (const key in controllers) {
      const c = controllers[key];
      if (!models[c.identity]) {
        continue;
      }

      let actions;
      const controllerName = `${c.globalId}Controller`;
      try {
        actions = require(`./${controllerName}`);
      } catch (e) {
        sails.log.error(e);
      }

      const localPolicy = policies[controllerName] || {};
      const keys = _.keys(actions);
      _.remove(keys, s => {
        return _.contains(strips, s) || localPolicy[s] === true;
      });
      keys.push(...add);
      schemas[c.identity] = keys;
    }

    res.send(schemas);
  }
};
