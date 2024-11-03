const { TimeUtils, SqlUtils } = require('similie-api-services');
const { Common } = require('../../common/common');
const { EwActionParams, EwNodeActions } = require('../early-warning-actions');
const { WindyUtils } = require('../windy/windy-utils');
const tz = TimeUtils.constants.timeZone;
const now_ = TimeUtils.constants.now_;

class EwsActionUtils {
  static EWEventCategory = {
    EarlyWarning: 'earlywarning',
    EventCluster: 'eventcluster'
  };

  static getTagModel(category = EwsActionUtils.EWEventCategory.EarlyWarning) {
    return category === EwsActionUtils.EWEventCategory.EarlyWarning
      ? 'e_tag'
      : 'ec_tag';
  }

  getDependencyQuery(dependency = {}) {
    const escape = SqlUtils.escapeUtil();
    const delay = dependency.delay || 0;
    return escape(
      `SELECT
    "ew"."last_triggered",
    "ew"."timeout",
    "ews"."id" 
  FROM
    "%s" "ew"
    JOIN "ews" "ews" ON ( "ew"."id" = "ews"."early_warning" ) 
  WHERE
    "ews"."event_category" = 'earlywarning' 
    -- we are still within our timeout value
    AND ("ews"."triggered_time") >= (now() - cast((COALESCE((CASE WHEN "ew"."timeout" = 0 THEN 60 * 24 ELSE "ew"."timeout" END), 60 * 24 )::text || ' MINUTE') as interval)) 
    -- we have passed our delay timeout.
    AND ("ews"."triggered_time" + interval '%s MINUTE') <= now()
    AND "ew"."id" = %s;`,
      dependency.event_category,
      delay,
      EWS.getId(dependency.depends_on)
    );
  }

  async findDependentIssue(dependency = {}) {
    if (!dependency.depends_on) {
      return false;
    }

    const query = this.getDependencyQuery(dependency);
    const results = await EventDependent.queryAsync(query);
    return !!results.rows.length;
  }

  async checkDependentEventHasOccurred(dependentOn = []) {
    const issues = [];
    for (let i = 0; i < dependentOn.length; i++) {
      const issue = await this.findDependentIssue(dependentOn[i]);
      issues.push(issue);
    }
    return this.notAllHaveIssues(issues);
  }

  async waitDependents(
    ew,
    category = EwsActionUtils.EWEventCategory.EarlyWarning
  ) {
    const id = EWS.getId(ew);
    const dependentOn = await EventDependent.find().where({
      event: id,
      event_category: category
    });
    if (!dependentOn.length) {
      return false;
    }
    return this.checkDependentEventHasOccurred(dependentOn);
  }

  checkIssues(ew, node) {
    const issues = [];
    const params = ew.parameters;
    for (const key in params) {
      const v = params[key];
      const p = this.sCache[key] || {};
      if (!p.type) {
        continue;
      }
      const ewParam = new EwActionParams(v, p.type);
      const ofV = node[ewParam.ofParams];
      if (ewParam.ofCheck(ofV)) {
        continue;
      }
      ewParam.value = node[key];
      const issue = ewParam.check();
      issues.push(issue);
      if (!issue) {
        continue;
      }
      const na = new EwNodeActions(ew, node, ewParam);
      na.applyIssues(key);
    }
    return issues;
  }

  notAllHaveIssues(issues = []) {
    return !_.every(issues);
  }

  async buildIssues(node = {}, earlywarnings = [], schemaParams = []) {
    this.sCache = Common.buildBasicItemCache(schemaParams, 'name');
    const stored = [];
    for (let i = 0; i < earlywarnings.length; i++) {
      const ew = earlywarnings[i];
      const wait = await this.waitDependents(ew);
      if (wait) {
        continue;
      }
      const issues = this.checkIssues(ew, node);
      // anding all params
      if (this.notAllHaveIssues(issues)) {
        continue;
      }
      stored.push(ew);
    }
    return stored;
  }

  stringifyPoint(point = {}) {
    if (point.lat && point.lng) {
      return `${point.lat}, ${point.lng}`;
    }
    return null;
  }

