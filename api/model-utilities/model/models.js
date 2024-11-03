class Model {
  model = null;
  constructor(modelName) {
    this.model = sails.models[modelName];
  }

  get instance() {
    return this.instance;
  }

  get model() {
    return this.model;
  }

  get attr() {
    return this.model._attributes;
  }

  getId(values) {
    return this.model.getId(values);
  }

  findOne(query) {
    return this.model.findOne(query);
  }

  find(query) {
    return this.model.find().where(query);
  }

  async findOneById(id) {
    if (!id) {
      return null;
    }
    return this.model.findOneById(this.getId(id));
  }

  save(values) {
    return this.model.saveAsync(values);
  }

  create(values) {
    return this.model.create(values);
  }

  update(query, changes) {
    return this.model.update(query, changes);
  }

  count(query) {
    return this.model.count().where(query);
  }
}

module.exports = { Model };
