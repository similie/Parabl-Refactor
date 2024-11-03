const { TimeUtils } = require('similie-api-services');
const { EwsActionUtils } = require('../early-warning/ews/ews-action-utils');
const tz = TimeUtils.constants.timeZone;
const now_ = TimeUtils.constants.now_;
const TimePeriod = TimeUtils.constants.ENUMS.timePeriods;

class StationEventBoundary {
  consumed = false;
  _potentials = [];
  _ecEvents = [];
  nodeSchemaHold = {};
  stationSchemaHold = {};
  constructor(payload = {}) {
    this.registry = payload.register;
    this.context = payload.context;
    this.ecStation = payload.station;
    this.nodeschema = payload.ns;
    this.node = payload.node;
  }

  /**
   * @name getId
   * @description gets the id from a given value
   * @param {any} values
   * @returns {number|null}
   */
  getId(values) {
    return Station.getId(values);
  }

  /**
   * GETTERS AND SETTERS
   */
  get ecEvents() {
    return this._ecEvents;
  }

  get potentials() {
    return this._potentials;
  }

  get nodeId() {
    return this.getId(this.node);
  }

  get node() {
    return this._node;
  }

  set node(node) {
    this._node = node;
  }

  get nodeschema() {
    return this._nodeschema;
  }

  set nodeschema(nodeschema) {
    this._nodeschema = nodeschema;
  }

  get schemaId() {
    return this.getId(this.nodeschema);
  }

  get registry() {
    return this._registry;
  }

  set registry(registry) {
    this._registry = registry;
  }

  get context() {
    return this._context || {};
  }

  set context(context) {
    this._context = context;
  }

  get device() {
    return this.context.device || null;
  }

  get stationId() {
    return this.getId(this.station);
  }

  get station() {
    return this._station;
  }

  set station(station) {
    this._station = station;
  }

  get ecStation() {
    return this.getId(this._ecstation);
  }

  set ecStation(station) {
    this._ecstation = station;
  }

  get stationSchemaId() {
    return this.getId(this.stationSchema);
  }

  get stationSchema() {
    return this._stationSchema;
  }

  set stationSchema(stationSchema) {
    this._stationSchema = stationSchema;
  }

  get domain() {
    return this._domain || null;
  }

  set domain(domain) {
    this._domain = domain;
  }

  get eventClusters() {
    return this._eventClusters;
  }

  set eventClusters(eventClusters) {
    this._eventClusters = eventClusters;
  }

  get triggerStation() {
    return this.getId(this.node.station);
  }

  /**
   * @name getDomain
   * @description applys the domain to the model
   * @returns {Promise<domain>}
   */
  async getDomain() {
    if (this.domain) {
      return this.domain;
    }
    const stationSchema = await this.getStationSchema();
    this.domain = stationSchema.domain;
    return this.domain;
  }

  /**
   * @name getStationSchema
   * @description get context station schema
   * @returns {stationschema}
   */
  async getStationSchema() {
    if (this.stationSchema) {
      return this.stationSchema;
    }
    this.stationSchema = await Station.getStationSchema(this.station);
    return this.stationSchema;
  }

  /**
   * @name pullEventClusters
   * @description gets the clusters for the given station
   * @returns {Promise<eventcluster[]>}
   */
  async pullEventClusters() {
    if (this.eventClusters) {
      return this.eventClusters;
    }
    // const station = await this.applyStation();
    this.eventClusters = await EventCluster.find({
      station: this.ecStation,
      active: true
    }).populateAll();
    return this.eventClusters;
  }

  /**
   * @name applyStation
   * @description pull station into the model
   * @returns {Promise<station>}
   */
  async applyStation() {
    if (this.station) {
      return this.station;
    }
    this.station = await Station.findOneById(
      this.getId(this.registry)
    ).populateAll();
    return this.station;
  }

  /**
   * @name getCurrentEvent
   * @description gets the events that are related to
   * the current node type
   * @param {*} cluster
   * @returns
   */
  getCurrentEvent(cluster) {
    return cluster.earlywarnings.filter(
      ew => this.getId(ew.node) === this.schemaId
    );
  }

