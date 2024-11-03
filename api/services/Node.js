const Q = require('q');
const FormulaParser = require('hot-formula-parser').Parser;

const { SqlUtils, CommonUtils, TimeUtils } = require('similie-api-services');
const Utils = require('./Utils');

const escape = SqlUtils.escapeUtil();
const actionUtil = Utils.actionUtil();
const knexRef = () => {
  return sails.models.knex;
};

/*
 *
 * Node.js
 *
 *
 * This module supports many of the functions required to support node manipulations.
 *
 * @todo:: all functions are exposed to api. We should only expose those functions required to manage nodes.
 * the remainder should be kept private.
 *
 */

const Local = {
  _getCorrectStationParam: function(params) {
    const station = (params || {}).station || (params.where || {}).station;
    const parsed = parseInt(Station.getId(station));
    if (_.isNaN(parsed)) {
      return null;
    }
    return parsed;
  },

  _isParseableHtml: function(param) {
    const is = Node.paramIs(param);
    return is.text && param.html_filter;
  },

  _shouldStringfy: function(values, param) {
    const is = Node.paramIs(param);
    const v = values[param.name];
    const active = param.active;
    if (
      active &&
      (Node.isArrayLike(param) ||
        is.node ||
        is.user ||
        this._isParseableHtml(param)) &&
      v
    ) {
      values[param.name] = JSON.stringify(v);
    }
  },

  _checkExcessiveValues: function(values, param, alarms) {
    let alarm = false;
    const v = values[param.name];
    const min = param.min;
    const max = param.max;
    const wMin = param.warning_max;
    const wMax = param.warning_max;
    const isNumber = _.isNumber(v);
    const isNotNull = v != null;
    const shouldCheck = isNotNull && isNumber;
    /*
     * Now we set any alarms
     */
    if (shouldCheck && min != null && v < min) {
      alarm = true;
      alarms[param.name] = alarms[param.name] || {};
      alarms[param.name].min = v;
    }

    if (shouldCheck && max != null && v > max) {
      alarm = true;
      alarms[param.name] = alarms[param.name] || {};
      alarms[param.name].max = v;
    }

    if (shouldCheck && wMin != null && v < wMin) {
      alarm = true;
      alarms[param.name] = alarms[param.name] || {};
      alarms[param.name].warning_max = v;
      // trigger event
    }

    if (shouldCheck && wMax != null && v > wMax) {
      alarm = true;
      alarms[param.name] = alarms[param.name] || {};
      alarms[param.name].warning_min = v;
      // trigger event
    }
    return alarm;
  },

  _validValueType: function(param) {
    const is = Node.paramIs(param);
    return (value, type) => {
      return is[type] && !_.isNaN(value);
    };
  },
  /**
   * _applVirtualAttributes
   *
   * Simple solution to support derrived formula
   */
  _applVirtualAttributes: async function(values, param, schema) {
    const virtual = param.virtual;
    if (
      !virtual ||
      !VirtualFunction[virtual.virtual_function] ||
      !values.station
    ) {
      return;
    }

    const validType = this._validValueType(param);

    try {
      const v = await VirtualFunction[virtual.virtual_function](
        virtual,
        values,
        schema,
        'node'
      );

      if (validType(v, 'int')) {
        values[param.name] = parseInt(v);
      } else if (validType(v, 'decimal')) {
        values[param.name] = parseFloat(v);
      } else {
        values[param.name] = _.isNaN(v) ? null : v;
      }
    } catch (e) {
      sails.log.error('_applVirtualAttributes:: Attr error', e, virtual);
    }
  },

  _setParamsValue: function(values, param) {
    let value = values[param.name];
    if (
      param.derived &&
      value != null &&
      !values.id &&
      !this._isParseableHtml(param)
    ) {
      value = null;
    }
    return value;
  },

  _logFormumlaeProgress: function(param, contextAttributes) {
    const noLog = true;
    if (noLog) {
      return _.noop;
    }

    const formula = param.formula;
    sails.log.debug(
      'PARSING:',
      contextAttributes.__station._localname_,
      param.name
    );

    const parsedString = CommonUtils.parseLocals(
      formula,
      contextAttributes,
      true
    );

    sails.log.debug(parsedString);
    return parsed => {
      if (parsed.error) {
        sails.log.error('_logFormumlaeProgress:: ERROR', parsed.error);
      } else {
        sails.log.debug('----------------', parsed);
      }
      sails.log.debug(' ');
    };
  },

  _applyParamFormula: function(values, param, contextAttributes) {
    const formula = param.formula;
    if (!formula) {
      return;
    }

    try {
      const log = this._logFormumlaeProgress(param, contextAttributes);
      const parsed = Node.parseFormula(formula, contextAttributes);
      log(parsed);
      if (!parsed.error) {
        const v = parsed.result;
        values[param.name] = v;
      }
    } catch (e) {
      sails.log.error('_applyParamFormula:: ', e);
    }
  },

  _isRequiredParam: function(values, param, alarms) {
    const required = param.required;
    // we use the directly so that we can test the
    // default value
    let alarm = false;
    if (required && values[param.name] == null && !values.id) {
      alarm = true;
      // alarms.push(NodeSchema.alarmStates(s.name, 'required'));
      alarms[param.name] = alarms[param.name] || {};
      alarms[param.name].required = this._setParamsValue(values, param);
    }

    return alarm;
  },

  _setForDateType: function(values, param) {
    const def = param.default;
    const v = this._setParamsValue(values, param);
    const is = Node.paramIs(param);
    if (v == null && def !== false && def != null) {
      values[param.name] = is.date ? new Date() : def;
    }

    if (is.duration) {
      if (v && v.start && v.end) {
        const start = new Date(v.start).valueOf();
        const end = new Date(v.end).valueOf();
        v.duration = end - start;
      }
    }
  },

  _skuAutoCode: async function(param) {
    const length = param.max_size ? param.max_size : 12;
    const id = await Tracker.findCodeBody(null, length, param);
    return (param.prefix || '') + id;
  },

  _activeBarcodeParams: function(param) {
    const active = param.active;
    const is = Node.paramIs(param);
    return active && is.barcode;
  },

  _restrictValueTypesForBarcode: function(value = '', prefix = '') {
    return `${prefix}${value}`.replaceAll(' ', '_');
  },

  _setForBarcodingType: async function(values, param) {
    const v = this._setParamsValue(values, param);
    if (this._activeBarcodeParams(param) && !v) {
      if (param.auto_generate) {
        const value = await this._skuAutoCode(param);
        values[param.name] = this._restrictValueTypesForBarcode(value);
      } else {
        // not sure the purpose of this case. We simply append the value
        values[param.name] = this._restrictValueTypesForBarcode(
          '',
          param.prefix
        );
      }
    } else if (this._activeBarcodeParams(param) && v) {
      values[param.name] = this._restrictValueTypesForBarcode(
        values[param.name]
      );
    }
  },

  _iterateSchemaFirstPass: async function(params, schema, validate) {
    const scheme = schema.schema;
    const localValues = await this._setFormulaLocal(params, schema);
    for (let index = 0; index < _.size(scheme); index++) {
      const s = scheme[index];

      if (NodeSchema.hasPurpose(s, validate)) {
        continue;
      }

      if (!s.virtual) {
        // we run a first pass to get any values required for
        // the virtual function
        this._applyParamFormula(params, s, localValues);
      }

      await this._applVirtualAttributes(params, s, schema);
    }
  },

  _setFormulaLocal: async function(params, schema) {
    const config = await Site.thisSiteAsync(Domain.getId(schema.domain));
    const stationId = Station.getId(params.station);
    const station =
      stationId && stationId !== -1
        ? await Station.findOneById(stationId)
        : {
            schema: {}
          };

    const local = {
      ...params,
      __constants: {
        ...config.constants
      },
      __station: {
        ...{
          _id_: station.id,
          _localname_: station.local_name,
          _station_type_: station.station_type
        },
        ...station.schema
      }
    };

    return local;
  },

  _selfDependent: function(param) {
    const formula = param.formula;
    if (!formula) {
      return true;
    }

    const name = param.name;
    return _.contains(formula, name);
  },

  _iterateSchemaSecondPass: async function(params, schema, validate, alarms) {
    const scheme = schema.schema;
    let alarm = false;
    const localValues = await this._setFormulaLocal(params, schema);
    for (let index = 0; index < _.size(scheme); index++) {
      const s = scheme[index];

      if (NodeSchema.hasPurpose(s, validate)) {
        continue;
      }
      // we do not want to run a second pass if there is a dependency on itself
      if (!this._selfDependent(s)) {
        this._applyParamFormula(params, s, localValues);
      }
      // we apply the formula again to cover the virtual function

      if (this._checkExcessiveValues(params, s, alarms)) {
        alarm = true;
      }

      this._setForDateType(params, s);

      if (this._isRequiredParam(params, s, alarms)) {
        alarm = true;
      }

      this._shouldStringfy(params, s);
      await this._setForBarcodingType(params, s);
    }

    return alarm;
  },

  _applySchemaAttributes: async function(params, schema, validate) {
    const alarms = {};
    // we bust up the passes so that all virtual functions are run before
    // we run it again to run against the local functions
    await this._iterateSchemaFirstPass(params, schema, validate);
    const alarm = await this._iterateSchemaSecondPass(
      params,
      schema,
      validate,
      alarms
    );
    return {
      alarms: alarms,
      alarm: alarm
    };
  },

  _cleanInvalidParams: function(params, nodeschema) {
    const schema = nodeschema.schema || [];
    for (let i = 0; i < schema.length; i++) {
      const scheme = schema[i] || {};
      const type = scheme.type;
      const name = scheme.name;
      const val = params[name];
      if (type === 'date' && val) {
        const date = val.toString();
        if (date.indexOf(' ') !== -1) {
          params[name] = Node.formatDateParam(val);
        }
      }
    }
  },

  _cleanInvalidNumbers: function(params) {
    const _params = _.clone(params);
    for (const name in _params) {
      const pValue = _params[name];
      if (_.isNaN(pValue)) {
        delete params[name];
      } else if (pValue === 'NULL') {
        delete params[name];
      }
    }
  },

  _placeApprovals: function(params, schema) {
    if (!params.id) {
      params.approved =
        !params.id && !_.isUndefined(params.approved)
          ? params.approved
          : !schema.requires_approval;
    }

    params.__available__ =
      params.__available__ == null ? true : params.__available__;
    params.asset_approval = params.asset_approval || {};

    if (!schema.requires_approval && !params.id) {
      params.asset_approval.__local_approval__ = {
        val: '1'
      };
    }
  },

  _placeAlarms: function(params, alerts) {
    params.alarm = params.alarm || alerts.alarm;
    params.alarm_states = Object.assign(alerts.alarms, params.alarm_states); // requires_approva
  },

  _validateStation: async function(params) {
    // parse because it may come in as a String
    if (parseInt(params.station) === -1) {
      return params;
    } else if (!params.station && params.id) {
      return params;
    } else if (!params.station) {
      throw new Error(Const.err.NO_STATION_RECORD_FOUND);
    }

    return Station.findOneById(params.station).then(function(station) {
      if (!station) {
        throw new Error(Const.err.NO_STATION_RECORD_FOUND);
      }

      return params;
    });
  },

  _validateObserver: async function(params) {
    if (params.survey || params.contact) {
      return params;
    } else if (!params.observer && params.id) {
      return params;
    } else if (!params.observer) {
      throw new Error(Const.err.NO_USER_RECORD_FOUND);
    }

    return User.findOneById(params.observer).then(function(user) {
      if (!user) {
        throw new Error(Const.err.NO_USER_RECORD_FOUND);
      }

      return params;
    });
  },

  _isCorrectModelParam: function(where, schema) {
    if (!where || !where.__model) {
      return false;
    }
    const isThis = CommonUtils.isThis;
    const thisIs = isThis(where.__model);
    if (thisIs.numericIsh) {
      const modelId = parseInt(where.__model);
      return modelId === NodeSchema.getId(schema);
    }

    return where.__model === schema.name;
  },

  _saveExistingNode: function(payload) {
    const schema = payload.schema;
    const params = payload.params;
    const query = SqlUtils.knex(knexRef()).withSchema(schema);
    return query.where('id', Model.getId(params)).then(function(found) {
      if (!found || !_.size(found)) {
        throw new Error('errors.NODE_UNDEFINED');
      }

      const f = found.pop();
      params.observer = Model.getId(params.observer || f.observer);
      params.domain = Model.getId(params.domain || f.domain);
      // params.tags = JSON.stringify(params.tags);
      // params.point = JSON.stringify(params.point);
      params.alarm_states = JSON.stringify(
        params.alarm_states || f.alarm_states
      );
      params.updatedAt = new Date();
      // Node.stripAssociations(params)(schema);
      return Node.sendNode(query.update(params).returning('*'), schema).then(
        node => {
          return (node || []).pop();
        }
      );
    });
  },

  _determinConstants: async function(payload) {
    const schema = payload.schema;
    const params = payload.params;
    // firstly, we need to pull the node and find ouw what's changed
    /*
      IF WE HAVE NON mutable parameters we need to update all the
      copied nodes with those non mutable parameters only
      */
    const pull = SqlUtils.knex(knexRef()).withSchema(schema);
    const org = await pull.where('id', Model.getId(params));
    const original = (org || []).pop() || {};
    const set = {};
    _.each(schema.schema, s => {
      if (!s.mutable && params[s.name] && original[s.name] !== params[s.name]) {
        set[s.name] = params[s.name];
      }
    });

    if (_.size(set)) {
      const updateAll = SqlUtils.knex(knexRef()).withSchema(schema);
      await updateAll.where('copy_of', params.id).update(set);
    }
  },

  _applyScannableId: function(params = {}) {
    params.scannable_id = params.scannable_id || Tracker.buildRandomId('uuid');
  },

  _returnQueriedNode: function(payload) {
    const schema = payload.schema;
    const params = payload.params;
    this._applyScannableId(params);
    const query = SqlUtils.knex(knexRef()).withSchema(schema);
    return query
      .insert(params)
      .returning('*')
      .then(function(models) {
        return (Node.sendNode(models, schema) || []).then(function(node) {
          return (node || []).pop();
        });
      });
  },

  _findNotMutableParameters: function(schema = []) {
    const notMutable = [];
    schema.forEach(param => {
      if (!param.mutable) {
        notMutable.push(param.name);
      }
    });
    return notMutable;
  },

  _enforceStrictInventoryLineage: async function(values, schema) {
    const helpers = Module._helpers.logistics();
    await helpers.applyInventorySkuParent(values, schema);
  },

  _enforceConstantStructures: async function(values, schema) {
    await this._enforceStrictInventoryLineage(values, schema);
  },

  _managePreDestroyLogic: async function(nodes = [], schema = {}) {
    const helpers = Module._helpers.logistics();
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      await helpers.setParentDeletion(node, schema);
    }
  }
};

