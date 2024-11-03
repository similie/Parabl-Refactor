const { EwsActionUtils } = require('./ews/ews-action-utils');
const { TimeUtils } = require('similie-api-services');
const TimePeriod = TimeUtils.constants.ENUMS.timePeriods;
class EarlyWarningModel {
  _model;
  _util;
  constructor(model) {
    if (!model) {
      throw new Error('An early warning model is required');
    }
    this.model = model;
    this.util = new EwsActionUtils();
  }

  get id() {
    return Model.getId(this.model);
  }

  get domain() {
    return Domain.getId(this.model.domain);
  }

  get model() {
    return this._model;
  }

  set model(model) {
    this._model = model;
  }

  get util() {
    return this._util;
  }

  set util(util) {
    this._util = util;
  }

  get parameters() {
    return this.model.parameters;
  }

  get forgiveCount() {
    return this.model.forgive_count || 0;
  }

  get dangerIndex() {
    return this.forgiveCount;
  }

  get meta() {
    return this.model.meta || {};
  }

  get activeActions() {
    const actions = {};
    const event = this.model || {};
    for (const key in event.actions) {
      const action = event.actions[key] || {};
      if (action.active) {
        actions[key] = action;
      }
    }
    return actions;
  }

  findExistingTimeout(
    eventCategory = EwsActionUtils.EWEventCategory.EarlyWarning,
    timePeriod = TimePeriod.minutes,
    overried = null
  ) {
    return this.util.findLastPerformedEwModel(
      this.model,
      eventCategory,
      timePeriod,
      overried
    );
  }
}

module.exports = { EarlyWarningModel };