  /**
   * @name getActiveWarnings
   * @description gets only those events that are active
   * @param {*} cluster
   * @returns
   */
  getActiveWarnings(cluster = {}) {
    return cluster.earlywarnings.filter(ew => ew.active);
  }

  /**
   * @name getContextWarnings
   * @description filters out those events that are
   * related to the trigger station
   */
  getContextWarnings(activeWarnings = []) {
    return activeWarnings.filter(
      ew => this.getId(ew.station) === this.triggerStation
    );
  }

  /**
   * @name getSplitWarnings
   * @description splits the early warning into context and
   * non context values
   * @param {earlywarning[]} activeWarnings
   * @returns {any}
   */
  getSplitWarnings(activeWarnings = []) {
    return {
      targetEvents: activeWarnings.filter(
        ew => this.getId(ew.station) === this.stationId
      ),
      supportingEvents: activeWarnings.filter(
        ew => this.getId(ew.station) !== this.stationId
      )
    };
  }

  /**
   * @name getWarningTimeout
   * @description gets the timeout from the ew event
   * @param {earlywarning} earlywarning
   * @returns {number}
   */
  getWarningTimeout(earlywarning) {
    return earlywarning.timeout || 0;
  }

  /**
   * @name getThresholdTime
   * @description packages the threshold time
   * in the early warning for query
   * @param {earlywarning} earlywarning
   * @returns {timestamp}
   */
  getThresholdTime(earlywarning) {
    const timeout = this.getWarningTimeout(earlywarning);
    if (!timeout) {
      return 0;
    }
    return TimeUtils.date(now_)
      .minus(timeout, TimePeriod.minutes)
      .tz(tz).toISO;
  }

  /**
   * @name getEventNodeSchema
   * @description gets the nodeschema for the event
   * context
   * @param {earlywarning} earlywarning
   * @returns {Promise<nodeschema>}
   */
  async getEventNodeSchema(earlywarning) {
    const nId = this.getId(earlywarning.node);
    if (!nId) {
      throw new Error('Node is not available');
    }
    if (nId === this.schemaId) {
      return this.nodeschema;
    }

    if (this.nodeSchemaHold[nId]) {
      return this.nodeSchemaHold[nId];
    }

    const nodeSchema = await NodeSchema.findOneById(nId);
    this.nodeSchemaHold[nId] = nodeSchema;
    return this.nodeSchemaHold[nId];
  }

  /**
   * @name getEventStationSchema
   * @description gets the events stationschema
   * @param {station} warningStation
   * @returns {Promise<stationschema>}
   */
  async getEventStationSchema(warningStation) {
    const sId = this.getId(warningStation.station_type);
    if (sId === this.stationSchemaId) {
      return this.stationSchema;
    }

    if (this.stationSchemaHold[sId]) {
      return this.stationSchemaHold[sId];
    }

    const stationSchema = await StationSchema.findOneById(sId).populate(
      'nodes'
    );
    this.stationSchemaHold[sId] = stationSchema;
    return this.stationSchemaHold[sId];
  }

  /**
   * @name checkSchemaContext
   * @description verifies the context stationschema is the same as the
   * station where the warning exists
   * @param {stationschema} eventSchema
   * @param {stationschema} warningStation
   * @returns {boolean}
   */
  checkSchemaContext(eventSchema, warningStation) {
    return this.getId(eventSchema) === this.getId(warningStation.station_type);
  }