module.exports = {
  restrictValueTypesForBarcode: function(value, prefix) {
    return Local._restrictValueTypesForBarcode(value, prefix);
  },

  overrideConstants: function(values, parent, schema) {
    const notMutable = Local._findNotMutableParameters(schema.schema);
    notMutable.forEach(paramName => {
      values[paramName] = parent[paramName];
    });
  },

  parseFormula: (formula, data) => {
    const parser = new FormulaParser();
    const parsedString = CommonUtils.parseLocals(formula, data, true); // Utils.parseLocals(formula, data, true);
    return parser.parse(parsedString);
  },

  // @TODO: Refactor for similie-api-services.ENUMS.UserRoleRESTPermissions
  roles: {
    delete: 'RECORDER',
    alter: 'RECORDER',
    post: 'MANAGER',
    update: 'MANAGER',
    count: 'VISITOR',
    get: 'VISITOR'
  },

  isVariableType: function(param = {}) {
    const type = param.type;
    return type === 'variable' || type === 'multi_select';
  },

  // @TODO: Move to isThis.
  isTextType: function(s) {
    return s.type === 'text' || s.type === 'string' || s.type === 'barcode';
  },

  textSearchQuery: function(text, query, schema, contains) {
    query.or = query.or || [];
    _.each(schema.schema, function(s) {
      if (Node.isTextType(s)) {
        query.or.push({
          [s.name]: contains
            ? {
                contains: text
              }
            : text
        });
      }
    });
  },

  formatDateParam: function(date) {
    return TimeUtils.isoFormattedDate(date);
  },

  getDateParams: function(schema = []) {
    const holdDate = [];
    for (let i = 0; i < schema.length; i++) {
      const sc = schema[i];
      if (sc.type === 'date') {
        holdDate.push(sc);
      }
    }
    return holdDate.length === 1 ? holdDate.pop() : holdDate;
  },

  /**
   * @summary Returns a constant for global nodes
   */
  GLOBAL_NODE_ID: function() {
    return -1;
  },

  /**
   * @summary pullPoints
   * @description pulls our any geo points for node assets
   * @param {Object} params - params of the node
   * @returns {Function} - the function that can be stuffed into a promise
   */

  pullPoints: function(params) {
    if (_.isString(params)) {
      params = JSON.parse(params);
    }
    return async function(schema) {
      const where = params.where;
      const limit = params.limit || 100;
      const skip = params.skip;
      const model = SqlUtils.knex(knexRef()).withSchema(schema);
      /*
       * Need to fix limit and skip
       */
      if (limit) model.limit(limit);
      if (skip) model.offset(skip);
      const query = Node.parseWhere(where, schema, model);
      // query.andWhere('approved', true);
      query.whereRaw('"geo" IS NOT NULL');
      const values = await query.select(
        sails.models.knex.raw(
          escape(
            "id, geo, '%s' as node_name, '%s' as node_color",
            schema.name,
            schema.color
          )
        )
      );
      const simplifiedValues = [];
      for (let i = 0; i < values.length; i++) {
        const value = values[i];
        const simplified = await Geo.pullSimpleNode(value, 'geo');
        simplifiedValues.push(simplified);
      }
      return simplifiedValues;
    };
  },

  /**
   * @summary stripAssociations
   * @description strips the associations from a node
   * @param {Object} params - params of the node
   * @returns {Function} - the function that can be stuffed into a promise
   */

  stripAssociations: function(params) {
    const self = this;
    return function(schema) {
      self.stripper(
        _.union(_.unique(self.getSchemaVariables(schema.schema)), [
          'observer',
          'domain'
        ]),
        params
      );
      return schema;
    };
  },

  conformist: function(params) {
    return async schema => {
      const conform = {};
      const _schema = [];
      _schema.push(...schema.schema);
      const orm = _.map(this.orm(), o => {
        return {
          name: o.key,
          label: o.label,
          type: o.type
        };
      });
      _schema.push(...orm);
      _schema.push({
        name: 'geo',
        label: 'labels.GEO',
        type: 'string'
      });
      for (let i = 0; i < _.size(_schema); i++) {
        const param = _schema[i];
        const is = Node.paramIs(param);
        const name = param.name;
        const value = params[name];
        if (!value && value !== '0' && !_.isUndefined(params[name])) {
          conform[name] = null;
        }
        if (is.int && _.isString(value)) {
          if (value === '') {
            conform[name] = null;
          } else {
            conform[name] = parseInt(value);
          }
        } else if (is.int && value && value.toString().indexOf('.') !== -1) {
          conform[name] = parseInt(value);
        } else if (is.float && _.isString(value)) {
          if (value === '') {
            conform[name] = null;
          } else {
            conform[name] = parseFloat(value);
          }
        } else if (!_.isUndefined(params[name])) {
          conform[name] = value;
        }
      }
      const _params = _.clone(params);
      _.each(_params, (_p, key) => {
        if (!_.isUndefined(conform[key])) {
          params[key] = conform[key];
        } else {
          delete params[key];
        }
      });
      return schema;
    };
  },

  /**
   * @summary stripper
   * @description supports stripAssociations with recurive functionality
   * @param {Array} indeces - the model keys that have varaibles
   * @param {Object} model - the model that needs to be stripped
   */

  stripper: function(indeces, model) {
    let associates = true;
    const self = this;
    if (!indeces || !indeces.length) {
      associates = false;
    }

    indeces = associates ? indeces : model;
    _.each(indeces, function(value, index) {
      const key = associates ? value : index;
      const m = model[key];

      if (!_.isArray(m) && _.isObject(m)) {
        // needs debugging
        if ((m && m.id) || (m && m.id == null)) {
          model[key] = m.id;
        } else if (associates) {
          delete model[key];
        }
      }
    });

    if (model && model.schema) {
      self.stripAssociations(indeces, model.schema);
    }
  },

  /**
   * @summary convertQuery
   *
   * @description currently passive, but is being called by functions
   *
   * @todo  converty the query to support node manipulationw
   * @param {Object} params - params of the node
   * @return {Function} - the function that can be stuffed into a promise
   */

  convertQuery: function() {
    return function(query) {
      return query;
    };
  },

  /**
   * @summary transformAttributes
   * @description pulls the attribute type for the node
   * @param {Object} attr - the attibute array
   * @returns {Array} - the transformed attibute array
   */
  transformAttributes: function(attr) {
    const attrTransformed = {};
    _.each(attr, function(attr) {
      const selector = 'type';
      attrTransformed[attr.name] = attr[selector];
    });
    return attrTransformed;
  },

  /**
   * @summary getSchemaVariables
   * @description pulls the variable values from schema
   * @param {Object} schema - the node shema
   * @returns {Array} - the variable parameters
   */
  getSchemaVariables: function(schema) {
    const variables = [];
    _.each(schema, function(s) {
      if (s.type === 'variable') {
        variables.push(s.name);
      }
    });
    return variables;
  },

  /**
   * @summary nodeReports
   * @description pulls nodes for reporting
   * @param {Object} params - the query object
   * @return {Promise} - the node
   */

  nodeReports: function(params, site, language) {
    return async function(schema) {
      const query = params.query;
      let where = query.where;

      if (_.isString(where)) {
        where = JSON.parse(where);
      }
      /*
       * Need to fix limit and skip
       */
      if (
        where.__model &&
        (where.__model === schema.name || where.__model === schema.id)
      ) {
        delete where.__model;
      }
      if (schema.is_asset && where.station) {
        await Station.formatAssetQuery(where, schema);
        // TODO: might need to fix this
        delete where.domain;
      }

      const model = SqlUtils.knex(knexRef()).withSchema(schema);
      const find = Node.parseWhere(where, schema, model);
      const escape = SqlUtils.escapeUtil();

      if (!(site || {}).graph_not_approved) {
        const approved = escape(
          `("approved" = true OR "asset_approval"::JSONB -> '__local_approval__'::TEXT -> 'val' = %L)`,
          '1'
        );

        find.where(sails.models.knex.raw(approved));
      }
      // find.debug();

      return Report.querySet(params, schema, find, language).then(
        Node.convertQuery(params)
      );
    };
  },

  /**
   * doNotAvoidWhereParams
   *
   * @description has a list of parameters that should be in and not the clause
   * in a node query where clause
   *
   * @returns {object}
   */
  doNotAvoidWhereParams: function() {
    const avoid = {
      in: true,
      or: true
    };
    return avoid;
  },

  packWhereQuery: function(where, query) {
    const doNotAvoidWhereParams = this.doNotAvoidWhereParams();
    for (const key in query) {
      if (doNotAvoidWhereParams[key]) {
        Object.assign(where, { [key]: query[key] });
      }
    }
    return where;
  },

  applyWhereReducer: function(query) {
    let where = {};
    if (query.where && typeof query.where === 'object') {
      Object.assign(where, query.where);
      where = this.packWhereQuery(where, query);
    } else {
      where = {
        ...query
      };
    }
    return where;
  },

  getNodeWhereSetup: function(req, schema) {
    const _where = actionUtil.parseCriteria(req);
    if (Local._isCorrectModelParam(_where, schema)) {
      delete _where.__model;
    }
    const where = this.applyWhereReducer(_where);
    return where;
  },

  getNodeSetupParts: function(req, model, withLimit = true) {
    const limit = actionUtil.parseLimit(req);
    const skip = actionUtil.parseSkip(req);
    if (withLimit) {
      model.limit(limit);
    }
    model.offset(skip);
  },

  getNodeSetupModel: function(req, schema) {
    const order = actionUtil.parseSort(req);
    const model = SqlUtils.knex(knexRef()).withSchema(schema);
    Node.setOrder(order, model, schema);
    return model;
  },

  applySample: function(model, schema) {
    const name = schema.name;
    model.select(
      sails.models.knex.raw(
        `ROW_NUMBER ( ) OVER (ORDER BY "${name}"."id") AS "__sample__"`
      )
    );
  },

  addSample: function(model, nodedownload) {
    // for testing
    // nodedownload.sample = 100;
    const sqlString = model.toString();
    const query = SqlUtils.knex(knexRef()).withSchema(nodedownload.schema);
    query.from(sails.models.knex.raw(`( ${sqlString} ) "n" `));
    query.select('*');
    if (nodedownload.sample) {
      const escape = SqlUtils.escapeUtil();
      query.whereRaw(
        sails.models.knex.raw(
          escape(`MOD("__sample__", %s ) = 0`, nodedownload.sample)
        )
      );
    }
    return query;
  },

  getNodeSetupModelNoReq: function(nodedownload) {
    const order = (nodedownload.query || {}).sort;
    const schema = new NodeSchema._model(nodedownload.schema);
    const model = SqlUtils.knex(knexRef()).withSchema(schema);
    this.applySample(model, schema);
    Node.setOrder(order, model, schema);
    model.offset(nodedownload.skip || 0);
    if (nodedownload.limit) {
      model.limit(nodedownload.limit);
    }
    // uncomment to debug
    // model.limit(10);
    return model;
  },

  getNodeSetup: function(req, schema, withLimit) {
    const model = this.getNodeSetupModel(req, schema);
    this.getNodeSetupParts(req, model, withLimit);
    return model;
  },

  /**
   * @summary getNode
   * @description gets a node based on req query
   * @param {Object} req - the reqest object
   * @returns {Promise} - the node
   */
  getNode: function(req) {
    return async schema => {
      const where = this.getNodeWhereSetup(req, schema);
      const model = this.getNodeSetup(req, schema);
      return createQueryAndSendNode(where, schema, model);
    };
  },

  /**
   * @summary getNodeStream
   * @description Streams postgres queries
   * @param {Object} nodedownload - nodedownload
   * @param {Object} where - the query
   * @returns {Promise} - the node
   */
  getNodeStream: function(nodedownload) {
    const model = this.getNodeSetupModelNoReq(nodedownload);
    return createQueryForNodeStream(nodedownload, model);
  },

  /**
   * @summary manageAsyncWhere
   * @description works on the where for the string
   * @param {Object} req - the reqest object
   * @returns {Promise} - the node
   */
  manageAsyncWhere: function(req) {
    return async schema => {
      const where = this.getNodeWhereSetup(req, schema);
      const _where = await formatWhereWithAssetQuery(where, schema);
      return this.buildQueryWhereSetup(_where, schema);
    };
  },

  /**
   * @summary getNodeNoReq
   * @description gets a node based on query params
   * @param {Object} params - the query params
   * @returns {Promise} - the node
   */
  getNodeNoReq: function(params) {
    return async function(schema) {
      const where = params.where || {};
      const order = params.sort;
      const limit = params.limit;
      const skip = params.skip;

      delete params.sort;
      delete params.limit;
      delete params.skip;

      if (!_.size(where)) {
        _.merge(where, params);
      }

      const model = SqlUtils.knex(knexRef()).withSchema(schema);
      /*
       * Need to fix limit and skip
       */
      model.limit(limit);
      model.offset(skip);

      Node.setOrder(order, model, schema);

      if (Local._isCorrectModelParam(where, schema)) {
        delete where.__model;
      }

      return createQueryAndSendNode(where, schema, model);
    };
  },

  isArrayLike: function(param) {
    return (
      param.type === 'array' ||
      param.type === 'country' ||
      param.type === 'multi_select'
    );
  },

  /*
   * sendNode
   *
   * sends a completed node back to caller
   *
   * @param {Object} payload - the node payload
   * @param {Object} schema - the node schema
   * @param {Object} where - the where clause
   * @return {Promise} - the node
   */

  sendNode: function(payload, schema, where) {
    const scheme = schema.schema;
    const checkScheme = function(node) {
      if (!_.size(node)) {
        return node;
      }

      _.each(scheme, function(s) {
        if (!s.active) {
          delete node[s.name];
        }
        if (Node.isArrayLike(s)) {
          try {
            // here we need check JSONB
            node[s.name] = JSON.parse(node[s.name]);
          } catch (e) {
            sails.log.error('sendNode:: Schema parse error::', e);
          }
        }
      });

      const user = {};
      const domain = {};
      _.each(node, function(n, key) {
        if (key.startsWith('observer.')) {
          user[key.replace('observer.', '')] = n;
          delete node[key];
        } else if (key.startsWith('domain.')) {
          domain[key.replace('domain.', '')] = n;
          delete node[key];
        }
      });

      if (_.size(user)) {
        node.observer = user;
      }

      if (_.size(domain)) {
        node.domain = domain;
      }

      try {
        node.alarm_states =
          _.isString(node.alarm_states) || !node.alarm_states
            ? JSON.parse(node.alarm_states || '{}')
            : node.alarm_states;
        node.tags =
          _.isString(node.tags) || !node.tags
            ? JSON.parse(node.tags || '[]')
            : node.tags;
        node.files =
          _.isString(node.files) || !node.files
            ? JSON.parse(node.files || '[]')
            : node.files;
      } catch (e) {
        sails.log.error('sendNode:: final error:: ', e);
      }
    };

    const iterate = function(nodes) {
      let send;
      if (!_.isArray(nodes) && _.isObject(nodes)) {
        send = [nodes];
      } else if (_.isArray(nodes)) {
        send = nodes;
      } else {
        throw new Error(Const.err.UNKOWN_TYPE);
      }

      _.each(send, function(node) {
        checkScheme(node);
      });

      return send;
    };

    /*
     * Add geo information
     */

    return Q.when(payload).then(function(p) {
      return Q.when(iterate(p))
        .then(function(values) {
          // schema
          const deferred = Q.defer();
          const promises = [];

          _.each(values, function(value) {
            promises.push(Geo.pullSimpleNode(value, 'geo'));
          });

          Q.allSettled(promises).then(function() {
            deferred.resolve(values);
          });

          return deferred.promise;
        })
        .then(function(values) {
          const vars = [];
          const deferred = Q.defer();
          // pulls the keys that are variables
          _.each(schema.schema, function(s) {
            if (s.active && s.type === 'variable') {
              vars.push(s.name);
            }
          });

          // if none, return
          if (!vars.length) {
            if (_.size(where)) {
              return {
                query: where,
                values: values
              };
            } else {
              // return values;
              deferred.resolve(values);
              return deferred.promise;
            }
          }

          // we get the ids
          const ids = [];
          _.each(values, function(v) {
            _.each(vars, function(key) {
              if (v[key]) {
                ids.push(v[key]);
              }
            });
          });
          // pullGeoJsonNode: function(value, schema, key)
          // find variables

          return Variable.find({
            id: _.unique(ids)
          })
            .then(function(variables) {
              return variables;
            })
            .then(function(variables) {
              // hash them for reduced retrieval time
              const hash = {};
              _.each(variables, function(v) {
                hash[v.id] = v;
              });

              return hash;
            })
            .then(function(variables) {
              // now iterate to replace the keys with the variables
              _.each(values, function(v) {
                _.each(vars, function(key) {
                  v[key] = variables[v[key]];
                });
              });

              if (_.size(where)) {
                return {
                  query: where,
                  values: values
                };
              } else {
                return values;
              }
            });
        })
        .then(async function files(values) {
          const stories = [];
          _.each(schema.schema, function(s) {
            if (s.active && s.type === 'filestory') {
              stories.push(s.name);
            }
          });

          if (!_.size(stories)) {
            return values;
          }

          for (let i = 0; i < values.length; i++) {
            const value = values[i];
            // let def = Q.defer();
            for (let j = 0; j < stories.length; j++) {
              const story = stories[j];
              const ids = (value[story] || {}).files;
              let files = [];
              if (_.size(ids)) {
                files = await SysFile.find({
                  id: ids
                }).populateAll();
              }
              if (value[story]) {
                value[story].file_views = files;
              }
            }
          }
          return values;
        });
    });
  },

  resetAlarms: function(node) {
    node.alarm_states = {};
  },

  updateOrCreateProducer: function() {
    return async function(payload) {
      const params = payload.params;
      const schema = payload.schema;
      delete params.__model;
      if (params.id) {
        if (schema.constant) {
          await Local._determinConstants(payload);
          await Local._enforceConstantStructures(params, schema);
        }
        return Local._saveExistingNode(payload);
      }
      if (schema.constant) {
        await Local._enforceConstantStructures(params, schema);
      }
      return Local._returnQueriedNode(payload);
    };
  },
  /*
   * updateOrCreate
   *
   * returns a function that takes the node payload and creates
   * or updates the value
   *
   * @return {Promise} - the new or updated node
   */
  updateOrCreate: function() {
    return async function(payload) {
      const params = payload.params;
      const schema = payload.schema;
      return Geo.addGeo(params)(schema)
        .then(Node.stripAssociations(params))
        .then(Node.conformist(params))
        .then(Node.ensureUniqueBy(params))
        .then(Node.parseSchema(params))
        .then(Node.updateOrCreateProducer());
    };
  },

  paramIs: function(param) {
    return {
      bool: param.type === 'boolean',
      int: param.type === 'integer',
      float: param.type === 'decimal',
      date: param.type === 'date',
      user: param.type === 'user',
      barcode: param.type === 'barcode',
      duration: param.type === 'duration',
      node: param.type === 'node',
      text: param.type === 'text'
    };
  },

  /*
   * parseSchema
   *
   * prases a schema for a new node based on constrains
   *
   * @param {Object} params - query params
   * @return {Promise} - the schema
   */

  parseSchema: function(params, validate) {
    return async function(schema) {
      /* so as to ensure backwards compatibility with the previous 
       version of updateOrCreate: */
      if (validate) {
        await Local._validateStation(params);
        await Local._validateObserver(params);
      }
      const alerts = await Local._applySchemaAttributes(
        params,
        schema,
        validate
      );
      Local._placeAlarms(params, alerts);
      Local._placeApprovals(params, schema);
      Local._cleanInvalidParams(params, schema);
      Local._cleanInvalidNumbers(params);

      return {
        params: params,
        schema: schema
      };
    };
  },

  blast: function(node, schema, verb) {
    sails.sockets.blast(`${schema.name}-${Station.getId(node.station)}`, {
      id: node.id,
      verb: verb,
      data: node
    });
  },

  filterSchema: function(nodeschema) {
    nodeschema.schema = _.filter(nodeschema.schema, function(s) {
      return s.active;
    });
    this.sortSchema(nodeschema.schema);
  },

  isSpecialTypeDerivative: function(schema = {}) {
    return (
      schema.derivative &&
      (_.startsWith(schema.derivative_statement, '__STORED_PROCEDURE__') ||
        schema.derivative_statement === '__APPLICATION_ENTITY__')
    );
  },

  findAndStripModelThroughParams: function(params) {
    const model = params.__model || params.schema;
    delete params.__model;
    return model;
  },

  seekNodeSchema: async function(model, domain) {
    let nodeSchema = null;
    if (CommonUtils.isThis(model).numericIsh) {
      nodeSchema = await NodeSchema.findOneById(model).populateAll();
    } else {
      nodeSchema = await NodeSchema.findOne({
        name: model,
        or: [
          {
            domain: domain
          },
          {
            is_asset: true
          }
        ]
      }).populateAll();
    }
    return nodeSchema;
  },

  filterActiveParamsOnly: function(nodeschema = { schema: [] }) {
    nodeschema.schema = _.filter(nodeschema.schema, function(s) {
      return s.active;
    });
    return nodeschema;
  },

  tableExistsForSchema: function(nodeschema) {
    return SqlUtils.knex(sails.models.knex).hasTable(nodeschema);
  },

  isNotEccentric: async function(nodeschema) {
    const exists = await Node.tableExistsForSchema(nodeschema);
    return (
      !exists &&
      nodeschema.derivative &&
      !Node.isSpecialTypeDerivative(nodeschema)
    );
  },

  applyUserBasedControlsToSchema: function(user, nodeschema) {
    if (user) {
      Utils.permitUser(user, nodeschema);
    } else {
      NodeSchema.stripSchema(nodeschema);
    }
  },

  setSchemaToResponse: function(nodeschema, station, res) {
    if (!res) {
      return;
    }
    const domain = Domain.getId(res.locals.domain);
    const sDomain = Domain.getId(nodeschema.domain);

    if (nodeschema.is_asset && station === -1 && sDomain !== domain) {
      nodeschema.falseDomainMatch = true;
    }

    nodeschema.original_station = station;
    res.locals.schema = nodeschema;
  },
  /*
   * pullSchema
   *
   * pulls the schema based on the query parameters
   *
   * @param {Object} params - query params
   * @param {Object?} res - the response object
   * @param {Object?} user - the user
   * @return {Promise} - the schema
   */
  pullSchema: async function(params, res, user) {
    const domain = Domain.findIdFromParamsOrRes(params, res);
    const model = Node.findAndStripModelThroughParams(params);
    const stationId = Local._getCorrectStationParam(params);
    const nodeSchema = await Node.seekNodeSchema(model, domain);
    if (!nodeSchema) {
      throw new Error('NodeSchema not found');
    }
    Node.filterActiveParamsOnly(nodeSchema);
    const notEccentric = await Node.isNotEccentric(nodeSchema);
    if (notEccentric) {
      throw new Error('Unknown Model Type');
    }
    Node.sortSchema(nodeSchema.schema);
    Node.applyUserBasedControlsToSchema(user, nodeSchema);
    Node.setSchemaToResponse(nodeSchema, stationId, res);
    return nodeSchema;
  },

  sortSchema: function(schema) {
    if (!schema) {
      return;
    }
    schema.sort((a, b) => (a.weight > b.weight ? 1 : -1));
  },
  /*
   * deleteNode
   *
   * deletes a node
   *
   * @param {Object} req - the request objexct
   * @return {Function} promise - with deleted node
   */
  deleteNode: function(req) {
    const user = req.user;
    return function(schema) {
      let where;
      if (req && req.method === 'DELETE') {
        where = Utils.params(req);
      } else {
        where = req;
      }
      const model = SqlUtils.knex(knexRef()).withSchema(schema);
      return model
        .where('id', where.id)
        .then(async results => {
          const [found] = results;
          if (!found) {
            return results;
          }

          if (
            user &&
            !(await Requisition.requisitionRole(
              user,
              found.station,
              Node.roles.delete
            ))
          ) {
            throw new Error({
              response: 'forbidden'
            });
          }

          await Local._managePreDestroyLogic(results, schema);
          return results;
        })
        .then(function(found) {
          return model.del().then(function() {
            const f = found.pop() || {};
            return Node.sendNode(f, schema).then(function(node) {
              return (node || []).pop();
            });
          });
        });
    };
  },

  /*
   * getActiveParamList
   *
   * gets the list of the active parameters
   *
   * @param {Object} schema - the node schema
   */
  getActiveParamList: function(schema, extras) {
    const nodeParams = _.pluck(Node.schema(), 'key');
    const observerExtras = Node.getObserverSchemaExtras(extras, schema.domain);
    const combined = _.union(nodeParams, observerExtras);

    // add the nodeSchema name to any values that do not contain a dot (.)
    // e.g. createdAt becomes chatbot_survey.createdAt
    let defaults = _.map(combined, function(mapEntry) {
      if (_.contains(mapEntry, '.')) {
        return mapEntry;
      }
      return schema.name + '.' + mapEntry;
    });

    if (schema.derivative) {
      defaults = [];
    }

    // add the node params to the start of the list
    // (e.g. for a survey add the survey params/question name attributes)
    _.each(schema.schema, function(param) {
      if (param && param.active && !NodeSchema.isSpecial(param.type)) {
        defaults.unshift(schema.name + '.' + param.name);
      }
    });

    // sails.log.debug('getActiveParamList.defaults.unshift', defaults);

    if (schema.derivative) {
      return defaults;
    } else {
      return _.union([schema.name + '.id'], defaults);
    }
  },

  /*
   * queryNode
   *
   * wheres nodes for station
   *
   * @param {Object} sta - the station object
   * @param {Object} params - the params to be queryed
   * @param {Function} next - the callback
   */
  queryNode: async function(sta, params, next) {
    const where = _.cloneDeep(params.query);
    const schema = params.schema;
    const station = _.cloneDeep(sta);

    const transform = true;

    const originalStation = {};
    if (Local._isCorrectModelParam(where, schema)) {
      delete where.__model;
    }
    // setting assets for station
    if (schema.is_asset) {
      const stations = await Station.formatAssetQuery(where.where, schema);
      if (_.size(stations)) {
        originalStation[JSON.stringify(where.where.station)] = station.id;
      }
    } else {
      where.where.station = station.id;
    }
    const wHere = _.cloneDeep(where);
    return Node.countNodes(wHere.where, schema)
      .then(function(count) {
        return count.pop();
      })
      .then(function(c) {
        const count = c.count;
        const limit = 100;
        let rotation = 0;
        const promises = [];
        const vWhere = _.cloneDeep(wHere);
        vWhere.limit = limit;
        while (limit * rotation <= count) {
          vWhere.skip = limit * rotation;
          promises.push(Node.findNodes(vWhere, schema, transform));
          rotation++;
        }

        return Q.allSettled(promises).then(function(settled) {
          const send = {};
          settled.forEach(function(s) {
            if (s.state === 'fulfilled' && s.value) {
              const resolve = s.value;
              const station = (resolve.query || {}).station;
              let queriedStation = station;
              if (station.in) {
                queriedStation = originalStation[JSON.stringify(station)];
              }
              if (queriedStation) {
                send[queriedStation] = send[queriedStation] || [];
                resolve.values.forEach(function(r) {
                  send[queriedStation].push(r);
                });
              }
            }
          });

          next();
          return send;
        });
      });
  },

  getStringTableNameWithSchema: function(schema) {
    return SqlUtils.knex().tableNameForQuery(schema);
  },

  buildQueryWhereSetup: function(params, schema) {
    if (Local._isCorrectModelParam(params, schema)) {
      delete params.__model;
    }
    return params;
  },

  /**
   * findNodesSetup
   *
   * @description Setup up the initial knex model
   * and applys the basic query functions
   *
   * @param {Object} param - the the query params
   * @param {Objext} schema - the node schema
   */
  findNodesSetup: function(params, schema) {
    const model = SqlUtils.knex(knexRef()).withSchema(schema);
    const limit = params.limit;
    const skip = params.skip;
    const order = params.sort;
    if (limit) {
      model.limit(limit);
    }
    if (skip) {
      model.offset(skip);
    }
    Node.setOrder(order, model, schema);
    return model;
  },

  /*
   * findNodes
   *
   * finds a node based on query
   *
   * @param {Object} param - the the query params
   * @param {Objext} schema - the node schema
   */

  findNodes: function(params, schema, transform) {
    const model = this.findNodesSetup(params, schema);
    const _where = this.buildQueryWhereSetup(params, schema);
    const where = this.applyWhereReducer(_where);
    return createQueryAndSendNode(where, schema, model, transform);
  },

  // check orderBy params (field type = variabl.e) and (priority = true)
  checkFieldIsVariables: (schema, field) => {
    const sc = schema.find(f => f.name === field);
    if (!sc || !field) return false;
    const isVariable = sc.type === 'variable';
    return field && isVariable;
  },

  // get orderBy params for variable field type
  getOrderParamsFromVariables: (field, sort) => {
    const escape = SqlUtils.escapeUtil();
    const orderBy = escape(
      `array_position((SELECT ARRAY(SELECT "id" from "variable" WHERE "key" = '%s' ORDER BY "order" %s)), %s)`,
      field,
      sort,
      field
    );

    return orderBy;
  },

  // generate orderBy params
  generateOrderParams: (schema, key, sort) => {
    let orderBy = '';
    const direction = sort.toUpperCase();
    const stringContainsDot = _.contains(key, '.');
    const parts = stringContainsDot ? key.split('.') : ['', key];

    const field = parts[1];

    const fieldIsVariables = Node.checkFieldIsVariables(schema, field);

    if (fieldIsVariables) {
      orderBy = Node.getOrderParamsFromVariables(field, sort);
    } else {
      orderBy = stringContainsDot
        ? `"${parts[0]}"->>'${field}' ${direction}`
        : `"${field}" ${direction}`;
    }

    return orderBy;
  },

  /*
   * setOrder
   *
   * Sets the order of a node query
   *
   * @param {Object|String} order - the order of multiple values
   * @param {Objext} model - the postgres knex value
   */
  setOrder: (order, model, schema) => {
    if (order && _.isString(order)) {
      // generate params from string
      const split = order.split(' ');
      model.orderByRaw(
        Node.generateOrderParams(schema.schema, split[0], split[1] || '')
      );
    } else if (_.size(order)) {
      // generate params from object
      const orderBy = Object.keys(order)
        .map(key => Node.generateOrderParams(schema.schema, key, order[key]))
        .join(', ');

      model.orderByRaw(sails.models.knex.raw(escape(orderBy)));
    }
  },

  /*
   * countNodes
   *
   * Counts the number of nodes
   *
   * @param {Object} where - the where object
   * @param {Object} schema - the schema object of the node
   * @return {Promise} the query
   */

  countNodes: async function(where, schema) {
    const model = SqlUtils.knex(knexRef()).withSchema(schema);
    // asset patch
    const vWhere = _.cloneDeep(where);
    if (schema.is_asset && where.station && !_.isObject(where.station)) {
      await Station.formatAssetQuery(vWhere, schema);
    }
    const query = Node.parseWhere(vWhere, schema, model);
    // query.debug();
    return query.count('*').then(function(count) {
      return count;
    });
  },

  /*
   * countNode
   *
   * Counts the number of nodes
   *
   * @param {Object} req - the request object
   * @return {Promise} the query
   */

  countNode: function(req) {
    return async function(schema) {
      const where = actionUtil.parseCriteria(req);
      const model = SqlUtils.knex(knexRef()).withSchema(schema);

      if (Local._isCorrectModelParam(where, schema)) {
        delete where.__model;
      }
      // asset patch
      const vWhere = _.clone(where);

      if (schema.is_asset && where.station && !_.isObject(where.station)) {
        await Station.formatAssetQuery(vWhere, schema);
      }
      Node.parseWhere(vWhere, schema, model);
      return model.count('*');
    };
  },

  notRestrictedArrayParams: function(key) {
    return _.indexOf(['tags', 'approved'], key) === -1;
  },

  stripSpecials: function(specials) {
    specials = specials.replaceAll('+', '.');
    specials = specials.replaceAll('#', '+');
    specials = specials.replaceAll('^', '"');
    return specials;
  },

  whereExtras: function(where, schema, basic) {
    const extras = {};

    if (_.isString(where)) {
      where = JSON.parse(where);
    }

    try {
      for (const key in where) {
        const value = where[key];
        if (_.startsWith(value, '@>')) {
          buildSpreadQuery(value, key, schema, extras);
        } else if (nonRestrictedArray(value, key)) {
          buildArrayBasedElements({ value, key, extras, schema });
        } else if (objectTypeParameter(value, key)) {
          basic[schema.name + '.' + key] = value;
        } else if (walkableObject(value, key)) {
          setNodeParticles({ value, key, extras, schema });
        } else if (Node.notRestrictedArrayParams(key) || key === 'tags') {
          extras[schema.name + '+' + '^' + key + '^'] = value;
        }
      }
    } catch (e) {
      sails.log.error('NODE::buildWhere', e);
    }
    return extras;
  },
  /**
   * parseWhere
   *
   * Builds a where query based on the where object
   *
   *
   * @param {Object} where - there where value
   * @param {Objext} schema - the node scheme
   * @param {Objext} model - the postgres knex value
   * @return {Objext} - the kxex query oject
   */
  parseWhere: function(where, schema, model, asString) {
    const basicQuery = {};
    if (!_.size(where)) {
      return model;
    }

    const extras = Node.whereExtras(where, schema, basicQuery);
    if (asString) {
      const basics = buildStringOnlyValue(basicQuery, schema, extras);
      return Node.stripSpecials(SqlUtils.buildWhereString(basics));
    }
    const query = model.where(basicQuery);
    const specials = Node.stripSpecials(SqlUtils.buildWhereString(extras));
    if (specials) {
      query.andWhere(sails.models.knex.raw(specials));
    }

    setApprovalQuery(where, schema, query);
    // query.debug();
    return query;
  },

  createToken: function() {
    return Utils.buildToken();
  },

  schema: function() {
    const schema = [
      {
        key: 'id',
        label: 'labels.ID',
        type: 'integer'
      },

      {
        key: 'approved',
        label: 'labels.APPROVED',
        type: 'boolean'
      },

      {
        key: 'observer',
        label: 'labels.OBSERVER',
        type: 'integer'
      },

      {
        key: 'createdAt',
        label: 'labels.CREATED',
        type: 'datetime'
      },

      {
        key: 'updatedAt',
        label: 'labels.LAST_UPDATED',
        type: 'datetime'
      },

      {
        key: 'alarm_states',
        type: 'json',
        label: 'labels.ALARMS'
      },

      {
        key: 'alarm',
        label: 'labels.HAS_ALARMS',
        type: 'boolean'
      },

      {
        key: 'tags',
        label: 'labels.TAGS',
        type: 'array'
      },

      {
        key: 'station',
        label: 'labels.STATION',
        type: 'integer'
      },

      {
        key: 'data_import',
        label: 'labels.IMPORT',
        type: 'integer'
      },

      {
        key: 'scannable_id',
        label: 'labels.SCANNED_ID',
        type: 'string'
      },

      {
        key: 'geo',
        label: 'labels.GEO_POINT',
        type: 'json'
      },

      {
        key: 'schema',
        type: 'integer',
        label: 'labels.SCHEMA'
      },

      {
        key: 'survey',
        type: 'integer',
        label: 'labels.SURVEY'
      },

      {
        key: 'contact',
        type: 'integer',
        label: 'labels.CONTACT'
      },

      {
        key: 'asset_approval',
        type: 'json',
        label: 'labels.ASSET_APPROVAL'
      },

      {
        key: 'files',
        type: 'json',
        label: 'labels.FILES'
      },

      {
        key: 'user_details',
        type: 'intenger',
        label: 'labels.SURVEY_USER_DETAILS'
      },

      {
        key: '__device__',
        type: 'integer',
        label: 'labels.DEVICE'
      },

      {
        key: 'copy_of',
        type: 'integer',
        label: 'labels.COPY_OF'
      },

      {
        key: '__parent__',
        type: 'integer',
        label: 'labels.PARENT'
      },
      {
        key: 'domain',
        type: 'integer',
        label: 'labels.DOMAIN'
      },

      {
        key: '__target_values__',
        type: 'json',
        label: 'labels.TARGET_VALUES'
      },

      {
        key: '__available__',
        type: 'boolean',
        label: 'labels.AVAILABLE'
      }

      /*
   [
        schema.name + '.schema',
        schema.name + '.scannable_id',
        schema.name + '.data_import',
        schema.name + '.approved',
        schema.name + '.point',
        schema.name + '.user_details',
        schema.name + '.survey',
        schema.name + '.station',
        schema.name + '.observer',
        schema.name + '.contact',
        schema.name + '.alarm_states',
        schema.name + '.tags',
        schema.name + '.updatedAt',
        schema.name + '.createdAt',
        'user.id as observer.id',
        'user.first_name as observer.first_name',
         'user.last_name as observer.last_name',
         'user.email as observer.email',
         'user.username as observer.username',
        'user.avatar as observer.avatar'];

      */
    ];

    return _.clone(schema);
  },
  /*
   * This schema represents the default parameters
   */

  csvVars: function() {
    const schema = [
      {
        key: 'id',
        label: 'labels.ID',
        type: 'integer'
      },

      {
        key: 'approved',
        label: 'labels.APPROVED',
        type: 'boolean'
      },

      {
        key: 'observer',
        label: 'labels.OBSERVER',
        type: 'user'
      },

      {
        key: 'createdAt',
        label: 'labels.CREATED',
        type: 'date',
        time: true
      },

      {
        key: 'updatedAt',
        label: 'labels.LAST_UPDATED',
        type: 'date',
        time: true
      },

      {
        key: 'alarm_states',
        type: 'alarms',
        label: 'labels.ALARMS'
      },

      {
        key: 'alarm',
        label: 'labels.HAS_ALARMS',
        type: 'boolean'
      },

      {
        key: 'tags',
        label: 'labels.TAGS',
        type: 'tags'
      },

      {
        key: 'station',
        label: 'labels.STATION',
        type: 'station'
      },

      {
        key: Geo.getGeoPoint() + '.latitude',
        label: 'labels.GEO_POINT_LAT',
        type: 'point'
      },

      {
        key: Geo.getGeoPoint() + '.longitude',
        label: 'labels.GEO_POINT_LNG',
        type: 'point'
      },

      {
        key: 'survey',
        type: 'boolean',
        label: 'labels.SURVEY'
      },

      {
        key: 'contact',
        type: 'contact',
        label: 'labels.CONTACT'
      },

      {
        key: 'dimension',
        type: 'dimension',
        label: 'labels.DIMENSION'
      }
      // {
      //   key: '__target_values__',
      //   type: 'json',
      //   label: 'labels.TARGET_VALUES'
      // }
    ];

    return _.clone(schema);
  },

  // flattenDefaults: function() {
  //   const def = this.schema();

  // },

  orm: function(ns) {
    const geo = {
      key: Geo.getGeoPoint(),
      type: 'json',
      label: 'labels.GEOGRAPHY'
    };
    const schema = this.schema();
    _.remove(schema, function(s) {
      return s.key === 'geo';
    });

    schema.push(geo);
    _.each(ns, function(s) {
      schema.push({
        type: s.type,
        key: s.name,
        label: s.label
      });
    });

    return _.clone(schema);
  },

  clone: function(original, schema) {
    const clone = _.cloneDeep(original);
    delete clone.scannable_id;
    delete clone.id;
    delete clone.alarm_states;
    delete clone.updatedAt;
    delete clone.createdAt;
    clone.domain = Domain.getId(original.domain || {});
    clone.observer = User.getId(original.observer || {});
    clone.copy_of = original.copy_of || Model.getId(original || {});
    let _sc = [];
    if (Model.getId(schema)) {
      _sc = schema.schema;
    } else if (Array.isArray(schema)) {
      _sc = schema;
    }
    _.each(_sc, s => {
      if (s.type === 'node') {
        clone[s.name] = {};
      } else if (s.mutable) {
        delete clone[s.name];
      }
    });
    return clone;
  },

  getObserverSchemaExtras: function(addState) {
    const extras = [
      'user.id as observer.id',
      'user.first_name as observer.first_name',
      'user.last_name as observer.last_name',
      'user.email as observer.email',
      'user.username as observer.username',
      'user.avatar as observer.avatar',
      'domain.avatar as domain.avatar',
      'domain.id as domain.id',
      'domain.name as domain.name',
      'device.serial_number as __device_serial_number',
      'device.sku_number as __device_sku_number'
    ];

    if (addState) {
      extras.push(
        ...[
          'state.state as __state.name',
          'state.id as __state.id',
          'state.target::JSON as __state.target'
        ]
      );
    }

    return _.clone(extras);
  },

  find: function(params) {
    if (!params.__model) {
      throw new Error('Model Name required');
    }

    const model = params.__model;
    const domain = params.domain;
    delete params.__model;
    delete params.domain;
    return Node.pullSchema({
      model: model,
      domain: domain
    })
      .then(Node.getNodeNoReq(params))
      .then(function(query) {
        let q;
        // this allows us to send the
        // one record
        if (params.id) {
          q = query.pop() || {};
        } else {
          q = query;
        }
        /*
            We need to look at only active parameters
            Node.sendNode(q); // also parse the JSON here
        */
        return q;
      });
  },

  findThroughSchema: function(query, schema) {
    const model = SqlUtils.knex(knexRef()).withSchema(schema);

    Node.parseWhere(query, schema, model)
      .select(Node.getActiveParamList(schema))
      .join('public.user', function() {
        this.on('user.id', '=', schema.name + '.observer');
      });

    if (schema.is_asset && schema.domain) {
      model.leftJoin('public.domain', function() {
        this.on('domain.id', '=', schema.name + '.domain');
      });
    }

    return Node.sendNode(model, schema);
  },

  findOneById: async function(id, schema) {
    const model = SqlUtils.knex(knexRef()).withSchema(schema);
    const where = {
      id: id
    };

    /*
      TODO:

      Do we need to implement derivative logic gere for the SELECT statement?

      Like this from findNodes function:

      let find = Node.parseWhere(where, schema, model)
      .select(Node.getActiveParamList(schema));

      if (!schema.derivative) {
        find.join('public.user', function() {
          this.on('user.id', '=', schema.name + '.observer');
        });
      }

     */
    const node = (await createQueryAndSendNode(where, schema, model)) || [];

    return node.pop();
  },

  /*
  @todo::: Needs more testing
  */

  destroy: function(where, schema) {
    return Q.fcall(function() {
      return schema;
    }).then(Node.deleteNode(where));
  },

  save: function(node, schema) {
    return Q.fcall(function() {
      return {
        params: node,
        schema: schema
      };
    }).then(Node.updateOrCreate());
  },

  skuAutoCode: function(param) {
    return Local._skuAutoCode(param);
  },

  isInViolation: function(params, violators) {
    return (
      // we hav no violators
      !_.size(violators) ||
      // or the whem we are trying to
      // change the vilated object
      _.size(
        _.where(violators, {
          id: parseInt(params.id)
        })
      ) === _.size(violators)
    );
  },

  hasUniqueParams: function(schema, params, where = {}) {
    let hasUnique = false;
    _.each(schema, s => {
      if (s.unique_identity && s.type !== 'node') {
        where[s.name] = params[s.name];
        hasUnique = true;
      }
    });
    return hasUnique;
  },

  ensureUniqueBy: function(params) {
    const station = Station.getId(params.station);
    const w = {
      where: {
        station: station
      }
    };
    return async schema => {
      // we have an update event
      if (params.id) {
        return schema;
      }

      const hasUnique = this.hasUniqueParams(schema.schema, params, w.where);
      // basically, move on if there is nothing to look for
      if (!hasUnique) {
        return schema;
      }
      const violators = await Node.findNodes(w, schema);
      if (this.isInViolation(params, violators)) {
        return schema;
      }
      throw new Error('errors.UNQUIE_BY_VILOATION_ATTEMPTED_IN_STATION');
    };
  },

  moduleCreation: function(params, req, res) {
    return async function(schema) {
      if (!schema.module || !req || !res) {
        return schema;
      }

      return await Module._creation_overrides(schema, params, req, res);
    };
  },

  frankenstein: function(params, method) {
    return function(schema) {
      if (method === 'POST') {
        return schema;
      }

      const _schema = _.clone(schema.schema);
      _.each(_schema, s => {
        if (_.isUndefined(params[s.name]) && !s.virtual) {
          _.remove(schema.schema, _s => _s.name === s.name);
        }
      });
      return schema;
    };
  },

  create: function(params, req, res) {
    return Node.pullSchema(params, res, (req || {}).user, true)
      .then(Geo.addGeo(params))
      .then(Node.frankenstein(params, req.method))
      .then(Node.conformist(params))

      .then(Node.moduleCreation(params, req, res))
      .then(Node.ensureUniqueBy(params))
      .then(Node.stripAssociations(params))

      .then(Node.parseSchema(params, true))
      .then(Node.updateOrCreateProducer())
      .then(Modules.node(req, res));
  },

  report: function(req, res) {
    const params = req.params.all();
    const site = res.locals.siteData;

    Report.findOneById(params.id)
      .populate('node')
      .then(function(report) {
        return report;
      })
      .then(function(report) {
        if (!report || !_.size(report)) {
          throw new Error('errors.INVALID_REPORT');
        }

        return report;
      })
      .then(Node.nodeReports(params, site))
      .then(function(rows) {
        res.send(rows);
      })
      .catch(function(why) {
        res.serverError(why);
      });
  },

  blasts: function(created, req) {
    const boomo = (topic, payload) => {
      sails.sockets.blast(topic, payload, req);
    };
    return {
      blastCreatedNodeToStation(model, station) {
        const topic = `${model}-${Station.getId(station)}`;
        const payload = {
          id: Model.getId(created),
          verb: 'created',
          data: created
        };
        boomo(topic, payload);
      },
      blastParentsWithBirth(model, node) {
        const topic = `${model}-parents-${Station.getId(
          created.station
        )}-${NodeSchema.getId(node)}`;
        const payload = {
          id: Model.getId(created),
          verb: 'created',
          data: created
        };
        boomo(topic, payload);
      },
      renderBirth(model, station) {
        const topic = `node-rendering-activity-${Station.getId(station)}`;
        const payload = {
          id: Model.getId(created),
          verb: 'created',
          data: {
            node: model,
            instance: created
          }
        };
        boomo(topic, payload);
      }
    };
  },
  sendOneOrAll: function(models, res) {
    res.send(_.size(models) === 1 ? models.pop() : models);
  },

  formatWhereWithAssetQuery: function(where, schema) {
    return formatWhereWithAssetQuery(where, schema);
  }
};

