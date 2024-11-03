/**
 * @summary SailsExtensions A collection of helper functions and re-surfaced utilties from
 * Sails to shortcut/over-ride some Sails BluePrint actions and functions.
 * These functions have been moved from the generic Utils module.
 */
const plural = require('pluralize');
const actionUtil = require('../../node_modules/sails/lib/hooks/blueprints/actionUtil');
const updateUtil = require('../../node_modules/sails/lib/hooks/blueprints/actions/update');
const createUtil = require('../../node_modules/sails/lib/hooks/blueprints/actions/create');
const findUtil = require('../../node_modules/sails/lib/hooks/blueprints/actions/find');
const findOneUtil = require('../../node_modules/sails/lib/hooks/blueprints/actions/findOne');
// breaks in testing because sails hasn't fully lifted
// const Constants = require('../services/Const');
const { SqlUtils } = require('similie-api-services');

module.exports = {
  applyManifestToProductionErrorPages: function(data) {
    const sendData = {
      data: data
    };

    if (sails.config.environment === 'production') {
      sendData.locals = {
        webpackManifest: sails.config.webpackManifest
      };
    }
    return sendData;
  },

  populateCollections: function(where, attrs) {
    const collections = [];
    _.each(where, (_, key) => {
      const a = attrs[key] || {};
      if (a.collection) {
        const collection = {
          key: key,
          collection: a.collection,
          through: a.through,
          model_name: null
        };
        collections.push(collection);
      }
    });

    return collections;
  },

  isMultiServer() {
    return process.env.MULTI_SERVER === 'true';
  },

  /**
   * @description collectionTable:: gets the name of a collection table based on sails logic
   * @param {Object} collection
   * @returns {Object} - the parts of a collection table
   */
  collectionTable: function(collection) {
    const modRow = collection.model + '_' + collection.key;
    const collectionRow =
      collection.collection +
      '_' +
      collection.key +
      '_' +
      collection.collection;

    let table = modRow + '__' + collectionRow;
    const table2 = collectionRow + '__' + modRow;
    // this comes from sails
    if (collection.model >= collection.collection) {
      table = table2;
    }
    return {
      table,
      modRow,
      collectionRow
    };
  },

  /**
   * @description queryCollection:: pulls the collection values from
   * the collection object
   * @param {Object} collection - the collection object
   * @param {string} model_name - for bypassing defaults
   * @returns
   */
  queryCollection: function(collection, model_name) {
    /*
     * Needs testing
     */
    if (collection.through) {
      const throughModel = sails.models[collection.through];
      if (!throughModel) {
        throw new Error('Through model not defined');
      }
      const _attrs = throughModel._attributes;
      const contain = {
        table: collection.through
      };
      for (const key in _attrs) {
        const value = _attrs[key];
        if (value.model === model_name) {
          contain.model_row = key;
        } else if (value.model === collection.model) {
          contain.collection_row = key;
        }
      }
      return contain;
    }

    collection.model = collection.model || model_name || collection.model_name;
    const tableParts = this.collectionTable(collection);
    return {
      model_row: tableParts.modRow,
      table: tableParts.table,
      collection_row: tableParts.collectionRow
    };
  },

  /**
   * @description gets the
   * @param {Array} ids
   * @returns {string} - raw query
   */
  buildQueryIds: function(ids = []) {
    SqlUtils.setInString(ids.map(id => Model.getId(id)));
    const mapped = ids.map(id => Model.getId(id));
    if (!mapped.length) {
      throw new Error('No valid Ids found');
    }
    return `SELECT %s as "%s" FROM %s where %s ${SqlUtils.setInString(
      mapped
    )} and %s IS NOT NULL;`;
  },

  /**
   * @description buildCollectionQuery:: builds a query for seeking collections
   * @param {Object} - the collection details
   * @param {Object} - the collection parts
   * @returns {string} - Th string query
   */
  buildCollectionQuery: function(collection, collectionParts) {
    const escape = SqlUtils.escapeUtil();
    const _query = this.buildQueryIds(collection.ids);
    const query = escape(
      _query,
      collectionParts.model_row,
      collection.model,
      collectionParts.table,
      collectionParts.collection_row,
      collectionParts.model_row
    );
    return query;
  },

  /**
   * @description queryCollectionTable:: gets the async results for a query
   * @param {string} - the query
   * @returns {Collection} - The query collection
   */
  queryCollectionTable: async function(query) {
    const results = await Model.queryAsync(query);
    return results.rows;
  },

  /**
   * @description applyCollectionValue:: results values, based on the collection type
   * @param {Array} - the query results
   * @param {Object} - the collection object
   * @returns {Array} - The ids of the objects found
   */
  applyCollectionValue: function(results = [], collection = {}) {
    const rows = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i] || {};
      rows.push(result[collection.model]);
    }
    return rows;
  },

  /**
   * @description Allows a means of querying data stored to a collection.
   * Currently sails does not provide a means to find your query based on
   * collection datasets.
   *
   * @param {Collection} - collections that we are looking to query
   * @return {Promise} - the ids of models that match the result
   */
  queryCollections: async function(collections = []) {
    const modifications = {};
    for (let i = 0; i < collections.length; i++) {
      const collection = collections[i];
      const model = sails.models[collection.model];
      if (!model) {
        continue;
      }
      const collectionParts = this.queryCollection(
        collection,
        collection.model
      );
      try {
        const query = this.buildCollectionQuery(collection, collectionParts);
        const results = await this.queryCollectionTable(query);
        const values = this.applyCollectionValue(results, collection);
        modifications[collection.model] = values;
      } catch (e) {
        sails.log.error(e);
      }
    }
    return modifications;
  },

  /**
   * @description subscribeModels. Subscribes the models to the sockets
   * @param {Object} Model - the sails model
   * @param {Object} req - the request object
   * @param {COLLECTION} Model - the model collection
   */
  subscribeModels: function(Model, req, values) {
    if (req._sails.hooks.pubsub && req.isSocket) {
      Model.subscribe(req, values);
      if (req.options.autoWatch) {
        Model.watch(req);
      }
      // Also subscribe to instances of all associated models
      _.each(values, function(record) {
        actionUtil.subscribeDeep(req, record);
      });
    }
  },

  /**
   * @description Publishes an update and subscribes to, the model record
   * specified by type 'Model'.
   * @param {*} Model
   * @param {*} req
   * @param {*} record
   */
  publishUpdates: function(Model, req, record) {
    const pk = record.id;
    const values = actionUtil.parseValues(req);
    if (req._sails.hooks.pubsub) {
      if (req.isSocket) {
        Model.subscribe(req, [record]);
      }
      Model.publishUpdate(pk, _.cloneDeep(values), !req.options.mirror && req, {
        previous: _.cloneDeep(record.toJSON())
      });
    }
  },

  /**
   * @description findOne. Overrides sails.js blueprints for findOne
   * @param {Object} req - the request object
   * @param {Object} res - the response object
   * @param {Function} cb - callback
   */

  findOne: function(req, res, cb) {
    const Model = actionUtil.parseModel(req);
    const pk = actionUtil.requirePk(req);

    let query = Model.findOne(pk);
    query = actionUtil.populateRequest(query, req);
    query.exec(function found(err, matchingRecord) {
      if (err) return res.serverError(err);
      if (!matchingRecord)
        return res.notFound('No record found with the specified `id`.');

      if (req._sails.hooks.pubsub && req.isSocket) {
        Model.subscribe(req, matchingRecord);
        actionUtil.subscribeDeep(req, matchingRecord);
      }

      cb(matchingRecord);
    });
  },

  /**
   * @description streamParser. Overrides sails.js blueprints for stream.
   * @param {Object} req - the request object
   * @param {Object} res - the response object
   * @param {Function} cb - callback
   */
  streamParser: function(req, res, cb) {
    if (!req.isSocket) {
      return res.badRequest();
    }

    const params = req.params.all();
    // this is for action util
    req.options.model = plural(params.model, 1);
    // Look up the model
    const Model = actionUtil.parseModel(req);

    // If an `id` param was specified, use the findOne blueprint action
    // to grab the particular instance with its primary key === the value
    // of the `id` param.   (mainly here for compatibility for 0.9, where
    // there was no separate `findOne` action)
    if (actionUtil.parsePk(req)) {
      // return Utils .streamOne(req, res, cb);
      return _streamOne(req, res, cb);
    }

    const q = {};
    q.where = actionUtil.parseCriteria(req);
    q.limit = actionUtil.parseLimit(req);
    q.skip = actionUtil.parseSkip(req);
    q.sort = actionUtil.parseSort(req);
    // Lookup for records that match the specified criteria
    const stream = Model.stream(); // .pipe(sails.sockets.emit);
    stream.on('data', function(chunk) {
      sails.sockets.broadcast(req.socket.id, chunk.toString());
    });

    res.send([]);
  },

  /**
   * @description Sends the message over sails sockets when a job is finished.
   * E.g. building an Excel download
   * @alias Utils-sendexcelMessage(err, message)
   * @param err {Object} Any errors
   * @param message {Object} The finished file
   * @param recipient {string} A string indicating the message to send from one
   * of the Constants.sockets... values. If omitted the function will default
   * to 'excel_report_compiled'
   */
  broadcastSocketMessage: function(err, message, recipient) {
    const socket = message.socket;

    if (err) {
      sails.log.error(err);
      message = {};
      message.error = err.message;
    }

    if (!recipient) {
      recipient = Const.sockets.EXCEL_REPORT_COMPILED;
    }

    try {
      sails.sockets.broadcast(socket, recipient, message);
    } catch (e) {
      sails.log.error(e);
    }
  },

  /**
   * @summary Reference to the Sails / blueprints / actionUtil parser functions
   * The parsers are also surfaced through the shortcut functions:
   * primaryKey, params, limit, skip, sort & values
   */
  actionUtil: function() {
    return actionUtil;
  },

  /**
   * @description Container object for dereferencing Sails Blueprints functions
   */
  bluePrints: {
    /** @summary Reference to the Sails / blueprints / find */
    find: findUtil,
    /** @summary Reference to the Sails / blueprints / findOne */
    findOne: findOneUtil,
    /** @summary Reference to the Sails / blueprints / create */
    create: createUtil,
    /** @summary Reference to the Sails / blueprints / update */
    update: updateUtil
  },

  /**
   *
   * @param {Object5} req - the request object
   * @returns
   */
  pk: function(req) {
    return actionUtil.requirePk(req);
  },

  /**
   * @description Shortcut for returning a query object containing parsed
   * properties for where, limit, skip and sort
   */
  parseQueryParameters: req => {
    const q = {};
    q.where = actionUtil.parseCriteria(req);
    q.limit = actionUtil.parseLimit(req);
    q.skip = actionUtil.parseSkip(req);
    q.sort = actionUtil.parseSort(req);
    return q;
  },

  /** @description Shortcut for actionUtil.parsePk(req) */
  primaryKey: req => {
    return actionUtil.parsePk(req);
  },

  /** @description Shortcut for actionUtil.parseCriteria(req) */
  params: req => {
    return actionUtil.parseCriteria(req);
  },

  /** @description Shortcut for actionUtil.parseLimit(req) */
  limit: req => {
    return actionUtil.parseLimit(req);
  },

  /** @description Shortcut for actionUtil.parseSort(req) */
  sort: req => {
    return actionUtil.parseSort(req);
  },

  /** @description Shortcut for actionUtil.parseSkip(req) */
  skip: req => {
    return actionUtil.parseSkip(req);
  },

  /** @description Shortcut for actionUtil.parseValues(req) */
  values: req => {
    return actionUtil.parseValues(req);
  },

  getParser: function(req, res, cb) {
    // Look up the model
    const Model = actionUtil.parseModel(req);
    // If an `id` param was specified, use the findOne blueprint action
    // to grab the particular instance with its primary key === the value
    // of the `id` param.   (mainly here for compatibility for 0.9, where
    // there was no separate `findOne` action)
    if (actionUtil.parsePk(req)) {
      return this.findOne(req, res, cb);
    }
    // Lookup for records that match the specified criteria
    const query = Model.find()
      .where(actionUtil.parseCriteria(req))
      .limit(actionUtil.parseLimit(req))
      .skip(actionUtil.parseSkip(req))
      .sort(actionUtil.parseSort(req));
    query.populateAll(); //= actionUtil.populateRequest(query, req);
    query.exec(function found(err, matchingRecords) {
      if (err) return res.serverError(err);

      // Only `.watch()` for new instances of the model if
      // `autoWatch` is enabled.
      if (req._sails.hooks.pubsub && req.isSocket) {
        Model.subscribe(req, matchingRecords);
        if (req.options.autoWatch) {
          Model.watch(req);
        }
        // Also subscribe to instances of all associated models
        _.each(matchingRecords, function(record) {
          actionUtil.subscribeDeep(req, record);
        });
      }

      cb(matchingRecords);
    });
  },

  find: function(req, res) {
    return new Promise(resolve => {
      this.getParser(req, res, resolve);
    });
  },

  /**
   * @description Creates a clone of the specified model.
   */
  cloneModel: function(model, compare, contrast) {
    const _clone = this.stripObjects([_.cloneDeep(model)])[0];
    const cloneString = JSON.stringify(_clone);
    const clone = JSON.parse(cloneString);
    const restricted = ['id', 'createdAt', 'updatedAt', 'domain'];
    _.each(restricted, key => {
      delete clone[key];
    });
    let schema = {};
    if (_.size(compare) && _.size(contrast)) {
      const comp = compare._attributes;
      const con = contrast._attributes;
      _.each(comp, (_o, key) => {
        if (con[key] && clone[key] != null) {
          schema[key] = clone[key];
        }
      });
    } else {
      schema = clone;
    }

    return schema;
  },

  /**
   * @description This function removes the objects from associted models. With
   * associations, they will not save if their associated mode or collection is
   * an object instead of an integer.
   * @param objects {Object} The object that needs to be stripped
   * @param strict {boolean} Whether to retain the model.id or whole model
   * @returns {object} A copy of the input object with sub-models replaced by
   * model.id where required.
   */
  stripObjects: function(objects, strict) {
    const clone = _.clone(objects);
    const model = sails.models;

    _.each(clone, function(c) {
      _.each(c, function(val, key) {
        const modelRequired = (strict && !!_.size(model[key])) || !strict;
        if (_.isArray(val)) {
          const hold = _.clone(val);
          c[key].length = 0;
          const take = [];
          _.each(hold, function(el) {
            if (_.isObject(el) && !_.isUndefined(el.id) && modelRequired) {
              take.push(el.id);
            } else {
              take.push(el);
            }
          });
          c[key] = take;
        } else if (_.isObject(val) && !_.isUndefined(val.id) && modelRequired) {
          c[key] = val.id;
        } else {
          c[key] = val;
        }
      });
    });
    return clone;
  },

  /**
   * @description Sets the ttl property of the specified site config
   * Note. Mutating method.
   *
   * @param {object} site - the site object
   */
  setTTL: function(site) {
    if (!site) return;

    const ttl = sails.config.session.ttl || 3600 * 24;
    site.ttl = ttl;
  },

  /**
   * @description Helper for serverError
   */
  serverError: function(res) {
    return function(payload) {
      res.serverError(payload);
    };
  },

  /**
   * @description Helper to clean up logger and callback code
   */
  errorLog: function(cb) {
    return function(err) {
      if (err) {
        sails.log.error(err);
      }

      (cb || _.noop)();
    };
  },

  /**
   * @description Sends the error code and message
   * @param {*} res
   * @param {*} codeObj
   * @returns
   */
  sendErrorCode: function(res, codeObj) {
    sails.log.error(codeObj);
    if (codeObj && codeObj.code) {
      return res.send(codeObj.message, codeObj.code);
    }

    return res.negotiate(codeObj);
  },

  /**
   * @description Helper to clean up logger and callback code
   */
  passiveCallback: function(cb, log) {
    return function(element) {
      if (log) {
        sails.log.debug(element);
      }
      (cb || _.noop)();
    };
  },

  /**
   * @description Helper function for supporting Jobs, adding lifecycle
   * functions to the job object. Moved from Utils since it references Jobs.
   * @param {Array} Listeners - the lifecycle functions of the job object
   */
  stats: function(listeners) {
    return function(name) {
      _.each(listeners, function(listen, key) {
        Jobs[name].on(key, listen);
      });
    };
  }
};

// Private methods

/**
 * @description Overrides sails.js blueprints for streamOne
 * @param {Object} req - the request object
 * @param {Object} res - the response object
 * @param {Function} cb - callback
 */
const _streamOne = (req, _res, _cb) => {
  const getSocket = req.socket;
  const Model = actionUtil.parseModel(req);
  const pk = actionUtil.requirePk(req);
  return Model.stream(pk).pipe(getSocket.emit);
};

// const _createUtil = () => {
//   return createUtil;
// };

// const _findUtil = () => {
//   return findUtil;
// };

// const _findOneUtil = () => {
//   return findOneUtil;
// };

// const _updateUtil = () => {
//   return updateUtil;
// };
