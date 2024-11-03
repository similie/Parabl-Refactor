class DeviceActionType {
  _device;
  _end;
  _verb;
  _func;
  _action;
  _topic;
  constructor(device, action, end) {
    this.device = device;
    this._end = end;
    this._action = action;
  }

  get action() {
    return this._action;
  }

  get actionStub() {
    const action = this._end ? 'end' : 'do';
    return this.action[action] || {};
  }

  setPurpose() {
    const stub = this.actionStub;
    this._verb = stub.this; // text
    this._func = stub.func; // boolean
  }

  async getDeviceTypeVariable(type) {
    const deviceType = this.device[type];
    if (typeof deviceType === 'object') {
      return deviceType;
    } else {
      const id = Variable.getId(deviceType);
      return Variable.findOneById(id);
    }
  }

  async applyDeviceType() {
    const deviceType = await this.getDeviceTypeVariable('external_device_type');
    this.deviceType = deviceType;
    const deviceClass = await this.getDeviceTypeVariable(
      'external_device_model'
    );
    this.deviceClass = deviceClass;
  }

  get device() {
    return this._device;
  }

  set device(device) {
    this._device = device;
  }

  get deviceType() {
    return this._deviceType || {};
  }

  set deviceType(deviceType) {
    this._deviceType = deviceType;
  }

  get deviceTypeId() {
    return this.deviceType.identity;
  }

  get deviceClass() {
    return this._deviceClass || {};
  }

  set deviceClass(deviceClass) {
    this._deviceClass = deviceClass;
  }

  get deviceClassId() {
    return this.deviceClass.identity;
  }

  get func() {
    return this._func;
  }

  get verb() {
    return this._verb;
  }

  get contextAction() {
    switch (this.topic) {
      case 'beco_valve':
        return this.actionStub.action;
      case 'beco_interval':
        return this.actionStub.interval;
      default:
        return this.verb;
    }
  }

  boveSelectAction() {
    return this.verb;
  }

  boveClass() {
    switch (this.deviceClassId) {
      case 'bove_dn15':
        return this.boveSelectAction();
      default:
        return this.boveInterval();
    }
  }

  particleClass() {
    return this._func ? 'particle_function' : 'particle_event';
  }

  scanDeviceType() {
    this.setPurpose();
    switch (this.deviceTypeId) {
      case 'external_device_type_bove':
        return this.boveClass();
      default:
        return this.particleClass();
    }
  }

  get context() {
    if (this.func && this.actionStub.value) {
      return { value: this.actionStub.value };
    }
    return this.action.context || {};
  }

  get topic() {
    return this._topic;
  }

  set topic(topic) {
    this._topic = topic;
  }

  async getTopic() {
    await this.applyDeviceType();
    this.topic = this.scanDeviceType();
  }
}

class DeviceActions {
  _action;
  _end;
  _ew;
  constructor(ew, end = false) {
    this.ew = ew;
    const actions = DeviceActions.getMachineActions(ew, end);
    if (!actions || !actions.device) {
      throw new Error('Device Action Required');
    }
    this._action = actions;
    this._end = end;
  }

  get ew() {
    return this._ew;
  }

  set ew(ew) {
    this._ew = ew;
  }

  get owner() {
    return this.ew.owner;
  }

  static getMachineActions(ew, breakAction = false) {
    const actionName = breakAction ? 'machine_break' : 'machine';
    const action = ((ew || {}).actions || {})[actionName] || {};
    return Object.assign({}, action);
  }

  async build() {
    this.device = await Device.findOneById(
      Device.getId(this._action.device)
    ).populateAll();
    this.actionProcessor = new DeviceActionType(
      this.device,
      this.action,
      this._end
    );
  }

  get actionProcessor() {
    return this._actionProcessor;
  }

  set actionProcessor(actionProcessor) {
    this._actionProcessor = actionProcessor;
  }

  get action() {
    return this._action;
  }

  get device() {
    return this._device;
  }

  set device(device) {
    this._device = device;
  }

  get dId() {
    return this.device.id;
  }

  get end() {
    return this._end;
  }

  getBlank(domain) {
    const send = {
      topic: this.actionProcessor.topic,
      action: this.actionProcessor.contextAction,
      domain: Domain.getId(domain),
      context: this.actionProcessor.context,
      actor: User.getId(this.owner),
      device: this.dId,
      earlywarning: EarlyWarning.getId(this.ew),
      meta: {}
    };
    return send;
  }

  async createAction(domain) {
    await this.build();
    await this.actionProcessor.getTopic();
    const blank = this.getBlank(domain);
    return blank;
  }
}

module.exports = { DeviceActions, DeviceActionType };
