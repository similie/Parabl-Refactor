const plural = require('pluralize');
const Q = require('q');
const escape = require('pg-escape');

/*
 * This policy allows us to search models
 * based on collection IDs.
 */

module.exports = function(req, res, next) {
  const params = req.params.all();
  const model_name =
    plural(params.__model || '', 1) ||
    plural(params.model || '', 1) ||
    req.options.model ||
    req.options.controller;
  if (!model_name) {
    return next();
  }

  if (!params.where && (!params.query || !params.query.where)) {
    return next();
  }

  const model = sails.models[model_name];

  if (!model) {
    return next();
  }

  let where = params.where || params.query.where;
  if (_.isString(where)) {
    try {
      where = where.replace(',"domain":undefined', '');
      where = JSON.parse(where);
    } catch (e) {
      sails.log.error('ERROR PARSING COLLECTOR JSON', e);
    }
  }

  const attrs = model._attributes;
  const collections = Utils.populateCollections(where, attrs);
  if (!_.size(collections)) {
    return next();
  }
  Utils.removeFromRequest(req, collections);

  const promises = [];

  const setPromise = function(q) {
    return new Promise((resolve, reject) => {
      Model.query(q, (err, result) => {
        if (err) {
          return reject(err);
        }

        resolve(result.rows);
      });
    });
  };

  let reject = false;

  _.each(collections, collection => {
    const param = _.clone(where[collection.key]);
    const mod = sails.models[collection.model];
    // delete where[collection.key];

    if (!mod) {
      reject = true;
      return reject;
    }
    let s;
    if (!_.isArray(param)) {
      s = [param];
    } else {
      s = param;
    }

    const qCompoents = Utils.queryCollection(collection, model_name);
    let q = 'SELECT %s FROM %s where %s in(';
    const check = [];
    _.each(s, (inQ, i) => {
      let id;
      if (!_.isNaN(inQ)) {
        id = inQ;
      } else if (inQ.id) {
        id = inQ.id;
      }

      if (id) {
        // we stuff this to make sure
        // there are elements to quer
        check.push(id);
        q += id;
        if (i < s.length - 1) {
          q += ',';
        } else {
          q += ')';
        }
      }
    });

    if (_.size(check)) {
      q += ' and %s IS NOT NULL;';
      const esc = escape(
        q,
        qCompoents.model_row,
        qCompoents.table,
        qCompoents.collection_row,
        qCompoents.model_row
      );
      promises.push(setPromise(esc));
    }
  });

  if (reject) {
    return next();
  }

  Q.allSettled(promises)
    .then(results => {
      const modifications = [];
      _.each(results, r => {
        if (r.value && _.size(r.value)) {
          _.each(r.value, value => {
            _.each(value, v => {
              if (!_.contains(modifications, value)) {
                modifications.push(v);
              }
            });
          });
        }
      });
      /*
       * Not sure this what we want
       */
      if (!_.size(modifications)) {
        // we want to return the query is empty because no data was found
        return res.send([]); // next();
      }
      // CommonUtils.params.addToRequest(req, 'id', modifications);
      Utils.addToRequest(req, 'id', modifications);
      next();
    })
    .catch(err => {
      sails.log.error(err);
      return res.serverError(err);
    });
};