  /**
   * @name containsEventSchema
   * @description checks to ensure the nodeschema has the
   * correct nodeschema in its stationschema
   * @param {stationschema} eventSchema
   * @param {station} warningStation
   * @returns {stationschema|false}
   */
  containsEventSchema(eventSchema, warningStation) {
    if (this.checkSchemaContext(eventSchema, warningStation)) {
      return eventSchema;
    }
    const nodes = eventSchema.nodes || [];
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const nId = this.getId(node);
      if (nId === this.nodeId) {
        return eventSchema;
      }
    }
    return false;
  }

  /**
   * @name buildBroadcastQuery
   * @description we bould a query to ensure that we are finding
   * an the most recent event
   * @param {earlywarning} activeWarning
   * @returns
   */
  buildBroadcastQuery(activeWarning) {
    const thresholdTime = this.getThresholdTime(activeWarning);
    const query = {
      event: this.getId(activeWarning),
      confirmed: true,
      burned: false,
      event_category: EwsActionUtils.EWEventCategory.EarlyWarning
    };
    if (thresholdTime) {
      query.where.createdAt = {
        '>=': thresholdTime
      };
    }
    return query;
  }

  /**
   * @name pullEventBroadcast
   * @description pulls the most recent event broadcasts for a
   * given earlywarning event
   * @param {pullEventBroadcast} activeWarning
   * @returns
   */
  async pullEventBroadcast(activeWarning) {
    return EventBroadcast.find()
      .where(this.buildBroadcastQuery(activeWarning))
      .sort('updatedAt', 'DESC')
      .limit(1);
  }

  /**
   * @name generateQuery
   * @description wraps the node query into a specific function
   * @param {earlywarning} activeWarning
   * @param {statin} warningStation
   * @returns {any}
   */
  generateQuery(activeWarning, warningStation) {
    const thresholdTime = this.getThresholdTime(activeWarning);
    const query = {
      limit: 1,
      sort: {
        createdAt: 'DESC'
      },
      where: {
        station: this.getId(warningStation)
      }
    };
    if (thresholdTime) {
      query.where.createdAt = {
        '>=': thresholdTime
      };
    }
    return query;
  }

  /**
   * @name pullBroadcastTarget
   * @description we want the node we've pulled from the
   * event broadcast
   * @param {eventbroadcast} broadcasts
   * @returns
   */
  async pullBroadcastTarget(broadcasts = []) {
    const [broadcast] = broadcasts;
    if (!this.getId(broadcast)) {
      throw new Error('Broadcast not found');
    }
    const node = await EventBroadcast.getTarget(broadcast);
    if (!node) {
      throw new Error('Target Node Not Found');
    }
    return [node];
  }

  /**
   * @name getNodesForEvent
   * @description searches for a node recent node that violates
   *  the given event conditions
   * @param {earlywarning} activeWarning
   * @param {statin} warningStation
   * @param {nodeschema} eventSchema
   * @returns {Promise<node[]>}
   */
  async getNodesForEvent(activeWarning, warningStation, eventSchema) {
    const stationNode = this.getId(this.node.station);
    if (stationNode && stationNode === this.getId(warningStation)) {
      return [this.node];
    }
    // here we want to see if the event broadcast has a valid record
    const broadcasts = await this.pullEventBroadcast(activeWarning);
    if (broadcasts.length) {
      return this.pullBroadcastTarget(broadcasts);
    }
    // here we fall back to simply checking the last node
    const query = this.generateQuery(activeWarning, warningStation);
    return Node.findNodes(query, eventSchema);
  }

  /**
   * @name getEventLocals
   * @description places the event depencencies into a single object
   * @param {node} node
   * @param {station} localStation
   * @param {nodeschema} localNodeSchema
   * @returns {any}
   */
  getEventLocals(node, localStation, localNodeSchema) {
    return {
      schema: localNodeSchema,
      device: this.getId(this.device),
      domain: this.getId(this.domain),
      station: this.getId(localStation),
      node: node
    };
  }

  /**
   * @name buildEwsQuery
   * @description wraps search query into a function
   * @param {earlywarning} ewEvent
   * @param {node} node
   * @returns {object}
   */
  buildEwsQuery(ewEvent, node) {
    return {
      early_warning: this.getId(ewEvent),
      event_category: EwsActionUtils.EWEventCategory.EarlyWarning,
      target: this.getId(node),
      perform: true,
      burned: false
    };
  }

  /**
   * @name searchEws
   * @description searches for existing ews models
   * @param {earlywarning} ewEvent
   * @param {node} node
   * @returns <Promise<ews[]>>
   */
  async searchEws(ewEvent, node) {
    return EWS.find()
      .where(this.buildEwsQuery(ewEvent, node))
      .limit(1)
      .sort('triggered_time', 'DESC');
  }

  /**
   * @name findSupportingEventDefinitions
   * @description finds events for other stations in the cluster
   * @param {node} node
   * @param {earlywarning[]} processedWarnings
   * @returns {Promise<ews[]>}
   */
  async findSupportingEventDefinitions(node, processedWarnings = []) {
    const events = [];
    for (let i = 0; i < processedWarnings.length; i++) {
      const ewEvent = processedWarnings[i];
      const ews = await this.searchEws(ewEvent, node);
      events.push(...ews);
    }

    return events;
  }

  /**
   * @name generateTestedEvents
   * @description builds any array of ews events that have occured
   * for the given cluster
   * @param {node} node
   * @param {earlywarning[]} processedWarnings
   * @returns {Promise<ews[]>}
   */
  async generateTestedEvents(node, processedWarnings = []) {
    const clusters = [];
    const splitWarnings = this.getSplitWarnings(processedWarnings);
    // we only want to trigger an event for the station that is being
    // triggered
    const stationCluster = await EWS.eventProcessor({
      ews: splitWarnings.targetEvents,
      node: node,
      domain: this.domain
    });
    clusters.push(...stationCluster);
    // here we are checking to see if there were other events in the cluster
    // that need to be checked
    const supportingCluster = await this.findSupportingEventDefinitions(
      node,
      splitWarnings.supportingEvents
    );
    clusters.push(...supportingCluster);
    return clusters;
  }

  /**
   * @name processClusters
   * @description sends the node and the post-processed early warnings
   * to additional logic so as to check for valid events
   * @param {node} node
   * @param {earlywawrnings[]} processedWarnings
   * @returns {Promise<any[]>}
   */
  async processClusters(node, processedWarnings = []) {
    if (!processedWarnings.length) {
      return [];
    }

    try {
      const clusters = await this.generateTestedEvents(node, processedWarnings);
      if (clusters.length !== processedWarnings.length) {
        return [];
      }
      return clusters;
    } catch (e) {
      sails.log.error('StationEventBoundary.processClusters', e);
      return [];
    }
  }

  /**
   * @name setConsumption
   * @description sets consummed to true when we find the working node ID
   * @param {node} node
   */
  setConsumption(node) {
    if (this.consumed) {
      return;
    }
    this.consumed = this.getId(node) === this.nodeId;
  }

  /**
   * @name setProceessedNode
   * @description adds the processed node to locals
   * @param {any} locals
   * @param {any} processedWarnings
   */
  setProceessedNode(locals, processedWarnings) {
    locals.node = processedWarnings.node;
  }

  /**
   * @name applyNodeToEarlyWarning
   * @description gets the node for the given earlywarning event
   * to check all contexts for warnings
   * @param {nodes[]} nodes
   * @param {station} localStation
   * @param {nodeschema} localNodeSchema
   * @param {eventcluster} cluster
   * @returns {Promise<any[]>}
   */
  async applyNodeToEarlyWarning(
    nodes = [],
    localStation,
    localNodeSchema,
    cluster
  ) {
    const [node] = nodes;
    // set the work as having been consumed once we find our target node
    this.setConsumption(node);
    const locals = this.getEventLocals(node, localStation, localNodeSchema);
    const processedWarnings = await EarlyWarning.process(node, locals, cluster);
    const earlywarnings = processedWarnings.ewStorage;
    const clusters = await this.processClusters(node, earlywarnings);
    if (!clusters.length) {
      return [];
    }
    this.setProceessedNode(locals, processedWarnings);
    return [
      {
        locals: locals,
        ews: earlywarnings,
        clusters: clusters
      }
    ];
  }

  /**
   * @name isNotFullyProcessed
   * @description checks to see if the counted potentials is the same as the
   * number of active events in the cluster
   * @param {earlywarning[]} activeWarnings
   * @returns {boolean} true if its not a vaild cluster event
   */
  isNotFullyProcessed(activeWarnings = []) {
    return this.potentials.length !== activeWarnings.length || !this.consumed;
  }

  /**
   * @name mergePotentials
   * @description adds the potential events to the mao
   */
  mergePotentials() {
    this.ecEvents.push(
      ...this.potentials.map(p => {
        return {
          ...p,
          eventType: EwsActionUtils.EWEventCategory.EarlyWarning
        };
      })
    );
  }

  /**
   * @name completeEvent
   * @description if we've counted all events check to see
   * if the contained potential events equals that of the number
   * of active events in the cluster
   * @param {earlywarning[]} activeWarnings
   * @param {eventcluster} cluster
   * @returns <Promise<void>>
   */
  async completeEvent(activeWarnings = [], cluster) {
    if (this.isNotFullyProcessed(activeWarnings)) {
      return;
    }
    this.mergePotentials();
    const locals = {
      // we set station as the to node
      // apply it as the target ID
      node: this.ecStation,
      domain: this.domain,
      category: EwsActionUtils.EWEventCategory.EventCluster,
      ews: [cluster]
    };

    const thisCluster = await EWS.eventProcessor(locals);
    this.ecEvents.push(
      ...thisCluster.map(c => {
        return {
          ...locals,
          clusters: c,
          eventType: EwsActionUtils.EWEventCategory.EventCluster
        };
      })
    );
  }

  /**
   * @name getWarningStation
   * @description gets the station for the given early warning context
   * @param {earlywarning} earlywarning
   * @returns {Promise<station>}
   */
  getWarningStation(earlywarning) {
    const warningStationId = this.getId(earlywarning.station);
    if (!warningStationId) {
      throw new Error('Station ID Not Found');
    }
    return Station.findOneById(warningStationId);
  }

  /**
   * @name getSelectedEventSchema
   * @description gets the stationschema for the given event context
   * @param {station} warningStation
   * @returns {Promise<stationschema|null>}
   */
  async getSelectedEventSchema(warningStation) {
    const warningSchema = await this.getEventStationSchema(warningStation);
    return this.containsEventSchema(warningSchema, warningStation);
  }

  /**
   * @name clusterBuilder
   * @description performs work to determin if the cluster is
   * in alter
   * @param {earlywarning} activeWarning
   * @param {station} warningStation
   * @param {nodeschema} eventSchema
   * @param {eventcluster} cluster
   * @returns {Promise<any>}
   */
  async clusterBuilder(activeWarning, warningStation, eventSchema, cluster) {
    const nodes = await this.getNodesForEvent(
      activeWarning,
      warningStation,
      eventSchema
    );
    if (!nodes.length) {
      // again ensure this is the correct logic
      return false;
    }

    const clusters = await this.applyNodeToEarlyWarning(
      nodes,
      warningStation,
      eventSchema,
      cluster
    );

    if (!clusters.length) {
      // again ensure this is the correct logic
      return false;
    }
    const [producedCluster] = clusters;
    return producedCluster;
  }

  /**
   * @name applyIterablesForEvents
   * @description pulls the schema and station values
   * for the early warnings and sends these values to clusterBuilder
   * for additional work
   * @param {earlywarning[]} activeWarning
   * @param {eventcluster} cluster
   * @returns <Promise<any[]|false>
   */
  async applyIterablesForEvents(activeWarning, cluster) {
    // now setup function dependents
    const warningStation = await this.getWarningStation(activeWarning);
    // we pull the station schema in order to check of it as the correct
    // nodes attached
    const warningStationSchema = await this.getSelectedEventSchema(
      warningStation
    );
    // if there is no schema available, end the work
    if (!warningStationSchema) {
      return false;
    }

    const eventSchema = await this.getEventNodeSchema(activeWarning);
    if (!eventSchema) {
      return false;
    }
    return this.clusterBuilder(
      activeWarning,
      warningStation,
      eventSchema,
      cluster
    );
  }

  /**
   * @name iterateActiveWarnings
   * @description iterates the active warnings
   * @param {earlywarning[]} activeWarnings
   * @param {eventcluster} cluster
   * @returns {Promise<any[]>}
   */
  async iterateActiveWarnings(activeWarnings = [], cluster) {
    const potentials = [];
    for (let i = 0; i < activeWarnings.length; i++) {
      const activeWarning = activeWarnings[i];
      const eventValues = await this.applyIterablesForEvents(
        activeWarning,
        cluster
      );
      // we need to strongly consider the break
      // we may never encounter the event, so we need to
      // to continue even though it won't ever
      if (!eventValues) {
        if (!this.consumed) {
          continue;
        }
        // once we have triggered the event
        // for this station in question, we can break
        // there will be no events trigger given that our events
        // are empty
        break;
      }
      potentials.push(eventValues);
    }
    return potentials;
  }

  /**
   * @name buildEventPotential
   * @description wraps the work around iterating the
   * cluster early warnings
   * @param {earlywarning[]} activeWarnings
   * @param {eventcluster} cluster
   */
  async buildEventPotential(activeWarnings, cluster) {
    const potentials = await this.iterateActiveWarnings(
      activeWarnings,
      cluster
    );
    if (!potentials.length) {
      throw new Error('No Potential Events');
    }
    this.potentials.push(...potentials);
  }

  /**
   * @name resetPotentials
   * @description Simply sets the potentials array to 0
   */
  resetPotentials() {
    this.potentials.length = 0;
    this.consumed = false;
  }

  /**
   * @name buildPotentials
   * @description Iterates the clusters and poulates the cluster array when
   * a valid event is found
   */
  async buildPotentials() {
    for (let i = 0; i < this.eventClusters.length; i++) {
      const cluster = this.eventClusters[i];
      // used to filter out events not related to the current event
      const earlywarnings = this.getCurrentEvent(cluster);
      if (!earlywarnings.length) {
        continue;
      }
      // here are the warnings that are actually active
      const activeWarnings = this.getActiveWarnings(cluster);
      if (!activeWarnings.length) {
        continue;
      }

      // we do this to make sure there is an early warning related
      // to the node in question
      const contextWarnings = this.getContextWarnings(activeWarnings);
      if (!contextWarnings.length) {
        continue;
      }
      try {
        await this.buildEventPotential(activeWarnings, cluster);
      } catch {
        continue;
      }
      await this.completeEvent(activeWarnings, cluster);
      this.resetPotentials();
    }
  }

  async burnBroadcasts(dependents = {}) {
    await EventBroadcast.update(
      {
        warning: dependents.clusters,
        event_category: EwsActionUtils.EWEventCategory.EarlyWarning
      },
      { burned: true }
    );
  }

  async burnDependents(dependents = {}) {
    if (!dependents.clusters || !dependents.clusters.length) {
      return;
    }
    await EWS.update(
      {
        id: dependents.clusters,
        event_category: EwsActionUtils.EWEventCategory.EarlyWarning
      },
      { burned: true }
    );
    return this.burnBroadcasts();
  }

  async buildBuildDependentsArray(dependents = {}) {
    if (!dependents.id || !dependents.clusters.length) {
      return;
    }
    await EventBroadcast.update(
      {
        warning: this.getId(dependents),
        event_category: EwsActionUtils.EWEventCategory.EventCluster
      },
      { dependencies: dependents.clusters }
    );
    return this.burnDependents(dependents);
  }

  iterateIdAgainstClusters(clusters = [], values = []) {
    for (const cluster of clusters) {
      values.push(this.getId(cluster));
    }
  }

  setNewDependents() {
    return {
      clusters: [],
      id: null
    };
  }

  async applyEcToBroadcasts() {
    const dependents = this.setNewDependents();
    for (const ec of this.ecEvents) {
      if (ec.eventType === EwsActionUtils.EWEventCategory.EarlyWarning) {
        const clusters = ec.clusters || [];
        this.iterateIdAgainstClusters(clusters, dependents.clusters);
      } else if (ec.clusters) {
        dependents.id = this.getId(ec.clusters);
      }
    }
    await this.buildBuildDependentsArray(dependents);
  }

  /**
   * @name run
   * @description A wrapper function to call the requisite logic
   * @returns {boolean: EventCluster[]}
   */
  async run() {
    await this.pullEventClusters();
    if (!this.eventClusters.length) {
      return false;
    }
    await this.applyStation();
    await this.getStationSchema();
    await this.getDomain();
    await this.buildPotentials();
    if (!this.ecEvents.length) {
      return false;
    }
    await this.applyEcToBroadcasts();
    return this.ecEvents;
  }
}

module.exports = { StationEventBoundary };
