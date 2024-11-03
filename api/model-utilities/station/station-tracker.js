class StationTracker {
  _tracker;
  constructor(tracker) {
    if (!tracker) {
      throw new Error('A Station Tracker is Required');
    }
    this.tracker = tracker;
  }

  get tracker() {
    return this._tracker;
  }

  set tracker(tracker) {
    this._tracker = tracker;
  }

  get decimalToString() {
    return this.tracker.decimal.toString();
  }

  get decimalValueLength() {
    return this.containsE(this.decimalToString)
      ? this.countExponent(this.decimalToString)
      : this.decimalToString.length;
  }

  get noDotLength() {
    return this.decimalValueLength - 1;
  }

  get count() {
    return this.tracker.count + 1;
  }

  get countString() {
    return this.count.toString() || '';
  }

  get countLength() {
    return this.countString.length;
  }

  get maxValue() {
    let nines = '';
    for (let i = 0; i < this.noDotLength; i++) {
      nines += '9';
    }
    if (!nines) {
      return 0;
    }
    return parseInt(nines);
  }

  countExponent(stringExponent = '') {
    const eIndex = stringExponent.indexOf('-');
    const expo = stringExponent.substring(eIndex + 1, stringExponent.length);
    const length = parseInt(expo);
    if (Number.isNaN(length)) {
      throw new Error('The Tracker index cannot be parsed');
    }
    return length + '0.'.length;
  }

  containsE(stringValue = '') {
    return stringValue.indexOf('e') !== -1;
  }

  checkMaxExceeded() {
    if (this.count <= this.maxValue) {
      return;
    }
    throw new Error('Max Tracking ID Exceeded');
  }

  get zeroLength() {
    return this.noDotLength - this.countLength;
  }

  get applyZeros() {
    let zeros = '';
    for (let i = 0; i < this.zeroLength; i++) {
      zeros += '0';
    }
    return zeros;
  }

  get nextId() {
    return this.applyZeros + this.countString;
  }

  async formatId() {
    if (!this.tracker.id) {
      throw new Error('Invalid Tracking Object');
    }

    this.checkMaxExceeded();
    const value =
      this.tracker.prefix + (this.tracker.postfix || '') + this.nextId;
    await this.tracker.increment();
    return value;
  }
}

module.exports = { StationTracker };