  getStationName(data = {}) {
    const ew = data.ew;
    const config = data.config || {};
    const station = ew.station || data.station || {};
    if (this.isActionableStation(station)) {
      return station.local_name || config.site_name || 'unknown';
    }
    const meta = ew.meta || {};
    const w3w = meta.w3w || {};
    const point = meta.point || {};
    return ew.name || w3w.words || this.stringifyPoint(point) || 'unknown';
  }

  applyTriggerValuesToLocals(values, locals = {}) {
    for (const key in values) {
      const param = values[key];
      locals[key] = param.value;
    }
  }

  getRelevantValues(key, values, locals = {}) {
    if (!values) {
      return;
    }
    switch (key) {
      case 'point':
        locals[key] = this.stringifyPoint(values);
        break;
      case 'w3s':
        locals[key] = values.words;
        break;
      case 'triggerValues':
        this.applyTriggerValuesToLocals(values, locals);
        break;
      default:
        return null;
    }
  }

  pullSpecialValues(data, locals = {}) {
    const ew = data.ew;
    const station = ew.station || {};
    if (this.isActionableStation(station)) {
      return;
    }
    const ews = data.ews || {};
    const triggerValues = ews.trigger_values || {};
    const meta = ew.meta || {};
    const w3w = meta.w3w || {};
    const point = meta.point || {};
    const values = { w3w, point, triggerValues };
    for (const key in values) {
      const value = values[key];
      this.getRelevantValues(key, value, locals);
    }
  }

  pullThresholdValues(params, locals = {}) {
    for (const key in params) {
      const name = key.toUpperCase();
      const param = params[key] || {};
      const value = param.val || 'NULL';
      locals[name] = value;
    }
  }

  pullSchemaValues(ewValues, locals = {}) {
    if (!this.isActionableStation(ewValues)) {
      return;
    }

    for (const key in ewValues) {
      const val = ewValues[key];
      locals[key] = val;
    }
  }

  async assignedDecoration(model) {
    const station = model.station;
    switch (station) {
      case WindyUtils.stationID:
        await WindyUtils.appendEwsEvent(model);
        break;
    }
  }

  async decorateStationDetails(models = []) {
    const stationIds = Common.returnItemIdsOnParam(models, 'station');
    if (!stationIds.length) {
      return;
    }
    const stations = await Station.find()
      .where({ id: stationIds })
      .populate('station_type');
    const itemCache = Common.buildBasicItemCache(stations);
    for (const ew of models) {
      if (!ew.station || !itemCache[Model.getId(ew.station)]) {
        continue;
      }
      ew.station = itemCache[Model.getId(ew.station)];
    }
  }

  /**
   * @name decorateSpecialEvents
   * @description allows us to add special actions to
   *   selected event types
   * @param {earlywarning[]} models
   */
  async decorateSpecialEvents(models = []) {
    for (let i = 0; i < models.length; i++) {
      const model = models[i];
      if (this.isActionableStation(model.station)) {
        continue;
      }
      await this.assignedDecoration(model);
    }
  }

  /** @summary Public methods */
  /**
   * @description we want to check if we are working with a station that is valid
   * @param {Object} station
   * @returns {boolean} if the station is not null and greater than 0
   */
  isActionableStation(station) {
    const sId = Station.getId(station);
    return sId !== null && sId > 0;
  }

  /**
   * @description Fetches an Early Warning Category model from the specified
   * input model or null if the model couldn't be found.
   * @param {Object} ews
   * @returns {Object} An object containing data from one of the Event Category
   * model types specified in Module.attributes.event_category
   */
  async fetchEarlyWarningCategoryModel(ews) {
    let result = await sails.models[ews.event_category]
      .findOneById(ews.early_warning)
      .populateAll();

    if (!result) {
      sails.log.error(
        `Early Warning not found with id ${ews.early_warning} and category ${ews.event_category}`
      );
      result = null;
    }

    return result;
  }