function isStoredProcedure(schema) {
  return (
    schema.derivative &&
    _.startsWith(schema.derivative_statement, '__STORED_PROCEDURE__')
  );
}

async function runStoredProcecure(where, schema) {
  const query = CommonUtils.parseLocals(
    schema.derivative_statement.replace('__STORED_PROCEDURE__', ''),
    where
  );
  try {
    const results = await Model.queryAsync(query);
    return (results || { rows: [] }).rows;
  } catch (e) {
    return [];
  }
}

async function formatWhereWithAssetQuery(where, schema) {
  const vWhere = _.clone(where);
  if (schema.is_asset && where.station && !_.isObject(vWhere.station)) {
    await Station.formatAssetQuery(vWhere, schema);
  }
  return vWhere;
}

function createQueryAndSendNodeSetup(where, schema, model) {
  const find = Node.parseWhere(where, schema, model).select(
    Node.getActiveParamList(schema)
  );
  if (!schema.derivative) {
    find.leftJoin('public.user', function() {
      this.on('user.id', '=', schema.name + '.observer');
    });
    find.leftJoin('public.domain', function() {
      this.on('domain.id', '=', schema.name + '.domain');
    });
    find.leftJoin('public.device', function() {
      this.on('device.id', '=', schema.name + '.__device__');
    });
  }
  // find.debug();
  return find;
}

