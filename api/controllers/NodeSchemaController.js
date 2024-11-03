/**
 * NodeSchemaController
 *
 * @description :: Server-side logic for managing Nodeschemas
 * @help        :: See http://sailsjs.org/#!/documentation/concepts/Controllers
 */
const { SqlUtils } = require('similie-api-services');

const knexRef = () => {
  return sails.models.knex;
};
module.exports = {
  removeParameter: async function(req, res) {
    const method = req.method;
    if (method !== 'DELETE') {
      return res.notFound();
    }
    const params = Utils.params(req);
    const id = params.id;
    if (!id) {
      return res.badRequest({ error: 'A NodeSchema ID is required' });
    }
    const name = params.name;
    if (!name) {
      return res.badRequest({ error: 'A parameter machine name is required' });
    }
    const ns = await NodeSchema.findOneById(id);
    if (!ns) {
      return res.badRequest({ error: 'A valid nodeschema cannot be found' });
    }
    _.remove(ns.schema, s => s.name === name);
    await NodeSchema.removeMapNameFromSchema(ns.mappings, name);
    NodeSchema.setSchemaWeight(ns.schema);

    try {
      await new Promise((resolve, reject) => {
        knexRef()
          .schema.withSchema(SqlUtils.knex().getSchemaName(ns))
          .table(ns.name, function(t) {
            t.dropColumn(name);
          })
          .then(resolve)
          .catch(reject);
      });
    } catch (e) {
      sails.log.error(e);
      return res.serverError();
    }
    await NodeSchema.saveAsync(ns);
    return res.send(ns);
  },

  links: async function(req, res) {
    const params = req.params.all();
    if (!params.id) {
      return res.badRequest('errors.STATION_ID_REQUIRED');
    }
    const ns = await NodeSchema.findOneById(params.id);
    const links = ns.parents;
    if (!_.size(links)) {
      return res.send([]);
    }
    const stations = await Station.find({ id: links }).populateAll();
    res.send(stations);
  },

  findOne: function(req, res) {
    Utils.findOne(req, res, NodeSchema.sendSchema(req, res));
  },
  find: async function(req, res) {
    const params = req.params.all();

    if (params.id) {
      return Utils.findOne(req, res, NodeSchema.sendSchema(req, res));
    }

    const domain = res.locals.domain;

    let or;
    if (!domain) {
      or = [{ is_asset: true }, { domain: null }];
    } else {
      const domains = await Domain.commonDomainTags(domain);
      or = NodeSchema.filterAssetsForDomain(domains, domain);
    }

    const actionUtil = Utils.actionUtil();
    const criteria = actionUtil.parseCriteria(req);
    delete criteria.domain;
    const find = NodeSchema.find()
      .where(_.merge(criteria, { or: or }))
      .limit(actionUtil.parseLimit(req))
      .skip(actionUtil.parseSkip(req))
      .sort(actionUtil.parseSort(req));
    const schemas = await new Promise(function(resolve, reject) {
      find.populateAll().exec(function(err, schemas) {
        if (err) {
          return reject(err);
        }
        if (schemas && schemas.toJSON) {
          schemas.toJSON();
        }

        resolve(schemas);
      });
    });
    NodeSchema.sendSchema(req, res)(schemas);
  }
};