  /**
   * @description Fetches a station associated with an Early Warning Category
   * model. Returns the Station model if one was found using the Id in the input
   * data structure or null otherwise.
   * @param {Object} ew
   * @returns {Object} A station model or null
   */
  async fetchStationFromEarlyWarningCategoryModel(ew) {
    if (!ew || !Reflect.has(ew, 'station')) {
      sails.log.error('Early Warning Station key not present in EW data');
      return null;
    }
    // exception case for a global node that has an event
    if (!this.isActionableStation(ew.station)) {
      const stationId = Station.getId(ew.station);
      return { id: stationId };
    }

    const stationId = Station.getId(ew.station);
    const result = await Station.findOneById(stationId);
    if (!result) {
      sails.log.error(`Early Warning Station not found for key ${stationId}`);
      return null;
    }
    return result;
  }

  applyAudienceTricks(audience, ew) {
    if (!process.env.TRIVIA_TRICKS || !ew.meta || !ew.meta.randomize) {
      return audience;
    }
    const randomIndex = _.random(0, audience.length - 1);
    if (!audience[randomIndex]) {
      return [];
    }
    return [audience[randomIndex]];
  }

  async applyImpact(audience = [], trigger, action, ew, ews, station) {
    try {
      await EventImpact.addMany(audience, {
        station: Model.getId(station),
        method: trigger,
        event: Model.getId(ew),
        ews: Model.getId(ews),
        meta: {
          action
        }
      });
    } catch (e) {
      sails.log.error('ERROR.applyImpact::EventImpact.addMany', e);
    }
  }

  /**
   * @description Collates an audience for a specifed action and adds a Job model
   * @param trigger {string} The trigger param for the early warning
   * @param {*} action
   * @param {*} ew
   * @param {*} ews
   * @param {*} station
   */
  async addJobsForAudience(trigger, action, ew, ews, station) {
    const bigTrigger = trigger.toUpperCase();
    const domainId = Domain.getId(station.domain);
    const _audience = await this.getDomainAudienceForAction(
      trigger,
      action,
      domainId
    );
    const audience = this.applyAudienceTricks(_audience, ew);
    const config = await Site.thisSiteAsync(domainId);
    let node;
    if (
      ews.target &&
      ew.node &&
      ews.event_category === EwsActionUtils.EWEventCategory.EarlyWarning
    ) {
      const ns = await NodeSchema.findOneById(NodeSchema.getId(ew.node));
      node = await Node.findOneById(ews.target, ns);
    }

    if (!audience.length) {
      return;
    }

    await this.applyImpact(audience, trigger, action, ew, ews, station);

    if (Site.isInTestMode()) {
      return;
    }

    Jobs['ews' + bigTrigger].add({
      audience: audience,
      ew: ew.toJSON(),
      ews: ews,
      config: config,
      node: node || station
    });
  }

  /**
   * @description Creates a merged set of User objects from the domain specified
   * removing users where their trigger parameter is null.
   * @param action {object} An early warning object
   * @param domain {object} A domain object to pull the audience from
   * @returns {Array<User>} An array of User objects.
   */
  async getDomainAudienceForAction(trigger, action, domain) {
    const audience = action.audience;
    const district = action.district_audience;
    const tAudience = await Tag.pullAudience(audience, domain);
    const dAudience = await District.pullAudience(district, domain);
    const mergedAudience = User.mergeUserTypes([...tAudience, ...dAudience]);
    // removed non-triggerable audience members
    const result = _.clone(mergedAudience);
    _.remove(result, member => {
      return member[trigger] == null;
    });

    return result;
  }

  setSchemaCache(nodeschema = {}) {
    const schema = nodeschema.schema || [];
    const sCache = {};
    for (let i = 0; i < schema.length; i++) {
      const s = schema[i];
      sCache[s.name] = s;
    }
    return sCache;
  }

  /**
   * @description Collates trigger objects for an EarlyWarning type object,
   * returns an inflated object if successful, null otherwise.
   * @param schema {object} The node schema
   * @param targetId {number} The Id of the target node for the warning
   * @param ewParams {object} Early Warning structure
   * @returns {object} structured object containing trigger definitions
   */
  async fetchEarlyWarningTriggers(schema, targetId, ewParams) {
    const result = {};
    try {
      const node = (await Node.findOneById(targetId, schema)) || {};
      const sCache = this.setSchemaCache(schema);
      // we want to know what were the values
      for (const key in ewParams) {
        const param = sCache[key] || {};
        result[key] = {
          value: node[key],
          label: param.label,
          name: key
        };
      }
    } catch (e) {
      sails.log.error(e);
      return null;
    }
    return result;
  }