async function createQueryAndSendNode(where, schema, model, transform) {
  if (isStoredProcedure(schema)) {
    return await runStoredProcecure(where, schema);
  }
  const _where = await formatWhereWithAssetQuery(where, schema);
  const find = await createQueryAndSendNodeSetup(_where, schema, model);
  // find.debug();
  if (transform) {
    return Node.sendNode(find, schema, where);
  }
  return Node.sendNode(find, schema);
}

function createQueryForNodeStream(nodedownload, model) {
  const find = createQueryAndSendNodeSetup(
    nodedownload.where,
    nodedownload.schema,
    model
  );
  // Node.addSample(find, nodedownload);
  // find.debug();
  return Node.addSample(find, nodedownload);
}

function setApprovalQuery(where, schema, query) {
  const approval = setApproval(where);
  if (approval) {
    const domainApproval = (
      (schema.approvals_workflow || {}).domain_approval || {}
    ).val;
    const extraApproval = (
      (schema.approvals_workflow || {}).extra_approval || {}
    ).val;
    const domainId = Domain.getId(schema.domain);
    let queryString = '';
    const approvedValue = where.approved ? '1' : '0';
    if (domainApproval) {
      queryString += `( ("${schema.name}".asset_approval ->> '__domain_approval__' )::JSONB  -> '${domainId}' -> 'val' ) = '${approvedValue}' `;
    }

    if (domainApproval && extraApproval) {
      queryString += 'AND ';
    }

    if (extraApproval) {
      queryString += `(("${schema.name}".asset_approval ->> '__extra_approval__' )::JSONB  -> 'val' ) = '${approvedValue}' `;
    }
    query.andWhere(sails.models.knex.raw(queryString));
  }
}

