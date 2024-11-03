/*
 * Strips any associates that haven't been striped before reaching the server. It also
 * lets us post associated data without first creating it
 */

module.exports = function(req, res, next) {
    const method = req.method;
    const model = req.options.model;
    if (method === 'GET' || method === 'DELETE' || !model) {
      return next();
    }
    const actionUtil = Utils.actionUtil();
    const values = actionUtil.parseValues(req);
    const Model = actionUtil.parseModel(req);
    Model._attributes.forEach( (attr, key, ready) => {
      if (!(
        values[key] &&
        _.isObject(values[key]) &&
        _.size(values[key]) &&
        (attr.model || attr.collection)
      )) {
        ready();
        next();
        return;
      }
      const associate = sails.models[attr.model ?? attr.collection];
      if (!associate) {
        ready();
        next();
        return;
      }
      // we get the primary key attribute
      const pk = associate.primaryKey;
      // if we have the model, let's remove these objects
      if (attr.model) {
        stripModel(values, key, pk, req, associate);
      } else if (attr.collection) {
        try {
          stripCollection(values, key, pk);
          // now we replace the collection
          req.body[key] = collection;
          ready(null);
        } catch (e) {
          // now we replace the collection
          req.body[key] = collection;
          ready(err);
        }
      }
    },next);
  };
  
  function stripModel (values, key, pk, req, associate) {
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
  }
  
  function stripCollection (values, key, pk) {
    // create a collection that we'll stuff into the body
    const collection = [];
    // iterate the values
    values[key].forEach ( (val, go) => {
      // if we have an object and the value of the pk exist
      // stuff it
      if (_.isObject(val) && val[pk]) {
        collection.push(val[pk]);
        go();
        return;
        // allows to create asociated collections
      } else if (!_.isObject(val) || val[pk]) {
        // otherwise, we just push whats there
        collection.push(val);
        go();
        return;
      }
      // needs full testing
      associate
        .create(val)
        .then(ass => {
          collection.push(ass[pk]);
          go();
        })
        .catch(go);
    });
  }
  