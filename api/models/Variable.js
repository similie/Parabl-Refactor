/**
 * Variable.js
 *
 * @description :: TODO: You might write a short summary of how this model works and what it represents here.
 * @docs        :: http://sailsjs.org/#!documentation/models
 */

const { ident } = require('pg-escape');
const Q = require('q');

module.exports = {
  attributes: {
    key: {
      type: 'string'
    },
    value: {
      type: 'json'
    },
    order: {
      type: 'integer',
      min: 0
    },
    identity: {
      type: 'string'
    },
    locked: {
      type: 'boolean',
      defaultsTo: false
    },

    domain: {
      model: 'domain'
    },

    meta: {
      type: 'json'
    },

    getLanguageValue: function(language) {
      const variable = this.toObject();
      const value =
        variable.value[language] || Variable.getFirstLanguage(variable);
      return value;
    }
  },
  getFirstLanguage: function(variable) {
    let value = '';
    for (const v in variable.value) {
      const content = variable.value[v];
      if (content) {
        value = content;
        break;
      }
    }
    return value;
  },
  varCache: function(variables, language) {
    const vCache = {};
    for (let i = 0; i < _.size(variables); i++) {
      const v = variables[i] || {};
      if (!v.value || !v.identity) {
        continue;
      }
      vCache[v.identity] = language ? v.value[language] : v;
    }
    return vCache;
  },

  /*
   * mergeVariables
   *
   * This is where we can merge our variables to make it so that
   * we favor the domain-centric vars over the site
   *
   * @param {Collection} variables - all the variables
   * @param {Object|Integer} domain - the domain
   * @return {Collection} the altered variables
   */
  mergeVariables: async function(variables, domain) {
    /*
     * If we are null domain, move on
     */
    if (!domain) {
      return variables;
    }

    Utils.itsRequired(variables);
    const nullVars = _.where(variables, { domain: null });
    const dVars = _.filter(variables, v => {
      return Variable.getId(v.domain) != null;
    });
    const dWhere = {};
    // lets stick this in an object so we have
    // constant time searching for the variables
    _.each(dVars, function(dvar) {
      dWhere[dvar.identity] = dvar;
    });
    // this will be the array we send back
    const alteredVars = [];
    // dont repeat
    const repeats = {};
    // do the nulls
    _.each(nullVars, function(nulls) {
      const identity = nulls.identity;
      const key = nulls.key;
      // if we have a variable that is the same as the domain,
      // favor this one
      if (
        dWhere[identity] &&
        dWhere[identity].key === key &&
        repeats[identity] !== key
      ) {
        const clone = _.clone(dWhere[identity]);
        alteredVars.push(clone);
        // delet this variable
        repeats[identity] = key;
        delete dWhere[identity];
      } else if (repeats[identity] !== key) {
        // otherwise push the null to altered
        alteredVars.push(nulls);
      }
    });
    // now stuff any leftovers into the vars
    _.each(dWhere, function(leftover) {
      // we only want unique records
      if (!repeats[leftover.identity] !== leftover.key) {
        alteredVars.push(leftover);
      }
    });

    return alteredVars;
  },

  resolveKeys: function(schemas, union) {
    const variables = [];

    _.each(schemas, scheme => {
      _.each(scheme.schema, s => {
        if (s.type === 'variable' && s.active) {
          variables.push(s.name);
        }
      });
    });

    return _.union(variables, union || []);
  },

  /*
   * resolveVariables
   *
   * resoves variables parameters found in nodes
   * @param {String} scheme - the node scheme with vars
   * @param {Object} extras - any extras that need resoution for concatination
   * @param {Boolean} collate - the ability to concat the extras
   * @return {Promise} - the variables that need resolution
   */
  resolveVariables: function(scheme, extras, collate) {
    const deferred = Q.defer();
    const getVariable = function(variables) {
      if (variables && !variables.length) {
        return deferred.resolve(variables);
      }

      Variable.find({
        key: variables
      })
        .populateAll()
        .exec((err, vars) => {
          if (err) {
            return deferred.reject(err);
          }

          deferred.resolve(vars);
        });
    };

    let formulate = [];

    if (collate) {
      _.each(scheme, s => {
        const col = s[collate];
        if (col && col.length) {
          _.each(col, c => {
            formulate.push(c);
          });
        }
      });
    } else {
      formulate = scheme;
    }
    const variables = [];
    _.each(formulate, s => {
      if (s.type === 'variable' && s.active) {
        variables.push(s.name);
      }
    });
    getVariable(_.unique(_.union(variables, extras || [])));
    return deferred.promise;
  },

  beforeDestroy: function(values, next) {
    const id = (values.where || values).id;

    if (!id) {
      sails.log.error('DESTROY USER:: There is no id for deletion');
      return next(true);
    }

    sails.models.variable.findOneById(id).exec((err, vars) => {
      if (err) {
        return next(err);
      }

      if (vars && vars.locked) {
        return next('errors.LOCKED_VARIABLE');
      }

      next();
    });
  },

  pullImports: function(values, next) {
    // if we don't have import data, lets go
    if (!values.meta || !values.meta.import) {
      return next();
    }
    const importValues = _.clone(values.meta.import);
    delete values.meta.import;
    const stringValues = [];
    _.each(importValues, imp => {
      stringValues.push(imp);
    });

    if (!_.size(stringValues)) {
      return next();
    }

    Variable.pullType(stringValues, (err, variables) => {
      if (err) {
        return next(err);
      }
      _.each(importValues, (obj, key) => {
        const found = _.where(variables, {
          key: obj.key,
          identity: obj.identity
        });
        if (_.size(found)) {
          values[key] = (found[0] || {}).id;
        }
      });

      next();
    });
  },

  pullType: function(params, cb) {
    if (
      !params ||
      (_.isObject(params) &&
        !_.isArray(params) &&
        !(params.key || params.identity))
    ) {
      return cb('warning.INVALID_REQUEST');
    }

    let query;
    if (_.isArray(params)) {
      if (params.length) {
        const arrQ = { or: params };
        query = sails.models.variable.find(arrQ);
      } // if it is empty, do not search
      else {
        return cb(null, []);
      }
    } else if (_.isObject(params)) {
      const q = {
        key: params.key,
        identity: params.identity
      };
      query = sails.models.variable.findOne(q);
    }

    query.exec((err, models) => {
      if (err) {
        sails.log.error(err);
        return cb(err);
      }
      if (!_.size(models)) {
        return cb('errors.UNDEFINED_VARIABLE_MODELS');
      }

      cb(null, models);
    });
  },

  csvIdentity: function() {
    return ['identity'];
  },

  isVariableLike: function(param) {
    const inType = ['variable', 'multi_select'];
    return inType.indexOf(param.type) !== -1;
  },

  pullTypeAsync: function(params) {
    return new Promise((resolve, reject) => {
      this.pullType(params, (err, vars) => {
        if (err) {
          return reject(err);
        }
        resolve(vars);
      });
    });
  },

  findVariableByParamName: async function(param) {
    const tIdentiy = Translates.translateIdentity;
    const variable = await Variable.find().where({
      key: tIdentiy,
      identity: param.label || param.name
    });
    return variable.pop();
  },

  getMachineParamName: function(variable) {
    const identity = variable.identity;
    const stripped = (identity || '')
      .replace('labels.', '')
      .replace('label.', '');
    return stripped.toLowerCase();
  },

  getStationVarsForNodes: async function() {
    const paramHold = {};
    const stationValues = [
      'label.IS_GLOBAL',
      'labels.OBSERVER',
      'labels.SITE_STATIONS',
      'labels.LOCAL_NAME'
    ];
    const tIdentiy = Translates.translateIdentity;
    const variables = await Variable.find().where({
      key: tIdentiy,
      identity: stationValues
    });
    variables.forEach(v => {
      paramHold[this.getMachineParamName(v)] = v.value;
    });

    return paramHold;
  },

  getLanguageContent: async function(
    identity,
    lang = Translates.fallbackLanguage,
    key = Translates.translateIdentity
  ) {
    if (!identity) {
      throw new Error('Variable identity is required');
    }

    const variable = await this.find().where({ key: key, identity: identity });
    if (!variable.length) {
      throw new Error('Identity not found');
    }
    const value = variable.pop();
    return value.getLanguageValue(lang);
  },

  getLabelVars: async function(schema = []) {
    const paramHold = await this.getStationVarsForNodes();
    for (let i = 0; i < schema.length; i++) {
      const param = schema[i];
      const variable = (await this.findVariableByParamName(param)) || {};
      paramHold[param.name] = variable.value;
    }
    return paramHold;
  },

  getParamVars: async function(schema = []) {
    const searchVariables = [];
    for (let i = 0; i < schema.length; i++) {
      const param = schema[i];
      if (this.isVariableLike(param)) {
        searchVariables.push(param.name);
      }
    }
    const send = {};
    for (let i = 0; i < searchVariables.length; i++) {
      const search = searchVariables[i];
      const variables = await Variable.find()
        .where({ key: search })
        .sort({ order: 'ASC', key: 'ASC' });
      variables.forEach(v => {
        send[Variable.getId(v)] = v.value;
      });
    }
    return send;
  },

  getSchemaVariables: async function(schema = []) {
    const send = {};
    send.labels = await this.getLabelVars(schema);
    send.params = await this.getParamVars(schema);
    return send;
  },

  requiresKey: true
};