  /**
   * @description Intermediary function to fetch an existing EWS model or create
   * a new instance.
   * @param model {object} EW model
   * @param category {string} The EW object type
   * @param timePeriod {number} One of the TimePeriod ENUM values
   * @param domain {object} EW Domain
   * @returns {object} An existing or new EWS model
   */
  async findOrCreateEWSModel(model, category, timePeriod, domain) {
    let result = await this.findExistingEWSModel(model, category, timePeriod);
    if (!result) result = await this.createNewEWSModel(model, category, domain);

    return result;
  }

  /**
   * @description Attempts to find an existing EWS model of the specified
   * eventCategory. Returns a new instance if found or null otherwise.
   * @param ewModel {object}
   * @param eventCategory {string} The EW object type
   * @param timePeriod {number} One of the TimePeriod enumeration options
   * @returns {object} An EWS object or null
   */
  async findExistingEWSModel(ewModel, eventCategory, timePeriod) {
    const fTimeout = ewModel.forgive_timeout || 0;
    const find = {
      early_warning: ewModel.id,
      event_category: eventCategory,
      expired: false,
      perform: false
    };

    if (fTimeout) {
      find.updatedAt = {
        '!': null,
        '>=': TimeUtils.date(now_)
          .minus(fTimeout, timePeriod)
          .tz(tz).toISO
      };
    }

    const result = await EWS.findOne().where(find);
    return result;
  }

  /**
   * @name getTimeout
   * @description simple wrapper around the timeout param
   * @param {EarlyWarning} ewModel
   * @param {number} overried
   * @returns
   */
  getTimeout(ewModel = {}, overried = null) {
    return ewModel.timeout || overried || 0;
  }

  /**
   * @description Attempts to find an existing EWS model of the specified
   * eventCategory. Returns a new instance if found or null otherwise.
   * @param {EarlyWarning} ewModel
   * @param {string} eventCategory The EW object type
   * @param {number} timePeriod One of the TimePeriod enumeration options
   * @param {number} overried - overrides the timeout
   * @returns {object} An EWS object or null
   */
  async findLastPerformedEwModel(
    ewModel = {},
    eventCategory,
    timePeriod,
    overried = null
  ) {
    const fTimeout = this.getTimeout(ewModel, overried);
    if (!fTimeout) {
      return null;
    }
    const find = {
      early_warning: Model.getId(ewModel),
      event_category: eventCategory,
      perform: true,
      triggered_time: {
        '!': null,
        '>=': TimeUtils.date(now_)
          .minus(fTimeout, timePeriod)
          .tz(tz).toISO
      }
    };
    const result = await EWS.find()
      .where(find)
      .sort({ triggered_time: 'DESC' })
      .limit(1);
    return result.pop();
  }

  /**
   * @description Creates a new EWS model from the specified parameters
   * @param ewModel {object}
   * @param eventCategory {string} The EW object type
   * @param domain {object} Used to fetch the domain Id for the new model
   * @returns A newly instantiated EWS model
   */
  async createNewEWSModel(ewModel, eventCategory, domain) {
    // inflate active actions
    const actions = [];
    _.each(ewModel.actions, (model, key) => {
      if (model.active) actions.push(key);
    });

    // find the Device Id, note, even if ew.device exists on the object, it still
    // might not have an Id property. E.g. 'deviceId' could remain undefined.
    let deviceId = null;
    if (Reflect.has(ewModel, 'device')) {
      deviceId = Device.getId(ewModel.device);
    }

    // Domain Id
    const domainId = Domain.getId(domain);

    // create the new object
    const result = await EWS.create({
      early_warning: ewModel.id,
      actions: actions,
      event_category: eventCategory,
      domain: domainId,
      device: deviceId
    });

    return result;
  }
}

module.exports = { EwsActionUtils };