function buildStringOnlyValue(basics, schema, extras) {
  const asSpecial = {};
  _.each(basics, (h, ere) => {
    asSpecial[`${ere.replace(schema.name + '.', schema.name + '+^')}^`] = h;
  });
  _.merge(asSpecial, extras);
  return asSpecial;
}

function buildSpreadQuery(value, key, schema, extras) {
  const vArray = JSON.parse(`[${value.replaceAll('@>', '')}]`);
  extras[schema.name + '+' + '^' + key + '^'] = {
    spread: vArray
  };
}

function nonRestrictedArray(value, key) {
  return (
    value &&
    _.isArray(value) &&
    _.size(value) &&
    Node.notRestrictedArrayParams(key)
  );
}

function objectTypeParameter(value, key) {
  return (
    value && !_.contains(value, '.') && !_.isObject(value) && key !== 'approved'
  );
}

function walkableObject(value, key) {
  return value && _.contains(key, '.') && _.isObject(value);
}

function buildArrayBasedElements({ extras, value, key, schema }) {
  if (key === 'or') {
    extras[schema.name + '+' + '^' + key + '^'] = {
      or: value
    };
  } else {
    extras[schema.name + '+' + '^' + key + '^'] = {
      in: value
    };
  }
}

function setNodeParticles({ extras, value, key, schema }) {
  const particles = key.split('.');
  let extraString = schema.name + '+' + '^' + particles[0] + '^';
  for (let i = 1; i < particles.length; i++) {
    extraString += '.' + particles[i];
  }
  extras[extraString] = value;
}

function setApproval(where) {
  let approval = false;
  if (where.approved != null) {
    approval = true;
  }
  return approval;
}
