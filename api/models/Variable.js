/**
 * Variable.js
 *
 * @description :: TODO: You might write a short summary of how this model works and what it represents here.
 * @docs        :: http://sailsjs.org/#!documentation/models
 */

const commonUtils = require('../utils/common')

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

    /**
     * Retrieves the value of the variable for a specific language.
     * @param {string} language - The language code.
     * @returns {string} - The value of the variable in the specified language.
     */
    getLanguageValue: function(language) {
      const variable = this.toObject();
      const value =
        variable.value[language] || Variable.getFirstLanguage(variable);
      return value;
    }
  },

  /**
   * Retrieves the first available language value from a variable.
   * @param {Object} variable - The variable object.
   * @returns {string} - The first language value found.
   */
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

  /**
   * Caches variables by their identity and language.
   * @param {Array} variables - The array of variable objects.
   * @param {string} language - The language code.
   * @returns {Object} - The cached variables.
   */
  varCache: function(variables, language) {
    const vCache = {};
    for (let i = 0; i < commonUtils.size(variables); i++) {
      const v = variables[i] || {};
      if (!v.value || !v.identity) {
        continue;
      }
      vCache[v.identity] = language ? v.value[language] : v;
    }
    return vCache;
  },

  /**
   * Merges variables, prioritizing domain-specific variables over site-wide ones.
   * @param {Array} variables - The collection of variables.
   * @param {Object|number} domain - The domain object or ID.
   * @returns {Promise<Array>} - The merged variables.
   */
  mergeVariables: async function(variables, domain) {
    if (!domain) {
      return variables;
    }

    Utils.itsRequired(variables);
    const nullVars = commonUtils.where(variables, { domain: null });
    const dVars = commonUtils.filter(variables, v => {
      return Variable.getId(v.domain) != null;
    });
    const dWhere = {};
    commonUtils.each(dVars, function(dvar) {
      dWhere[dvar.identity] = dvar;
    });
    const alteredVars = [];
    const repeats = {};
    commonUtils.each(nullVars, function(nulls) {
      const identity = nulls.identity;
      const key = nulls.key;
      if (
        dWhere[identity] &&
        dWhere[identity].key === key &&
        repeats[identity] !== key
      ) {
        const clone = commonUtils.clone(dWhere[identity]);
        alteredVars.push(clone);
        repeats[identity] = key;
        delete dWhere[identity];
      } else if (repeats[identity] !== key) {
        alteredVars.push(nulls);
      }
    });
    commonUtils.each(dWhere, function(leftover) {
      if (!repeats[leftover.identity] !== leftover.key) {
        alteredVars.push(leftover);
      }
    });

    return alteredVars;
  },

  /**
   * Resolves keys from schemas and unions them with existing keys.
   * @param {Array} schemas - The array of schema objects.
   * @param {Array} union - The array of keys to union with.
   * @returns {Array} - The resolved keys.
   */
  resolveKeys: function(schemas, union) {
    const variables = [];

    commonUtils.each(schemas, scheme => {
      commonUtils.each(scheme.schema, s => {
        if (s.type === 'variable' && s.active) {
          variables.push(s.name);
        }
      });
    });

    return commonUtils.union(variables, union || []);
  },

  /**
   * Resolves variables from a scheme, with optional extras and collation.
   * @param {string} scheme - The node scheme with variables.
   * @param {Object} extras - Additional variables for resolution.
   * @param {boolean} collate - Whether to concatenate extras.
   * @returns {Promise<Array>} - The resolved variables.
   */
  resolveVariables: function(scheme, extras, collate) {
    return new Promise((resolve, reject) => {
      const getVariable = function(variables) {
        if (variables && !variables.length) {
          return resolve(variables);
        }
  
        Variable.find({
          key: variables
        })
          .populateAll()
          .exec((err, vars) => {
            if (err) {
              return reject(err);
            }
  
            resolve(vars);
          });
      };
  
      let formulate = [];
  
      if (collate) {
        commonUtils.each(scheme, s => {
          const col = s[collate];
          if (col && col.length) {
            commonUtils.each(col, c => {
              formulate.push(c);
            });
          }
        });
      } else {
        formulate = scheme;
      }
      const variables = [];
      commonUtils.each(formulate, s => {
        if (s.type === 'variable' && s.active) {
          variables.push(s.name);
        }
      });
      getVariable(commonUtils.unique(commonUtils.union(variables, extras || [])));
    })
  },

  /**
   * Hook to perform actions before destroying a variable.
   * @param {Object} values - The values to destroy.
   * @param {Function} next - The callback function.
   */
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

  /**
   * Pulls import data from values and updates them.
   * @param {Object} values - The values containing import data.
   * @param {Function} next - The callback function.
   */
  pullImports: function(values, next) {
    if (!values.meta || !values.meta.import) {
      return next();
    }
    const importValues = commonUtils.clone(values.meta.import);
    delete values.meta.import;
    const stringValues = [];
    commonUtils.each(importValues, imp => {
      stringValues.push(imp);
    });

    if (!commonUtils.size(stringValues)) {
      return next();
    }

    Variable.pullType(stringValues, (err, variables) => {
      if (err) {
        return next(err);
      }
      commonUtils.each(importValues, (obj, key) => {
        const found = commonUtils.where(variables, {
          key: obj.key,
          identity: obj.identity
        });
        if (commonUtils.size(found)) {
          values[key] = (found[0] || {}).id;
        }
      });

      next();
    });
  },

  /**
   * Retrieves variables based on parameters.
   * @param {Object|Array} params - The parameters for retrieval.
   * @param {Function} cb - The callback function.
   */
  pullType: function(params, cb) {
    if (
      !params ||
      (commonUtils.isObject(params) &&
        !commonUtils.isArray(params) &&
        !(params.key || params.identity))
    ) {
      return cb('warning.INVALID_REQUEST');
    }

    let query;
    if (commonUtils.isArray(params)) {
      if (params.length) {
        const arrQ = { or: params };
        query = sails.models.variable.find(arrQ);
      } else {
        return cb(null, []);
      }
    } else if (commonUtils.isObject(params)) {
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
      if (!commonUtils.size(models)) {
        return cb('errors.UNDEFINED_VARIABLE_MODELS');
      }

      cb(null, models);
    });
  },

  /**
   * Returns the CSV identity fields for a variable.
   * @returns {Array} - The array of CSV identity fields.
   */
  csvIdentity: function() {
    return ['identity'];
  },

  /**
   * Checks if a parameter is variable-like.
   * @param {Object} param - The parameter to check.
   * @returns {boolean} - True if the parameter is variable-like, false otherwise.
   */
  isVariableLike: function(param) {
    const inType = ['variable', 'multi_select'];
    return inType.indexOf(param.type) !== -1;
  },

  /**
   * Asynchronously retrieves variables based on parameters.
   * @param {Object|Array} params - The parameters for retrieval.
   * @returns {Promise<Array>} - The retrieved variables.
   */
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

  /**
   * Finds a variable by its parameter name.
   * @param {Object} param - The parameter object.
   * @returns {Promise<Object>} - The found variable.
   */
  findVariableByParamName: async function(param) {
    const tIdentiy = Translates.translateIdentity;
    const variable = await Variable.find().where({
      key: tIdentiy,
      identity: param.label || param.name
    });
    return variable.pop();
  },

  /**
   * Retrieves the machine parameter name for a variable.
   * @param {Object} variable - The variable object.
   * @returns {string} - The machine parameter name.
   */
  getMachineParamName: function(variable) {
    const identity = variable.identity;
    const stripped = (identity || '')
      .replace('labels.', '')
      .replace('label.', '');
    return stripped.toLowerCase();
  },

  /**
   * Retrieves station variables for nodes.
   * @returns {Promise<Object>} - The station variables.
   */
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

  /**
   * Retrieves language content for a variable.
   * @param {string} identity - The variable identity.
   * @param {string} [lang=Translates.fallbackLanguage] - The language code.
   * @param {string} [key=Translates.translateIdentity] - The key for translation.
   * @returns {Promise<string>} - The language content.
   * @throws Will throw an error if the identity is not found.
   */
  getLanguageContent: async function(identity, lang = Translates.fallbackLanguage, key = Translates.translateIdentity) {
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

  /**
   * Retrieves label variables for a schema.
   * @param {Array} [schema=[]] - The schema array.
   * @returns {Promise<Object>} - The label variables.
   */
  getLabelVars: async function(schema = []) {
    const paramHold = await this.getStationVarsForNodes();
    for (let i = 0; i < schema.length; i++) {
      const param = schema[i];
      const variable = (await this.findVariableByParamName(param)) || {};
      paramHold[param.name] = variable.value;
    }
    return paramHold;
  },

  /**
   * Retrieves parameter variables for a schema.
   * @param {Array} [schema=[]] - The schema array.
   * @returns {Promise<Object>} - The parameter variables.
   */
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

  /**
   * Retrieves schema variables, including labels and parameters.
   * @param {Array} [schema=[]] - The schema array.
   * @returns {Promise<Object>} - The schema variables.
   */
  getSchemaVariables: async function(schema = []) {
    const send = {};
    send.labels = await this.getLabelVars(schema);
    send.params = await this.getParamVars(schema);
    return send;
  },

  requiresKey: true
};
