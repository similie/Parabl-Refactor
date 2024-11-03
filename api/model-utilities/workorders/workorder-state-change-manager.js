class WorkOrderStateChangeManager {
  constructor(wo, toState, user) {
    this.wo = wo;
    this.state = toState;
    this.user = user;
  }

  get wo() {
    return this._wo;
  }

  set wo(wo) {
    this._wo = wo;
  }

  get state() {
    return this._state;
  }

  set state(state) {
    this._state = state;
  }

  get user() {
    return this._user;
  }

  set user(user) {
    this._user = user;
  }

  get meta() {
    return this.wo.meta || {};
  }

  getId(value) {
    return Model.getId(value);
  }

  sqlQuery(query) {
    return Model.queryAsync(query);
  }

  async toStation() {
    if (this._toStation) {
      return this._toStation;
    }
    const serviceStation = this.wo.service_station;
    if (!serviceStation) {
      throw new Error('The Work Order has no vaild service station attribute');
    }
    this._toStation = await Station.findOne({ station_id: serviceStation });
    return this._toStation;
  }

  async fromStation() {
    if (this._fromStation) {
      return this._fromStation;
    }

    const from = this.wo.from;
    if (!from) {
      throw new Error('The Work Order has no vaild from attribute');
    }
    this._fromStation = await Station.findOne({ station_id: from });
    return this._fromStation;
  }

  async execute() {
    sails.log.error('No result execution');
  }
}

module.exports = { WorkOrderStateChangeManager };
