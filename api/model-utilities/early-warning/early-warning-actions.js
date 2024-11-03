class EwActionParams {
  _param;
  _value;
  _type;
  constructor(param, type) {
    this._param = param;
    this._type = type;
  }

  get value() {
    return this._value;
  }

  set value(value) {
    this._value = value;
  }

  get type() {
    return this._type;
  }

  get op() {
    return this._param.op || 'ge';
  }

  get not() {
    return this._param.not;
  }

  get val() {
    return this._param.val;
  }

  get to() {
    return this._param.to;
  }

  get ofActive() {
    return this._param.of_active;
  }

  get of() {
    return this._param.of_val;
  }

  get ofParams() {
    return this._param.of_param;
  }

  get ofVal() {
    return Model.getId(this._ofVal);
  }

  set ofVal(ofVal) {
    this._ofVal = ofVal;
  }

  ofCheck(ofVal) {
    if (this.ofActive) {
      return this.of !== Model.getId(ofVal);
    }
    return false;
  }

  boolean() {
    return this.value === this.val;
  }

  greaterThan() {
    return (
      (this.value != null && this.val != null && this.value >= this.val) ||
      (this.value == null && this.val == null)
    );
  }

  lessThan() {
    return (
      (this.value != null && this.val != null && this.value <= this.val) ||
      (this.value == null && this.val == null)
    );
  }

  between() {
    return (
      this.value != null &&
      this.val != null &&
      this.value >= this.val &&
      this.value <= this.to
    );
  }

  mod() {
    return (
      (this.value != null && this.val != null && this.value % this.val === 0) ||
      (this.value == null && this.val == null)
    );
  }

  isNot(value) {
    if (!this.not) {
      return value;
    }
    return !value;
  }

  check() {
    switch (this.type) {
      case 'boolean':
        return this.boolean();
      default:
        switch (this.op) {
          case 'le':
            return this.isNot(this.lessThan());
          case 'btw':
            return this.isNot(this.between());
          case 'mod':
            return this.isNot(this.mod());
          default:
            return this.isNot(this.greaterThan());
        }
    }
  }
}

class EwNodeActions {
  _ew;
  _node;
  _param;
  constructor(ew, node, param) {
    this.ew = ew;
    this.node = node;
    this.param = param;
  }

  get param() {
    return this._param;
  }

  set param(param) {
    this._param = param;
  }

  get node() {
    return this._node;
  }

  set node(node) {
    this._node = node;
  }

  get ew() {
    return this._ew;
  }

  set ew(ew) {
    this._ew = ew;
  }

  buildBaseAlarmState() {
    this.node.alarm_states = this.node.alarm_states || {};
    if (typeof this.node.alarm_states === 'string') {
      this.node.alarm_states = JSON.parse(this.node.alarm_states);
    }
  }

  setUpAlarmStates(key) {
    this.buildBaseAlarmState();
    this.node.alarm_states[key] = this.node.alarm_states[key] || [];
  }

  addIssue(key) {
    this.node.alarm_states[key].push({
      ews: this.param.value,
      threshold: this.param.val,
      color: this.ew.color
    });
  }

  applyIssues(key) {
    this.setUpAlarmStates(key);
    this.addIssue(key);
  }
}

module.exports = { EwActionParams, EwNodeActions };
