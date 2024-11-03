const actionUtil = require('../../node_modules/sails/lib/hooks/blueprints/actionUtil');
const plural = require('pluralize');
const uuid = require('uuid');
const fs = require('fs');
const { isNaN } = require('lodash');

/** @summary temporary constants for deprecation notices */
const thisLib = '/api/services/Utils.js';
const notSupported = 'is no longer supported.';
const forwardingMsg = 'Please see %s in similie-api-services';
module.exports = {
  /** @deprecated Use /api/services/SailsExtensions.parseQueryParameters */
  parseQueryParameters: req => {
    const q = {};
    q.where = actionUtil.parseCriteria(req);
    q.limit = actionUtil.parseLimit(req);
    q.skip = actionUtil.parseSkip(req);
    q.sort = actionUtil.parseSort(req);
    return q;
  },

  /** @todo Move to api/services/CacheStore.js - only caller */
  parseJSON: string => {
    if (string == null) {
      return string;
    }

    let send;

    try {
      send = JSON.parse(string);
    } catch (e) {
      if (_.isObject(string) || _.isString(string)) {
        return string;
      }
    }

    return send;
  },

  /**
   * @deprecated Please use CommonUtils.params.deleteFieldsFromRequest. Note:
   * The new function no longer mutates the req object in place, it returns a
   * mutated copy.
   */
  removeFromRequest: (req, collections) => {
    _.each(collections, col => {
      if (req.method === 'POST' && req.body && _.size(req.body.where)) {
        delete req.body.where[col.key];
      } else if (req.body && _.size(req.body.where)) {
        delete req.body.where[col.key];
      } else if (req.body && req.body.query && _.size(req.body.query.where)) {
        if (_.isString(req.body.query.where)) {
          req.body.query.where = JSON.parse(req.bodyquery.where);
        }
        delete req.body.query.where[col.key];
      } else if (req.query && _.size(req.query.where)) {
        if (_.isString(req.query.where)) {
          req.query.where = JSON.parse(req.query.where);
        }
        delete req.query.where[col.key];
      }
    });
  },

  isObjectLike: function(value) {
    return (
      typeof value === 'string' &&
      ((value.startsWith('{') && value.endsWith('}')) ||
        (value.startsWith('[') && value.endsWith(']')))
    );
  },

  paramToJSON: function(obj = {}, key) {
    const baseObject = obj[key];
    for (const thisKey in baseObject) {
      const parser = baseObject[thisKey];
      if (this.isObjectLike(parser)) {
        baseObject[thisKey] = this.parseJSON(parser);
      }

      if (typeof parser === 'object') {
        return this.paramToJSON(parser, thisKey);
      }
    }
  },

  /**
   * @deprecated Please use CommonUtils.params.addToRequest. Note: The new fn.
   * no longer mutates the req object in place, it returns a mutated copy.
   */
  addToRequest: function(req, key, modifications) {
    if (req.method === 'POST' && req.body && req.body.query) {
      req.body.query.where[key] = modifications;
      this.paramToJSON(req, 'body');
    } else if (req.body && req.body.where) {
      req.body.where[key] = modifications;
      this.paramToJSON(req, 'body');
    } else if (req.body && req.body.query) {
      req.body.query.where[key] = modifications;
      this.paramToJSON(req, 'body');
    } else if (req.query && req.query.where) {
      req.query.where[key] = modifications;
      this.paramToJSON(req, 'query');
    } else if (req.query) {
      req.query[key] = modifications;
      this.paramToJSON(req, 'query');
    }
  },

  /**
   * @deprecated Please use CommonUtils.params.pullArray
   */
  pullArray: params => {
    if (_.isArray(params)) {
      return params;
    }

    const arr = [];
    let i = 0;
    while (i !== null) {
      const body = params[i];
      if (body) {
        arr.push(body);
        i++;
      } else {
        i = null;
      }
    }

    return arr;
  },

  timeoutVal: function(value = 1) {
    const naN = isNaN(parseInt(value));
    if (naN || value > Math.pow(2, 32) || value < 0) {
      return 1;
    }
    return value;
  },

  /** @deprecated No known callers. Now logs */
  timeout: async function(timer = 1) {
    Utils.logDeprecationNotice('timeout', true);
    return new Promise(resolve => {
      setTimeout(resolve, this.timeoutVal(timer));
    });
  },

  /** @todo Move to api/models/Rule.js - only caller */
  findWord: function(words, statement) {
    let index = -1;
    for (let i = 0; i < _.size(words); i++) {
      const word = words[i];
      if (word === statement) {
        index = i;
        break;
      }
    }

    return index;
  },

  /** @deprecated Please use CommonUtils.imaging.getFirstImage */
  getFirstImage: async function(files, config) {
    let image = null;
    if (!_.size(files)) {
      return image;
    }
    const found = await SysFile.find({
      id: _.filter(files, f => !!f)
    });
    let url = '';
    if (config) {
      url = `${(config.files || {}).download}/`;
    }

    for (let i = 0; i < _.size(found); i++) {
      const f = found[i];
      if (_.contains(f.type, 'image/')) {
        image = `${url}${f.id}`;
        break;
      }
    }
    return image;
  },

  /** @deprecated Please use IsThis(el).between(start, end) */
  between: function(el, start, end) {
    return el >= start && el <= end;
  },

  /** @deprecated Please use SqlUtils.setSortGroup */
  setSortGroup: (params, currentSort, desc) => {
    const sort = {};
    currentSort = currentSort || {};
    _.each(params, function(p) {
      sort[p] = desc ? 'DESC' : 'ASC';
    });
    _.merge(currentSort, sort);
    return currentSort;
  },

  /** @deprecated No known callers. Now logs */
  restrictKeys: (key, allowNumeric) => {
    Utils.logDeprecationNotice('restrictKeys', true);
    const nokeys = {
      or: true,
      contains: true,
      '!': true,
      sqlagent: true,
      statekeys: true
    };
    return (
      !nokeys[key] && (allowNumeric || (!allowNumeric && !Utils.isNumeric(key)))
    );
  },

  /**
   * @deprecated Please use CommonUtils.truncateText. Note this function
   * returns size-1 characters, the new function returns size
   *
   * @note saved for testing
   */
  truncateText: (text, size) => {
    if (!_.isString(text)) {
      return '';
    }

    if (_.size(text) > size) {
      text = text.substring(0, size - 4);
      text = text + '...';
    }

    return text;
  },

  /** @deprecated Please use SailsExtensions.populateCollections */
  populateCollections: function(where, attrs) {
    const collections = [];

    for (const key in where) {
      const a = attrs[key] || {};
      if (!a.collection) {
        continue;
      }
      const collection = {
        key: key,
        model: a.collection,
        through: a.through
      };
      collections.push(collection);
    }
    return collections;
  },

  /** @deprecated Please use SailsExtensions.queryCollection */
  queryCollection: function(collection, model_name) {
    // const model = sails.models[model_name];
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

      _.each(_attrs, function(value, key) {
        if (value.model === model_name) {
          contain.model_row = key;
        } else if (value.model === collection.model) {
          contain.collection_row = key;
        }
      });
      return contain;
    }

    const modRow = model_name + '_' + collection.key;
    const collectionRow =
      collection.model + '_' + collection.key + '_' + collection.model;
    let table = modRow + '__' + collectionRow;
    const table2 = collectionRow + '__' + modRow;
    // this comes from sails and how it defines
    // it's collection tables
    if (model_name >= collection.model) {
      table = table2;
    }

    return {
      model_row: modRow,
      table: table,
      collection_row: collectionRow
    };
  },

  /** @deprecated Please use SailsExtensions.cloneModel */
  cloneModel: function(model, compare, contrast) {
    const clone = Utils.stripObjects([_.cloneDeep(model)])[0];
    const restricted = ['id', 'createdAt', 'updatedAt', 'domain'];
    _.each(restricted, function(key) {
      delete clone[key];
    });
    let schema = {};
    if (_.size(compare) && _.size(contrast)) {
      const comp = compare._attributes;
      const con = contrast._attributes;
      _.each(comp, function(obj, key) {
        if (con[key] && clone[key] != null) {
          schema[key] = clone[key];
        }
      });
    } else {
      schema = clone;
    }

    return schema;
  },

  /** @deprecated Please use SailsExtensions.sendErrorCode */
  sendErrorCode: function(res, codeObj) {
    sails.log.error(codeObj);
    if (codeObj && codeObj.code) {
      return res.send(codeObj.message, codeObj.code);
    }

    return res.negotiate(codeObj);
  },

  /**
   * @deprecated Please use CommonUtils.getErrorForCode, using one of the
   * values in the ENUM: CommonUtils.constants.ENUMS.ErrorCodes
   */
  setErrorCode: function(code) {
    switch (code) {
      case Const.code.BAD_REQUEST:
        return {
          code: Const.code.BAD_REQUEST,
          message: 'warning.INVALID_REQUEST'
        };
      case Const.code.SERVER_ERROR:
        return {
          code: Const.code.SERVER_ERROR,
          message: 'errors.SERVER_ERROR'
        };
      case Const.code.FORBIDDEN:
        return {
          code: Const.code.FORBIDDEN,
          message: 'warning.ACCESS_DENIED'
        };
      default:
        return {
          code: Const.code.UNKOWN_ERROR,
          message: 'errors.UNKOWN_ERROR'
        };
    }
  },

  /*
   *
   */
  /** @deprecated Please use SailsExtensions.publishUpdates */
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
   * @deprecated Please use SailsExtensions.subscribeModels
   *
   * subscribes the models to the sockets
   *
   * @param {Object} Model - the sails model
   * @param {Object} rec - the request object
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
   * @todo. Move to api/controllers/VariableController.js
   * only caller
   *
   * just making sure object or array isn't empty
   *
   * @param {Object|Array} params - checking the size of
   * @return {Boolean} true if it's not empty
   */
  hasSize: function(params) {
    return _.size(params) > 0;
  },

  /**
   * @deprecated Moved to CommonUtils.params as an internal helper function
   * for forceRequestParameters
   */
  addQueryString: function(string, key, value) {
    const add = `,"${key}":${_.isString(value) ? `"${value}"` : value}}`;
    const index = string.lastIndexOf('}');
    const splits = string.split('');
    splits[index] = add;
    let joins = splits.join('');
    if (joins[1] === ',') {
      joins = joins.replace('{,', '{');
    }
    return joins;
  },

  /*
   * containsValue
   *
   * looks to see if there is a value in the key
   *
   * @param {Object} req - the request
   * @param {...Spread} modelAttrs - the object containing the attrs
   * sould follow, {model, query: [type&key]}
   */

  /**
   * @deprecated Please use CommonUtils.params.forceRequestParameters. Note:
   * The new function no longer mutates the req object in place, it returns a
   * mutated copy and also requires the result of the shortcut sails function
   * req.params.all() to be passed as the second parameter of the function.
   * @example const newReq =
   *  CommonUtils
   *  .params
   *  .forceRequestParameters(req, req.params.all(), ...spread)
   */
  forceRequestParameters: function(req, ...modelAttrs) {
    const params = req.params.all();
    const method = req.method;

    /*
     * We do this because a get holds its params
     * in a query. The others in the body
     */
    let querystring = 'body';
    if (Utils.leastOne(method, 'get', 'GET', 'DELETE', 'delete')) {
      querystring = _.size(req.body) ? 'body' : 'query';
    }
    for (let i = 0; i < _.size(modelAttrs); i++) {
      const attrs = modelAttrs[i];
      for (let i = 0; i < _.size(attrs.query); i++) {
        const q = attrs.query[i];
        const value = q.type !== 'collection' ? q.value : [q.value];
        req[querystring] = req[querystring] || {};
        if (params.where != null) {
          if (_.isString(req[querystring].where)) {
            const change = Utils.addQueryString(
              req[querystring].where,
              q.key,
              value
            );
            req[querystring].where = JSON.parse(change);
          } else {
            req[querystring].where = req[querystring].where || {};
            req[querystring].where[q.key] = value;
          }
        } else if (params.query) {
          // supports some old-school queries
          req[querystring].query = req[querystring].query || {};
          if (params.query.where) {
            req[querystring].query.where = req[querystring].query.where || {};
            req[querystring].query.where[q.key] = value;
            req[querystring].query.where[q.key] = value;
          } else {
            req[querystring].query = req[querystring].query || {};
            req[querystring].query[q.key] = value;
          }
        } else {
          if (_.isString(req[querystring])) {
            const change = Utils.addQueryString(req[querystring], q.key, value);
            req[querystring] = change;
          } else {
            req[querystring][q.key] = value;
          }
        }
      }
    }
    // sails.log.debug("UTILS.forceRequestParameters::::", method, querystring, req[querystring]);
  },

  /** @todo Move to api/models/Rule.js - only caller */
  contains: function(search, item, deep) {
    let found = false;
    const searchFields = _.isArray(item) ? item : [item];
    for (let i = 0; i < _.size(search); i++) {
      const searchItem = search[i];
      for (let j = 0; j < _.size(searchFields); j++) {
        const is = searchFields[j];
        if (deep) {
          found = searchItem === is;
        } else {
          // eslint-disable-next-line eqeqeq
          found = searchItem == is;
        }
        if (found) {
          return found;
        }
      }
    }
    return found;
  },

  /**
   * @deprecated Please use CommonUtils.containsValue
   *
   * looks to see if there is a value in the key
   *
   * @param {Object} obj - the nested object to search
   * @param {...Spread} required - the Spread containing the keys
   * @return {Boolean} true if there is at least one key value
   */
  containsValue: function(obj, contains, ...key) {
    const values = Utils.deepValues(obj, ...key);
    return _.contains(values, contains);
  },

  /**
   * @deprecated No known callers (except in utils.test.js)
   *
   * returns the object difference between two objects
   *
   * @param {Object} compare1 - the original object
   * @param {Objext} compare2 - the oject with the suspected change
   */
  findDelta: function(compare1, compare2) {
    sails.log.debug('Utils.findDelta has no known callers, please remove');
    const diff = require('deep-diff').diff;
    return diff(compare1, compare2);
  },

  /**
   * @deprecated Please use CommonUtils.deepValues
   * gets an array of all the values with the specified keys
   *
   * @param {Object} obj - the nested object to search
   * @param {...Spread} required - the Spread containing the keys
   */
  deepValues: function(obj, ...key) {
    const values = [];
    Utils.deepKeys(obj, (val, k) => {
      if (_.contains(key, k)) {
        values.push(val);
      }
      return k;
    });
    return values; // _.remove(values, v => Utils.restrictKeys(v, true));
  },

  /** @deprecated Please use CommonUtils.hasKeysShallow */
  hasKeysShallow: (obj, ...keys) => {
    const keychain = Object.keys(obj);
    const contains = [];
    _.each(keys, key => {
      contains.push(_.contains(keychain, key));
    });
    return _.every(contains);
  },

  /** @deprecated No known callers. Now logs */
  deleteKeys: (obj, ...keys) => {
    Utils.logDeprecationNotice('deleteKeys', true);
    if (_.isArray(obj)) {
      const clone = _.clone(obj);
      for (let i = 0; i < _.size(clone); i++) {
        Utils.deleteKeys(obj[i], keys);
        if (!_.size(obj[i])) {
          obj.splice(i, 1);
        }
      }
    } else if (_.isObject(obj)) {
      const key = keys[0];
      delete obj[key];
      for (const k in obj) {
        Utils.deleteKeys(obj[k], keys);
      }
      keys.pop();
      if (_.isObject(obj) && _.size(keys)) {
        Utils.deleteKeys(obj, keys);
      }
    }
  },

  /**
   * @deprecated No known callers. Now logs.
   * checks to see if the object has keys with series of values
   *
   * @param {Object} obj - the nested object to search
   * @param {...Spread} required - the Spread containing the keys
   */
  hasKeys: (obj, ...keys) => {
    Utils.logDeprecationNotice('hasKeys', true);
    let keychain = [];
    Utils.deepKeys(obj, (val, k) => {
      keychain = _.union(keychain, [k]);
      return k;
    });
    const contains = [];
    _.each(keys, key => {
      contains.push(_.contains(keychain, key));
    });
    return _.every(contains);
  },

  /**
   * @deprecated Please use CommonUtils.deepKeys
   * @description recusively looks at the object and returns values for the keys
   *
   * @param {Object} obj - the nested object to search
   * @param {Function} cb - callback for supporting hasKeys
   */
  deepKeys: (obj, cb) => {
    if (_.isArray(obj)) {
      return obj.map(innerObj => Utils.deepKeys(innerObj, cb));
    } else if (_.isObject(obj)) {
      return _.mapValues(_.mapKeys(obj, cb), val => Utils.deepKeys(val, cb));
    } else {
      return obj;
    }
  },

  /**
   * @deprecated Please use [similie-api-services] IsThis - Note the new
   * function performs a case insensitive search removing the need to supply
   * both upper and lower case options in the input spread.
   * @example const isTrue = IsThis(httpMethod).oneOf('get', 'post', 'put');
   * leastOne
   * checks to see if there is at least one element truethy
   *
   * @param {String|Integer|Boolean} param - param(s) to find
   * @param {Spread} find - spread to contains
   */
  leastOne: function(param, ...find) {
    return _.contains(find, param);
  },

  /**
   * @deprecated Please use CommonUtils.guardItsRequired
   *
   * Allows a simple function for tossing an error
   * for params that aren't supplied
   *
   * @param {...Spread} required - the Spread containing the required
   * @throws error
   */
  itsRequired: (...required) => {
    // we can bind a code to the function
    return alt => {
      if (!_.every(required)) {
        const error = {
          code: (alt || {}).code || Const.code.BAD_REQUEST,
          error:
            (alt || {}).message || Const.err.REQUIRED_PARAMETERS_NOT_SUPPLIED
        };
        throw error;
      }
    };
  },

  /**
   * @deprecated Please use CommonUtils.params.parseObjectValue
   * Prases the JSON of an objet parameter
   *
   * @param {Objext} obj - the object containing the param
   * @param {String} key - the key
   * @return {Object} the object with the parsed key
   */
  parseUrlString: (obj, key) => {
    if (_.isString(obj[key])) {
      obj[key] = JSON.parse(obj[key]);
    }
    return obj;
  },

  /**
   * @todo Move to api/services/Jobs.js - Only caller
   * Recursively removes a directory from the file system
   * Slow function. Should only be used for importing data
   * @param {String} - the path string for the folder
   */
  clearDirectory: function(dir) {
    // stores messages caught during recursion
    const messages = [];
    // recusive function for removing folder
    const recurse = function(directory) {
      // if we have a directory, go
      if (fs.existsSync(directory) && fs.lstatSync(directory).isDirectory()) {
        fs.readdirSync(directory).forEach(function(name) {
          const file = directory.endsWith('/')
            ? directory + name
            : directory + '/' + name;
          try {
            if (fs.lstatSync(file).isDirectory()) {
              recurse(file);
            } else if (fs.lstatSync(file).isFile()) {
              fs.unlinkSync(file);
            }
          } catch (e) {
            // we don't want to stop the recursion
            messages.push(e);
          }
        });

        try {
          fs.unlinkSync(directory);
        } catch (e) {
          // we don't throw the errors, because we want it to recurse
          messages.push(e);
        }
        // turns out it is just a file, lets just remove it
      } else if (fs.existsSync(directory) && fs.lstatSync(directory).isFile()) {
        try {
          fs.unlinkSync(directory);
        } catch (e) {
          // we don't throw the errors, because we want it to recurse
          messages.push(e);
        }
      }
    };

    recurse(dir);
    // if after everything, the directory
    // exists, we wil throw message with all the errors
    if (fs.existsSync(dir)) {
      throw messages.join(' , ');
    }
  },

  /**
   * @deprecated. No known caller. Now logs
   * Utility to clean up res error response
   */
  sendResError: function(res) {
    Utils.logDeprecationNotice('sendResError', true);
    return function(err) {
      sails.log.error(err);
      if (_.isObject(err) && err.status) {
        if (_.isFunction(res[err.status])) {
          return res[err.status](err.error);
        } else {
          return res.negotiate(err.error);
        }
      }
      return res.serverError(err);
    };
  },

  /**
   * @deprecated Moved to SailsExtensions.passiveCallback
   * Helper to clean up logger and callback code
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
   * @deprecated Moved to SailsExtensions.passiveCallback
   * Helper to clean up logger and callback code
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
   * @deprecated No known callers. Now logs
   * Helper to send data
   */
  send: function(res) {
    Utils.logDeprecationNotice('send', true);
    return function(payload) {
      res.send(payload);
    };
  },

  /**
   * @deprecated No known callers. Now logs
   * Helper to for bad request
   */
  bad: function(res) {
    Utils.logDeprecationNotice('bad', true);
    return function(payload) {
      res.badRequest(payload);
    };
  },

  /**
   * @deprecated Please use SailsExtensions.serverError
   * Helper for serverError
   */
  serverError: function(res) {
    return function(payload) {
      res.serverError(payload);
    };
  },

  /** @todo Move to TelemetryAction.test.js only caller (in after) */
  delay: function(timeout = 1) {
    return new Promise(resolve => {
      setTimeout(resolve, this.timeoutVal(timeout));
    });
  },

  /*
   * The asyn library does not iterate so that elements stay in order
   * for dependent asyncronous arrays we use this function.
   *  along with it's helper
   */

  /**
   * @todo Move to config/seeds - only caller is forceAsync which should also
   * be moved
   */
  asyncForEach: async (array, callback) => {
    for (let index = 0; index < array.length; index++) {
      await (function() {
        return new Promise(function(resolve, reject) {
          callback(array[index], index, function(err) {
            if (err) {
              return reject(err);
            }

            resolve();
          });
        });
      })().catch(err => {
        sails.log.error(err);
      });
    }
  },

  /**
   * @description Helper function for for async
   * @todo Move to config/seeds - only caller
   */
  forceAsync: async (array, callback, forward) => {
    await Utils.asyncForEach(array, callback);
    forward();
  },

  /**
   * @deprecated Please use SailsExtensions.setTTL
   * Sets the ttl to the site config
   *
   * @param {object} site - the site object
   */
  setTTL: function(site) {
    if (!site) {
      return;
    }
    const ttl = sails.config.session.ttl || 3600 * 24;
    site.ttl = ttl;
  },

  /**
   * @todo Move to config/seeds.js - only caller
   *
   * isTest
   *
   * returns true if we are in testing env
   * @return {Boolean} - true if in test
   */
  isTest: function() {
    return process.env.NODE_ENV === 'test';
  },

  /**
   * @todo Move to config/seeds.js - only caller
   *
   * isProd
   *
   * returns true if we are in production env
   * @return {Boolean} - true if in production
   */
  isProd: function() {
    return process.env.NODE_ENV === 'production';
  },

  /**
   * @deprecated Please use SailsExtensions.stats
   * Stats
   *
   * helper function for supporting Jobs. Adds the lifecycle functions
   * to the job object
   * @param {Array} Listeners - the lifecycle functions of the job object
   */
  stats: function(listeners) {
    return function(name) {
      _.each(listeners, function(listen, key) {
        Jobs[name].on(key, listen);
      });
    };
  },

  /**
   * @deprecated Please use CommonUtils.asMoney
   */
  asMoney: function(value, currency) {
    currency = currency || 'USD';
    const c = Const.currencies[currency] || {
      symbol: '$'
    };
    return `${c.symbol}${Utils.fixValue(value)}`;
  },

  /**
   * @deprecated Please use CommonUtils.fixDecimalPlaces, note that the new
   * function always returns a string value. Make sure this is what you want
   * in your code after calling or parse.
   *
   * ensure that we get a fixed value for a float.
   *
   * @param {String|Interger|Float} value - the value we are converting
   * @param {Boolean} round - do we round the value
   * @param {Integer} length - what's the length of the returned value
   */
  fixValue: function(value, round, length) {
    length = length || 2;

    if (_.isString(value)) {
      let parse;
      if (_.contains(value, '.')) {
        parse = parseFloat(value);
      } else {
        parse = parseInt(value);
      }

      if (_.isFinite(parse)) {
        value = parse;
      } else {
        return value;
      }
    }

    if (Utils.isFloat(value)) {
      if (round) {
        return Math.round(value, length);
      }
      return value.toFixed(length);
    } else {
      return value;
    }
  },

  /** @deprecated Please use CommonUtils.stripUndefinedIds note extra 's' */
  stripUndefinedId: function(arr) {
    const has = {};
    return _.map(
      _.filter(arr || [], v => {
        if (Utils.isNumeric(v) && !has[v]) {
          has[v] = true;
          return v;
        }
      }),
      f => parseInt(f)
    );
  },

  /**
   * @deprecated Please use IsThis().numericIsh in similie-api-services
   *
   * @param {Number} - Is the string/into a number
   * @return {Boolean} - true if object type equals 'number'
   */
  isNumeric: function(n) {
    return !_.isNaN(parseInt(n));
  },

  /**
   * @deprecated Please use IsThis() in similie-api-services
   *
   * @param {Number} - Is the object a number
   * @return {Boolean} - true if object type equals 'number'
   */
  isNumber: function(n) {
    return typeof n === 'number';
  },

  /**
   * @deprecated Please use IsThis() in similie-api-services
   *
   * @param {Number} - Is this a floating point number
   * @return {Boolean} - true if is a float
   */
  isFloat: function(n) {
    return typeof n === 'number' && n === +n && Math.round(n) !== n;
  },

  /** @deprecated No known callers. Now logs */
  placeSecondZero: function(value) {
    Utils.logDeprecationNotice('placeSecondZero', true);
    let stringSec = value.toString();
    if (_.size(stringSec) <= 1) {
      stringSec = '0' + stringSec;
    }
    return stringSec;
  },

  /**
   * @deprecated Please use IsThis() in similie-api-services
   *
   * @param {Number} - Is this a integer point number
   * @return {Boolean} - true if is a float
   */
  isInteger: function(n) {
    return typeof n === 'number' && n === +n && Math.round(n) === n;
  },

  /**
   * @deprecated Please use IsThis() in similie-api-services
   *
   * @param {Number} - the value we want to ensure is a number
   * @return {Boolean} - true if is a float
   */
  isFloatOrInteger: function(n) {
    return this.isFloat(n) || this.isInteger(n);
  },

  /**
   * @deprecated Please use IsThis() in similie-api-services
   *
   * @param {Number} - if there
   * @return {Boolean} - true if is a non-zero number
   */
  isNonZeroFloatOrInteger: function(n) {
    return this.isFloatOrInteger(n) && n > 0;
  },

  /**
   * @deprecated Please use IsThis() in similie-api-services
   *
   * @param {Number} - if there
   * @return {Boolean} - true if is a non-zero integer
   */
  isNonZeroInteger: function(n) {
    return this.isInteger(n) && n > 0;
  },

  /**
   * @deprecated Please use CommonUtils.params.deleteFieldFromRequest. Note
   * that the refactored function returns a mutated copy of the input req and
   * reverses the order of the input parameters.
   * @example let req = CommonUtils.params.deleteFieldFromRequest(req, 'key')
   */
  deleteFromRequest: function(param, req) {
    // const removal = (p, query) => {};
    if (_.size(req.query)) {
      delete req.query[param];
    }

    if (_.size(req.body)) {
      delete req.body[param];
    }
  },

  /**
   * @deprecated Please use SailsExtensions.stripObjects
   * stripObjects
   *
   * This function removes the objects from associted models. With associations,
   * they will not save if their associated mode or collection is an object
   * instead of an integer
   *
   * @param {Object} - the object that needs to be stripped
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
   * @deprecated Please use CommonUtils.security.uuid
   *
   *
   * builds a UUID token
   * @return {UUID} - v4
   */
  buildToken: function() {
    return uuid.v4();
  },

  /** @deprecated Please use CommonUtils.populateNotNullRecords */
  populateNotNullRecods: function(records, ...values) {
    const population = [];
    for (let i = 0; i < _.size(records); i++) {
      const record = records[i];
      let has = true;
      _.each(values, find => {
        if (record[find] == null) {
          has = false;
        }
      });
      if (has) {
        population.push(record);
      }
    }
    return population;
  },

  /**
   * @deprecated Please use SqlUtils.concatTableNames
   *
   * concatinates table names used in report queries
   * @param {Array} names - string array with table names
   * @param {Function} template - an underscore template to store string
   * @param {Sting} schema - name of db schema
   */
  concatTableNames: function(names, template, schema) {
    let concat = '';

    _.each(names, function(name, i) {
      const union = template({
        table_name: name,
        schema: schema
      });

      if (union) {
        concat += union;
      }

      if (i >= _.size(names) - 1) {
        concat += ' ';
        return;
      }

      concat += ' UNION ';
    });

    return concat;
  },

  /**
   * @todo Move to api/services/csv.js - only caller
   * recurseObject
   *
   * Recurses an object key looping to build sub-objects
   * based on the "foo.bar" pattern. It builds the object
   * such as {foo: {bar: 1}}
   *
   * @param {String} key - the key value
   * @param {Object} model - generally an empty object
   * @param {Integer|Float|String} - the value to place
   *
   */
  recurseObject: function(key, model, record) {
    const broken = key.split('.');

    if (broken.length > 1) {
      const hold = broken.shift();
      model[hold] = model[hold] || {};
      Utils.recurseObject(broken.join('.'), model[hold], record);
    } else {
      // base case. We store the record
      if (record && record !== 'undefined') {
        model[key] = record;
      }
      // populateRecord(model, key, record);
    }
  },

  /** @todo Move to api/models/Domain.js - only caller */
  indexOf: function(arr, key, value) {
    const values = _.pluck(arr, key);
    return _.indexOf(values, value);
  },

  /**
   * @deprecated Please use SailsExtensions.streamOne
   * streamOne
   *
   * Overrides sails.js blueprints for streamOne
   *
   * @param {Object} req - the request object
   * @param {Object} res - the response object
   * @param {Function} cb - callback
   *
   */
  streamOne: function(req) {
    const getSocket = req.socket;
    const Model = actionUtil.parseModel(req);
    const pk = actionUtil.requirePk(req);
    Model.stream(pk).pipe(getSocket.emit);
  },

  /**
   * @deprecated Please use SailsExtensions.findOne
   *
   * findOne
   *
   * Overrides sails.js blueprints for findOne
   *
   * @param {Object} req - the request object
   * @param {Object} res - the response object
   * @param {Function} cb - callback
   *
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
   * @deprecated Please use SailsExtensions.streamParser
   *
   * streamParser
   *
   * Overrides sails.js blueprints for stream
   *
   * @param {Object} req - the request object
   * @param {Object} res - the response object
   * @param {Function} cb - callback
   *
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
      return Utils.streamOne(req, res, cb);
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
   * @todo Move to api/models/User.js and re-reference calls
   * permitUser
   *
   * checks to see if a user has permission to access a node or station schema
   *
   * @param {Object} user - the user object
   * @param {Object} schema - the schema object
   */
  permitUser: function(user, schema) {
    if (User.is(user, Roles.SITE_ADMIN)) {
      return schema;
    }
    const scheme = _.clone(schema.schema);
    _.remove(scheme, function(s) {
      return (
        !s ||
        !s.active ||
        (!User.is(user, Roles.SITE_ADMIN) &&
          s.restrictions &&
          !user.hasAccess(
            {
              entity: 'param' // remove if the the param is in active and the user is not
            },
            [s.restrictions]
          ))
      );
    });
    schema.schema = scheme;
    return schema;
  },

  /*
   * getParser
   *
   * Overrides sails.js blueprints for find
   *
   * @param {Object} req - the request object
   * @param {Object} res - the response object
   * @param {Function} cb - callback
   *
   */

  /** @todo Move to api/policies/protectApi.js - only caller */
  transformPermitActions: function(action) {
    const transforms = {
      find: 'get',
      findOne: 'get',
      destroy: 'delete',
      create: 'post',
      update: 'put'
    };
    return transforms[action] || action;
  },

  /** @deprecated Please use SailsExtensions.actionUtil */
  actionUtil: function() {
    return actionUtil;
  },

  /** @deprecated Please use SailsExtensions.params */
  params: function(req) {
    return actionUtil.parseCriteria(req);
  },
  /** @deprecated Please use SailsExtensions.limit */
  limit: function(req) {
    return actionUtil.parseLimit(req);
  },
  /** @deprecated Please use SailsExtensions.sort */
  sort: function(req) {
    return actionUtil.parseSort(req);
  },
  /** @deprecated Please use SailsExtensions.skip */
  skip: function(req) {
    return actionUtil.parseSkip(req);
  },

  /** @deprecated Please use SailsExtensions.getParser */
  getParser: function(req, res, cb) {
    // Look up the model
    const Model = actionUtil.parseModel(req);
    // If an `id` param was specified, use the findOne blueprint action
    // to grab the particular instance with its primary key === the value
    // of the `id` param.   (mainly here for compatibility for 0.9, where
    // there was no separate `findOne` action)
    if (actionUtil.parsePk(req)) {
      return Utils.findOne(req, res, cb);
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

  /**
   * @deprecated Please use CommonUtils.pullHost
   *
   * Pulls the host based on the config
   * @param {Object} config - the config of the site
   */
  pullHost: function(config) {
    const env = process.env.NODE_ENV;
    const deploy = process.env.DEPLOYMENT;
    const flavor = env === 'production' ? '' : '_DEV';

    const security =
      config.secure_protocol != null
        ? config.secure_protocol
          ? 'https://'
          : 'http://'
        : '';

    if (process.env.LOCAL_OVERRIDE_URL) {
      return _.contains(process.env.LOCAL_OVERRIDE_URL, 'http')
        ? process.env.LOCAL_OVERRIDE_URL
        : `${security}${process.env.LOCAL_OVERRIDE_URL}`;
    }

    return (
      security + (config || {}).site_url ||
      process.env['HOST_NAME_' + deploy + flavor] ||
      'localhost'
    ); // || sails.getBaseUrl();
  },

  /**
   * @deprecated Please use SailsExtensions.broadcastSocketMessage which
   * contains a 3rd param for specifying the broadcast name. If omitted
   * will replicate this function.
   *
   * sendexcelMessage
   *
   * sends the message over socets when an excel is finished building
   * @param {Object} err - any errors
   * @param {Object} message - the finished file
   */
  sendexcelMessage: function(err, message) {
    const socket = message.socket;

    if (err) {
      sails.log.error(err);
      message = {};
      message.error = err.message;
    }

    try {
      sails.sockets.broadcast(socket, 'excel_report_compiled', message);
    } catch (e) {
      sails.log.error(e);
    }
  },

  /**
   * @deprecated Please use CommonUtils.transformAttributes
   *
   * pulls the attribute type for the node
   *
   * @param {Object} attr - the attibute array
   * @return {Array} - the transformed attibute array
   */
  transformAttributes: function(attr) {
    const attrTransformed = {};

    _.each(attr, function(attr, key) {
      let selector = 'type';

      if (!attr[selector]) {
        selector = 'model';
      }
      if (!attr[selector]) {
        selector = 'collection';
      }

      attrTransformed[key] = attr[selector];
    });

    return attrTransformed;
  },

  /**
   * @deprecated Please use CommonUtils.imaging.randomColor()
   * color
   *
   * creates a random hex color
   */
  color: function() {
    return (
      '#' +
      Math.random()
        .toString(16)
        .slice(2, 8)
    );
  },

  /**
   * @todo Move to api/services/csv.js - only caller
   * linkObject
   *
   * Links objects based on the variable id
   *
   * @param {Collection} values - the variables
   * @return {Function[id]}
   */
  linkObject: function(values) {
    return function(id) {
      if (!id) {
        return;
      }
      const result = _.where(values, {
        id: id
      });
      if (result.length) {
        return result[0];
      } else {
        return {};
      }
    };
  },

  /**
   * @deprecated Please use CommonUtils.parseLocals
   *
   * @description Refactored from Email.parseLocals. Included the single use
   * function 'walkValues' as a private function.
   * @param stringValue {String} A formatted string with replacement locations
   * to match against key-values in the 'locals' object
   * @param locals {Object} An object containing one or more key-value pairs
   * @param nullify {Boolean} Optional True|False to indicate whether to
   * replace any undefined values for a given key with 'NULL' or 'UNDEFINED'
   * defaults to false if not specified.
   * @returns {String} The input string with key-value replacements transformed
   * to contain the values in the corresponding field of the input object.
   */
  parseLocals: function(stringValue, locals, nullify) {
    /// \#[0-9a-fA-F]+?\'/gm
    // eslint-disable-next-line no-useless-escape
    const matches = (stringValue || '').match(/\%(.[^\s]*?)\%/g); /// /\%[0-9a-fA-F]+?\%/gm);
    if (!matches || !matches.length) {
      return stringValue;
    }

    /** @summary in-line recursive function to split mutlipart keys */
    const walkValues = function(split, locals) {
      const key = split.shift();
      if (!_.size(split)) {
        return _.isObject(locals) ? locals[key] : null;
      } else {
        return walkValues(split, locals[key]);
      }
    };

    _.each(matches, match => {
      const key = match.replaceAll('%', '');
      let value;
      if (_.contains(key, '.')) {
        const split = key.split('.');
        value = walkValues(split, locals);
      } else {
        value = locals[key];
      } // else (if)?
      if (key === '<br/>') {
        stringValue = stringValue.replaceAll(match, '\n');
      } else {
        if (!_.isUndefined(value)) {
          let local;
          if (value == null) {
            local = nullify ? 'NULL' : 'UNKNOWN';
          } else {
            local = value;
          }
          stringValue = stringValue.replaceAll(match, local);
        } else if (nullify) {
          stringValue = stringValue.replaceAll(match, 'NULL');
        }
      }
    });

    return stringValue;
  },

  /// //////////////////////////////////////////////////
  /// Refactored to Time.js. Need to test no dependencies
  /// //////////////////////////////////////////////////

  /**
   * @description Logs a standard deprecation notice to the developer console
   * @param {string} functionName
   * @param {boolean} hasNoCallers
   */
  logDeprecationNotice: (functionName, hasNoCallers) => {
    let s = `Utils.${functionName} is deprecated.`;
    if (hasNoCallers) {
      s += ' No known callers.';
    } else {
      s += ' Please see the deprecation notice for more info';
    }

    sails.log.debug(s);
  },

  throwRefactoredError: (functionName, libraryName) => {
    if (!libraryName) libraryName = 'TimeUtils';
    const msg = forwardingMsg.replace('%s', libraryName);

    throw new Error(`
      ${thisLib} 
      [${functionName}] 
      ${notSupported}
      ${msg}
      `);
  }

  /// ///////////////////////////////////////////////////////////////
  /// Refractured. Need to test there are no dependencies
  /// //////////////////////////////////////////////////////////////

  // to services/Geo.js
  // addGeo: function(params) {
  //   return Geo.addGeo(params);
  // },

  // in models/Report.js
  // combinelike: function(type) {
  //   return Report.combinelike(type);
  // },

  // setAggregates: function(r, attr, action, hold, send) {
  //   return Report.setAggregates(r, attr, action, hold, send);
  // },

  // buildReport: function(params) {
  //   return Report.buildReport(params);
  // },

  // getReportParams: function(report) {
  //   return Report.getReportParams(report);
  // },

  // querySet: function(params, schema, query) {
  //   return Report.querySet(params, schema, query);
  // },

  /// ///////////////////////////////////////////////////////////////////////
  /// Refractured to Node.js. Need to test there are no further dependencies
  /// ///////////////////////////////////////////////////////////////////////

  // pullPoints: function(params) {
  //   return Node.pullPoints(params);
  // },

  // stripAssociations: function(params) {
  //   return Node.stripAssociations(params);
  // },

  // stripper: function(indeces, model) {
  //   return Node.stripper(indeces, model);
  // },

  // convertQuery: function(params) {
  //   return Node.convertQuery(params);
  // },

  // getSchemaVariables: function(schema) {
  //   return Node.getSchemaVariables(schema);
  // },

  // sendNode: function(payload, schema, where) {
  //   return Node.sendNode(payload, schema, where);
  // },

  // updateOrCreate: function() {
  //   return Node.updateOrCreate();
  // },

  // parseSchema: function(params) {
  //   return Node.parseSchema(params);
  // },

  // pullSchema: function(params, res, user) {
  //   return Node.pullSchema(params, res, user);
  // },

  // deleteNode: function(req) {
  //   return Node.deleteNode(req);
  // },

  // getActiveParamList: function(schema) {
  //   return Node.getActiveParamList(schema);
  // },

  // parseWhere: function(where, schema, model) {
  //   return Node.parseWhere(where, schema, model);
  // },

  // countNode: function(req) {
  //   return Node.countNode(req);
  // },

  // setOrder: function(order, model) {
  //   return Node.setOrder(order, model);
  // },

  // findNodes: function(params, schema) {
  //   return Node.findNodes(params, schema);
  // },

  // countNodes: function(where, schema) {
  //   return Node.countNodes(where, schema);
  // },

  // queryNode: function(s, params, next) {
  //   return Node.queryNode(s, params, next);
  // },

  // getNodeNoReq: function(params) {
  //   return Node.getNodeNoReq(params);
  // },

  // getNode: function(req) {
  //   return Node.getNode(req);
  // },

  // nodeReports: function(params) {
  //   return Node.nodeReports(params);
  // },

  // findBetween: function(where) {
  //   return Node.findBetween(where);
  // }
};

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/ceil
// Closure
(function() {
  /**
   * Decimal adjustment of a number.
   *
   * @param {String}  type  The type of adjustment.
   * @param {Number}  value The number.
   * @param {Integer} exp   The exponent (the 10 logarithm of the adjustment base).
   * @returns {Number} The adjusted value.
   */
  function decimalAdjust(type, value, exp) {
    // If the exp is undefined or zero...
    if (typeof exp === 'undefined' || +exp === 0) {
      return Math[type](value);
    }
    value = +value;
    exp = +exp;
    // If the value is not a number or the exp is not an integer...
    if (isNaN(value) || !(typeof exp === 'number' && exp % 1 === 0)) {
      return NaN;
    }
    // Shift
    value = value.toString().split('e');
    value = Math[type](+(value[0] + 'e' + (value[1] ? +value[1] - exp : -exp)));
    // Shift back
    value = value.toString().split('e');
    return +(value[0] + 'e' + (value[1] ? +value[1] + exp : exp));
  }

  // Decimal round
  if (!Math.round10) {
    Math.round10 = function(value, exp) {
      return decimalAdjust('round', value, exp);
    };
  }
  // Decimal floor
  if (!Math.floor10) {
    Math.floor10 = function(value, exp) {
      return decimalAdjust('floor', value, exp);
    };
  }
  // Decimal ceil
  if (!Math.ceil10) {
    Math.ceil10 = function(value, exp) {
      return decimalAdjust('ceil', value, exp);
    };
  }
})();
