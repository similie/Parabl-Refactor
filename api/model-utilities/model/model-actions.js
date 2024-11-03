class ModelActions {
  _req;
  _res;
  _model;
  _method;
  _params;
  _alterationModel;
  constructor(req, res) {
    this._req = req;
    this._res = res;
    this._method = req.method;
    this._params = req.params.all();
    if (!Model.getId(this._params)) {
      throw new Error('A model ID is required');
    }
    this._model = sails.models[this._params.model];
    if (!this._model) {
      throw new Error('A model of this type does not exist');
    }
  }

  socketBlast(verb) {
    const error = this._params.error;
    sails.sockets.blast(this._params.model, {
      id: this._params.id,
      model: this.alterationModel,
      error: error,
      verb: verb
    });
  }

  async applyAction() {
    switch (this._method) {
      case 'PUT':
        this.socketBlast('update');
        break;
      case 'POST':
        this.socketBlast('create');
        return this._res.created(this.alterationModel);
      case 'DELETE':
        this.socketBlast('delete');
        return this._res.ok({ id: this._params.id });
      case 'get':
        this.socketBlast('search');
    }
    sails.log.debug('Model authorized', this.alterationModel);
    return this._res.ok(this.alterationModel);
  }

  async setModel() {
    if (this._method === 'DELETE') {
      this.alterationModel = null;
      return;
    }
    this.alterationModel = await this._model.findOneById(this._params.id);
    if (!this.alterationModel) {
      throw new Error('This model cannot be found');
    }
  }

  async buildAction() {
    await this.setModel();
    await this.applyAction();
  }

  get alterationModel() {
    return this._alterationModel;
  }

  set alterationModel(alterationModel) {
    this._alterationModel = alterationModel;
  }
}

module.exports = { ModelActions };
