/*
 * Strips any associates that haven't been striped before reaching the server. It also
 * lets us post associated data without first creating it
 */

const a_sync = require('async');
module.exports = function(req, res, next) {
  const method = req.method;
  const model = req.options.model;
  if (method === 'GET' || method === 'DELETE' || !model) {
    return next();
  }
  const actionUtil = Utils.actionUtil();
  const values = actionUtil.parseValues(req);
  const Model = actionUtil.parseModel(req);
  a_sync.forEachOf(
    Model._attributes,
    (attr, key, ready) => {
      if (
        values[key] &&
        _.isObject(values[key]) &&
        _.size(values[key]) &&
        (attr.model || attr.collection)
      ) {
        // if we have the model, let's remove these objects
        if (attr.model) {
          const associate = sails.models[attr.model];
          if (associate) {
            const pk = associate.primaryKey;
            if (values[key][pk]) {
              req.body[key] = values[key][pk];
              ready();
            } else if (!values[key][pk]) {
              // this allows us to create our association
              // without id
              associate
                .create(values[key])
                .then(ass => {
                  let a = ass;
                  if (_.isArray(ass)) {
                    a = ass.pop();
                  }
                  req.body[key] = a[pk];
                  ready();
                })
                .catch(ready);
            }
          } else {
            ready();
          }
        } else if (attr.collection) {
          const associate = sails.models[attr.collection];
          if (associate) {
            // we get the primary key attribute
            const pk = associate.primaryKey;
            // create a collection that we'll stuff into the body
            const collection = [];
            // iterate the values
            a_sync.forEach(
              values[key],
              (val, go) => {
                // if we have an object and the value of the pk exist
                // stuff it
                if (_.isObject(val) && val[pk]) {
                  collection.push(val[pk]);
                  go();
                  // allows to create asociated collections
                } else if (_.isObject(val) && !val[pk]) {
                  // needs full testing
                  associate
                    .create(val)
                    .then(ass => {
                      collection.push(ass[pk]);
                      go();
                    })
                    .catch(go);
                } else {
                  // otherwise, we just push whats there
                  collection.push(val);
                  go();
                }
              },
              err => {
                // now we replace the collection
                req.body[key] = collection;
                ready(err);
              }
            );
          } else {
            ready();
          }
        }
      } else {
        ready();
      }
    },
    next
  );
};
