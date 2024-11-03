const { SqlUtils } = require('similie-api-services');

class InventoryTypeCounter {
  constructor(charting) {
    this._charting = charting;
  }

  get meta() {
    return this.story.meta || {};
  }

  get storyId() {
    return this.charting.storyId;
  }

  get charting() {
    return this._charting;
  }

  get stations() {
    return this._charting.stations;
  }

  get utils() {
    return this._charting.utils;
  }

  get story() {
    return this._story;
  }

  set story(story) {
    this._story = story;
  }

  get schema() {
    return this._schema;
  }

  set schema(schema) {
    this._schema = schema;
  }

  get config() {
    return this._config;
  }

  set config(config) {
    this._config = config;
  }

  get schemaId() {
    return this.config.schema;
  }

  hasStations() {
    return this.charting.hasStations;
  }

  setMetaContext() {
    const meta = this.meta;
    this.config = meta.config;
  }

  checkMetaContext() {
    this.setMetaContext();
    return !!this.config && !!this.config.schema;
  }

  async pullStory() {
    this.story = await this.utils.pullStory(this.storyId);
  }

  async buildLineage() {
    this.lineage = await this.utils.buildLineage(this.stations);
  }

  async pullSchema() {
    this.schema = await NodeSchema.findOneById(this.schemaId);
    if (!this.schema) {
      throw new Error('A schema with this ID cannot be found');
    }
  }

  getQuery(children) {
    const stations = this.utils.filterIds(children);
    const qParam = this.utils.getQuantityParam(this.schema);
    const escape = SqlUtils.escapeUtil();
    const query = escape(
      `
    SELECT COUNT
	( * ) :: INT as "count",
	COALESCE ( SUM ( "%s" ) :: INT, 0 ) as "total" 
    FROM
	    %s 
    WHERE
	    "station" %s;
      `,
      qParam,
      this.utils.getDatabase(this.schema),
      SqlUtils.setInString(stations)
    );
    return query;
  }

  async pullQueryResults(children) {
    const query = this.getQuery(children);
    const results = await Model.queryAsync(query);
    return results.rows.pop();
  }

  async buildRenderActions(station, children) {
    const results = await this.pullQueryResults(children);
    station.count_results = results;
  }

  async cycleStations() {
    await this.utils.cycleStations(
      this.lineage,
      this.buildRenderActions.bind(this)
    );
  }

  getNodeDetails() {
    const schema = this.schema;
    return {
      name: schema.title || schema.name,
      id: schema.id
    };
  }

  async render() {
    if (!this.hasStations()) {
      return { warning: 'A station context is required to render this story' };
    }

    await this.pullStory();

    if (!this.checkMetaContext()) {
      return { warning: 'Story configuration is required' };
    }
    try {
      await this.pullSchema();
      await this.buildLineage();
      await this.cycleStations();
      return {
        stations: this.lineage,
        nodeDetails: this.getNodeDetails(),
        config: this.config
      };
    } catch (e) {
      return { error: e.message };
    }
  }
}
module.exports = { InventoryTypeCounter };
