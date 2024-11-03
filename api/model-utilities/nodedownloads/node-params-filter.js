class NodeParamsFilter {
  _params = [];
  _selectedParams = {};
  constructor(schema, selectedParams = {}) {
    this._parameters = schema.schema || [];
    this._selectedParams = selectedParams;
  }

  build() {
    const params = this.paramsFilter();
    this.paramsOrder(params);
  }

  isIn(param = {}) {
    // here we are going to restrict the params to certain
    // types. Given that we have no ability to pull asyncronous
    // details when processing the file stream
    const restrictedParams = { node: true };
    return !restrictedParams[param.type];
  }

  /**
   * isSelected
   * @description This returns all params if none are selected, however,
   * if it has a size, it will only return those params that have been added
   * to the object
   * @param {Object} param
   * @returns
   */
  isSelected(param) {
    const keys = Object.keys(this._selectedParams);
    if (!keys.length) {
      return true;
    }
    return this._selectedParams[param.name];
  }

  isAvailable(param) {
    return (
      param.active &&
      !param.hidden &&
      this.isIn(param) &&
      this.isSelected(param)
    );
  }

  paramsFilter() {
    // we do this to cache the params since it can be called millions of times
    if (this._params.length) {
      return this._params;
    }
    const params = [];
    this._parameters.forEach(p => {
      if (this.isAvailable(p)) {
        params.push(p);
      }
    });
    return params;
  }

  paramsOrder(params) {
    Node.sortSchema(params);
    this._params = params;
  }

  get params() {
    return this._params;
  }
}

module.exports = { NodeParamsFilter };
