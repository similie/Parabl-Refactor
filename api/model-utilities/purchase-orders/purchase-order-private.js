const { TimeUtils } = require('similie-api-services');

const {
  internalReceiptVariance,
  processVariants,
  calculateCostAndApplyVariants,
  calculateCosts,
  getAllCompleteCostConvertedElements,
  ensureRetailCostIsCorrect,
  processInvoiceToCostCode
} = require('./purchase-order-costs');
const {
  buildSerials,
  manageSerials,
  iterateItemCountsToCacheWithSerials,
  buildNewSerialCacheItem
} = require('./purchase-order-serials');
const share = require('./purchase-order-shared');

const { poStates } = require('./purchase-order-states');
const { Common } = require('../common/common');
const { getReplacementTemplate } = require('./purchase-order-replacement');
const { PurchaseOrderModel } = require('./purchase-order-model');
const now_ = TimeUtils.constants.now_;

class PurchaseOrderPrivates {
  /**
   * @name buildNodeCache
   * @description turns nodes into an ID map for easy for constant-time reference
   * @returns {any}
   */
  static buildNodeCache() {
    return share.buildNodeCache(...arguments);
  }

  serialReferences = {};
  qIn = 'quantity_incoming';
  qOut = 'quantity_outgoing';
  quant = 'quantity';
  uCost = 'unit_cost';
  skuP = 'sku';
  returns = null;
  serialHold = {};
  domain = null;
  serializer = null;
  replacement = false;
  totalReturn = 0;
  replacementNodes = [];
  recieptCosts = null;
  trackingReceiptSerials = null;
  trackingReceiptItems = null;

  site = null;
  receipt = null;
  purchaseorder = null;
  itemCache = null;
  nodeCache = null;
  schema = null;
  model = null;
  stationsMap = null;
  constructor(po) {
    this.purchaseorder = po;
    this.model = new PurchaseOrderModel();
  }

  /**
   * get the po instance
   * @returns {PurchaseOrderInstance}
   */
  get po() {
    return this.purchaseorder;
  }

  /**
   * po
   * setter for the purchase order item
   *
   * * @param {PurchaseOrderInstance} values
   */
  set po(values) {
    this.purchaseorder = values;
  }

  get state() {
    return this.po.state;
  }

  get from() {
    return this.po.from;
  }

  get to() {
    return this.po.to;
  }

  get meta() {
    return this.po.meta || {};
  }

  get items() {
    return this.po.items || [];
  }

  get packageCache() {
    const packaging = this.meta.packaging || [];
    const cache = {};
    packaging.forEach(pack => {
      cache[pack.tracking_id] = pack;
    });
    return cache;
  }

  /**
   * buildSerialReferences
   */
  buildSerialReferences() {
    this.serialReferences = {};
    _.each(this.meta.serial_references, s => {
      this.serialReferences[s.item] = this.serialReferences[s.item] || [];
      this.serialReferences[s.item].push(s.scan);
    });
  }

  /**
   * applyProjectedCosts
   *
   * Applies the project cost to a new created purchase order
   *
   * @returns Promise<PurchaseOrderInstance>
   */
  async applyProjectedCosts() {
    await this.rebuildSelf();
    if (Common.hasBeenTouched(this.getMetaAttr('projected_cost'))) {
      return;
    }

    await this.loadMyNodeCache();
    await this.loadMyLogParams();
    const currency = await this.loadMyCurrency();
    const costElements = calculateCosts(
      this.po.items,
      this.nodeCache,
      currency,
      this.param(this.uCost)
    );
    this.setMetaAttr('projected_cost', costElements.total_cost);
    // this.printMeta();
    return this.save();
  }

  /**
   * save
   *
   * Save the existing state to the database
   *
   * @returns Promise<PurchaseOrderInstance>
   */
  save() {
    return this.model.save(this.po);
  }

  /**
   * printMeta
   *
   * Simply prints the meta for debugging
   */
  printMeta() {
    sails.log.debug('META VALUES FOR', this.po.id, this.po.meta);
  }

  /**
   * setLastState
   *
   * applies the last state to the meta object
   *
   * @param {string} state
   */
  setLastState(state) {
    this.setMetaAttr('last_state', state);
  }

  async applyRejection() {
    // await this.rebuildSelf();
    // if (this.lastStateWas(poStates.PENDING) || this.isLocked()) {
    //   return;
    // }
    // return this.savePoWithState(poStates.PENDING);
  }

  /**
   * lastStateWas
   *
   * checks to see if the last state matches the params
   *
   * @param {string} state
   * @returns boolean - true if last state matches
   */

  lastStateWas(state = '') {
    return this.getLastState() === state;
  }

  /**
   * getLastState
   *
   * Gets the previous state from
   * the instance meta
   *
   * @returns {string} state
   */
  getLastState() {
    const meta = this.po.meta || {};
    return meta.last_state;
  }

  /**
   * setItemMap
   *
   * Builds the itemCache with the purchase order items
   *
   * @returns void
   */
  setItemMap() {
    if (this.itemCache) {
      return;
    }
    this.itemCache = {};
    for (let i = 0; i < this.po.items.length; i++) {
      const item = this.po.items[i];
      const id = this.model.getId(item);
      this.itemCache[id] = item;
    }
  }

  /**
   * getItemFromMap
   *
   * Gets an inventory Item from the map
   *
   * @param {id|object} node
   * @returns Item
   */
  getItemFromMap(node) {
    this.setItemMap();
    const id = this.model.getId(node);
    if (!id) {
      return null;
    }
    return this.itemCache[id] || {};
  }

  /**
   * getNodeFromMap
   *
   * Gets the node object from the
   * Model Param ID
   *
   * @param {id|object} item
   * @returns Promse<Node>
   */
  async getNodeFromMap(item) {
    await this.loadMyNodeCache();
    const id = this.model.getId(item);
    if (!id) {
      return null;
    }
    return this.nodeCache[id] || {};
  }

  /**
   *  Clones the existing purchase order instance
   * @returns PurchaseOrderInstance
   */
  getClonedPo() {
    return Object.assign({}, this.po);
  }

  /**
   * @name getInfoMessage
   * @description returns a payload for socket messaging
   * @param {string} text
   * @param {string} category
   * @returns {any}
   */
  getInfoMessage(text = '', category = 'info') {
    return {
      text: text,
      category: category
    };
  }

  /**
   * @name shippedState
   * @description Managers the shipped station functionality
   * @returns {Promise<PurchaseOrderInstance>} saved purchase order
   */
  async shippedState() {
    const processingState = poStates().PROCESSING;
    if (this.lastStateWas(processingState)) {
      return share.blastChange(this.getClonedPo(), this.po, 'update');
    }
    await this.rebuildSelf();
    return this.savePoWithState(processingState);
  }

  /**
   * @name savePoWithState
   *
   * @description saves the purchse order with the specified state and blasts these changes to the frontend
   *
   * @param {string} state
   * @param {object} message
   * @returns {Promise<PurchaseOrderInstance>} - the prior purchase order instance
   */
  async savePoWithState(state, message) {
    this.setLastState(state);
    await this.save();
    if (!Site.isInTestMode()) {
      await share.blastChange(this.getClonedPo(), this.po, 'update', message);
    }
    return this.po;
  }

  /**
   * @name rebuildSelf
   *
   * @description rebuilds the internal based on all new params. This is used because
   * we have the values being called with incomplete models
   *
   * @param {boolean} all - if you want all details poplulated
   * @returns {Promise<PurchaseOrderInstance>}
   */
  async rebuildSelf(all) {
    const id = this.model.getId(this.po);
    if (!id) {
      throw new Error('Purchase Order ID is required');
    }

    const query = PurchaseOrder.findOneById(id);
    if (all) {
      query.populateAll();
    }

    this.po = await query;
    return this.po;
  }

  /**
   * @name isLocked
   * @description checks to see if the purchase order has already run through a lock state
   * @return {boolean} - true if locked
   */
  isLocked() {
    return !!this.po.locked;
  }

  /**
   * @name lock
   * @description sets the locked param to true
   */
  lock() {
    this.po.fullfilment_date = TimeUtils.isoFormattedDate(now_);
    this.po.locked = true;
  }

  /**
   * @name param
   *
   * @description wrapper for returning the log params with the name
   *
   * @param {string} name
   * @returns {string} this log name from the logparams
   */
  param(name) {
    return this.logParams(name);
  }

  /**
   * @name applyReturns
   * @description manages any returned items and stores them
   *  to cached data
   */
  applyReturns() {
    if (this.returns) {
      return;
    }
    this.returns = {};
    const return_details = this.getMetaAttr('return_details') || {};
    const return_requested = this.getMetaAttr('return_requested');
    if (return_requested) {
      this.replacement = return_details.replacement;
      const returnedItems = return_details.items || [];
      for (let i = 0; i < returnedItems.length; i++) {
        const item = returnedItems[i];
        const id = this.model.getId(item);
        if (!this.returns[id]) {
          this.returns[id] = 0;
        }
        this.returns[id] += item.quantity || 0;
        this.totalReturn += this.returns[id];
      }
    }
  }

  /**
   * @name intializeValueParam
   * @description sets the start vakue for the node
   * @param {NodeInstance} node
   */
  intializeValueParam(node) {
    node[this.param(this.qIn)] = node[this.param(this.qIn)] || 0;
    node[this.param(this.quant)] = node[this.param(this.quant)] || 0;
  }

  /**
   * @name checkForReplacement
   * @description looks for replacement returns. If they exist, it stores the
   *    it in the replacements array
   * @param {nodeinstance} node
   */
  checkForReplacement(node) {
    if (!this.replacement && this.returns[node.id]) {
      const replacement_quanity = this.returns[node.id] || 0;
      node[this.param(this.qIn)] -= replacement_quanity;
    } else if (this.replacement && this.returns[node.id]) {
      this.replacementNodes.push(node);
    }
  }

  /**
   * @name buildNewSerialCacheItem
   * @description returns the serial cache for new items
   * @param {string} key
   * @param {nodeinstance} recepitNode
   * @param {nodeschema} serialSchema
   * @returns {serializedcache} serials applied to the item
   */
  buildNewSerialCacheItem(key, recepitNode, serialSchema) {
    return buildNewSerialCacheItem(
      key,
      recepitNode,
      serialSchema,
      this.schema,
      this.po
    );
  }

  async ensureNodesAreCorrectlyIdentified(serialSchema) {
    const sId = this.model.getId(serialSchema);
    for (const sku in this.serialHold[sId].skus) {
      const elements = this.serialHold[sId].skus[sku];
      if (elements.nodes.length) {
        continue;
      }
      const nodes = await share.findNodeWithSku(sku, serialSchema);
      if (!nodes.length) {
        continue;
      }
      elements.nodes.push(...nodes.map(n => this.model.getId(n)));
    }
  }

  /**
   * @name addSerialItemsToSkus
   * @description it paramatized the serialized items for later reference
   * @param {string[]} serials
   * @param {nodeschema} serialSchema
   */
  async addSerialItemsToSkus(serials, serialSchema) {
    const sId = this.model.getId(serialSchema);
    for (let j = 0; j < _.size(serials); j++) {
      const _s = serials[j];
      this.serialHold[sId].skus[_s] = this.serialHold[sId].skus[_s] || {
        count: 0,
        nodes: []
      };
      this.serialHold[sId].skus[_s].count++;
    }
    await this.ensureNodesAreCorrectlyIdentified(serialSchema);
  }

  /**
   * @name setSerialParam
   * @description sets the serialHold cache based on the id
   * @param {string} key
   * @param {nodeinstance} recepitNode
   * @param {nodeschema} serialSchema
   */
  async setSerialParam(key, recepitNode, serialSchema) {
    const sId = this.model.getId(serialSchema);
    this.serialHold[sId] =
      this.serialHold[sId] ||
      this.buildNewSerialCacheItem(key, recepitNode, serialSchema);
  }

  /**
   * @name chechSerialsAgainstNode
   * @description checks the serials entered vs the serials sent
   * @param {nodeinstance} node
   */
  async chechSerialsAgainstNode(node) {
    const serials = this.trackingReceiptSerials[node.id];
    for (const key in this.serializer) {
      const serialSchema = this.serializer[key].schema || { schema: [] };
      await this.setSerialParam(key, node, serialSchema);
      await this.addSerialItemsToSkus(serials, serialSchema);
      this.serialHold[serialSchema.id].owned_by_node = node.id;
    }
  }

  /**
   * @name setNodeQuantityForRecipt
   * @description set the quantity received for the purchase order
   * @param {*} node
   * @returns
   */
  async setNodeQuantityForRecipt(node) {
    const quantity = this.trackingReceiptItems[node.id] || 0;
    if (!quantity) {
      return;
    }

    StockNotification.evaluate(node, this.schema, quantity);
    node[this.param(this.qIn)] -= quantity;
    node[this.param(this.quant)] += quantity;
    await this.chechSerialsAgainstNode(node);
    await share.saveNode(node, this.schema);
  }

  /**
   * @name applySerializer
   * @description puts the serialized object into the instance
   *   params
   */
  async applySerializer() {
    if (this.serializer) {
      return;
    }
    this.serializer = await PosTransaction.setSerialiser(this.schema);
  }

  /**
   * @name manageReplacements
   * @description wrapper for creating replacement purchase orders
   */
  async manageReplacements() {
    if (!Object.keys(this.returns).length) {
      return;
    }

    const return_details = this.getMetaAttr('return_details');
    const returnedItems = return_details.items || [];
    // getReplacementTemplate
    const returnPO = await getReplacementTemplate(
      this.po,
      this.totalReturn,
      returnedItems
    );
    try {
      const created = await this.model.create(returnPO);
      const childPo = await this.model
        .findOne({ id: this.model.getId(created) })
        .populateAll();
      // await this.calculateShipping(child_po, this.replacementNodes, this.schema);
      await share.blastChange(childPo, childPo, 'created');
    } catch (e) {
      sails.log.error(e);
    }
  }

  /**
   * @name buildSerialsItemChanges
   * @descriptin let's make sure we update the counts for our serials
   * @param {any[]} serials
   */
  async buildSerialsItemChanges(serials = []) {
    for (let i = 0; i < serials.length; i++) {
      const serial = serials[i];
      await NodeSerial.setCountOnItemChange(serial);
    }
  }

  /**
   * @name iterateReceiptItemNodes
   * @description moves through all the items received and
   * ensures they are moved
   */
  async iterateReceiptItemNodes() {
    const nodes = await this.getItemNodes();
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      this.intializeValueParam(node);
      this.checkForReplacement(node);
      await this.setNodeQuantityForRecipt(node);
    }
    const serials = await manageSerials(this.serialHold);
    await this.buildSerialsItemChanges(serials);
    //  await this.moveAssetItemToNewStation();
    await this.manageReplacements();
  }

  /**
   * @name buildCompleteItemsSerializer
   * @param {boolean} noRebuild - flag to make sure that
   *  we don't pull our inventory items again. Used when wrapped
   *  in other functions
   */
  async buildCompleteItemsSerializer(noRebuild = false) {
    if (!noRebuild) {
      await this.loadMyNodeCache();
    }
    await this.loadMyLogParams();
    await this.applySerializer();
    this.setTrackingReceiptItems();
    await this.iterateReceiptItemNodes();
  }

  /**
   * @name finalizeMoveCompleteExternal
   * @param {boolean} noRebuild - flag to make sure that
   *  we don't pull our inventory items again. Used when wrapped
   *  in other functions
   * @returns  {Promise<purchaseorder>}
   */
  async finalizeMoveCompleteExternal(noRebuild) {
    if (!noRebuild) {
      await this.rebuildSelf();
      await this.loadMySchema();
    }
    this.applyReturns();
    await this.buildCompleteItemsSerializer(noRebuild);
    if (!noRebuild) {
      return this.save();
    }
  }

  /**
   * @name completeStateExternal
   * @description manages the inventory for the external complete state
   * @returns Promise<PurchaseOrderInstance>
   */
  async completeStateExternal(noRebuild = true) {
    if (!noRebuild) {
      await this.rebuildSelf();
    }

    if (this.isLocked()) {
      return;
    }

    await this.loadMySchema();
    await this.loadMyNodeCache();
    await this.LoadMySite();
    // await this.moveCompleteExternal();
    await this.finalizeMoveCompleteExternal(noRebuild);
    await this.applyCostElements();
    this.setMetaAttr('completed_on', TimeUtils.isoFormattedDate(now_));
    this.lock();
    await this.savePoWithState(poStates().RECEIVED, {
      text: 'info.SUCCESSFULLY_COMPLETED_PO_REQUEST',
      category: 'success'
    });
  }

  /**
   * @name completeState
   * @description manages the inventory for the internal complete state
   * @returns Promise<PurchaseOrderInstance>
   */
  async completeState() {
    await this.rebuildSelf();
    // keeps the inventory from locking
    if (this.isLocked()) {
      return;
    }

    if (this.isExternal()) {
      return this.completeStateExternal(true);
    }
    // now we lock the purchase order item so this cannot be run twice
    await this.caclutateReceiptCosts();
    await this.moveCompleteInternal();
    await this.applyVariancesToInternal();
    await this.invoice(this.receiptCosts.cost);

    this.setMetaAttr('completed_on', TimeUtils.isoFormattedDate(now_));
    this.lock();

    return this.savePoWithState(poStates().RECEIVED, {
      text: 'info.SUCCESSFULLY_COMPLETED_PO_REQUEST',
      category: 'success'
    });
  }

  /**
   * Causes issue when running asynchronously
   * @deprecated
   */
  async moveCompleteExternal() {
    if (Site.isInTestMode()) {
      await this.finalizeMoveCompleteExternal(true);
    } else {
      Jobs.purchaseorderMoveCompleteExternal.add({
        po: this.po
      });
    }
  }

  /**
   * @name setTrackingReceiptItems
   * @description iterates the items that we received in
   *   and external purchase order
   */
  setTrackingReceiptItems() {
    if (this.trackingReceiptItems) {
      return;
    }
    const counted_items = this.getMetaAttr('trackingReceipt');
    this.trackingReceiptItems = {};
    this.trackingReceiptSerials = {};
    for (const key in counted_items) {
      const c = counted_items[key];
      const items = c.counted_items;
      iterateItemCountsToCacheWithSerials(
        items,
        this.trackingReceiptItems,
        this.trackingReceiptSerials
      );
    }
  }

  /**
   * @name domainCode
   * @description gets the domain costcode id
   * @returns {string} - the domain id for costcoding
   */
  async getDomainCode() {
    await this.loadMySchema();
    return Domain.costcodeName(this.schema.domain);
  }

  /**
   * @name buildCostItemForNode
   * @description converts the items into costs
   * @param {nodeinstance} node
   * @param {string} currency
   * @returns {Promise<number>} the cost amount
   */
  async buildCostItemForNode(node, currency) {
    const id = this.model.getId(node);
    const item = this.getItemFromMap(node);
    const quantity = this.trackingReceiptItems[id] || 0;
    const cost = item.invoice_cost || 0;
    const parsedCost = CostCode.convertCurrency(cost, currency);
    await ensureRetailCostIsCorrect(
      node,
      cost,
      parsedCost,
      this.schema,
      this.site
    );
    const total = parsedCost * quantity;
    return total;
  }

  /**
   * @name applyCostElements
   * @description calculates the total cost for the purchase order and applies
   *  it to the meta data of the purchase order
   * @returns {Promise<void>}
   */
  async applyCostElements() {
    // we want fresh nodes when saving these details
    this.nodeCache = null;
    this.setTrackingReceiptItems();
    const allCosts = getAllCompleteCostConvertedElements(this.po, this.site);
    const taxes = allCosts.taxes;
    const service = allCosts.service;
    const customs = allCosts.customs;
    const additional = allCosts.additional;

    const costs = {
      total: 0,
      items: {}
    };
    const nodes = await this.getItemNodes();
    for (let i = 0; i < _.size(nodes); i++) {
      const node = nodes[i];
      const id = this.model.getId(node);
      const total = await this.buildCostItemForNode(node, allCosts.currency);
      if (!costs.items[id]) {
        costs.items[id] = 0;
      }
      costs.items[id] += total;
      costs.total += total;
    }

    const totalCosts = costs.total + taxes + service + customs + additional;
    const domainCode = await this.getDomainCode();
    await this.invoice(totalCosts, domainCode);
    this.setMetaAttr('final_cost', totalCosts);
    this.setMetaAttr('final_cost_details', costs);
  }

  /**
   * @name buildVariantItemsForCompleteInternal
   * @desciption looks for variance in the purchase order
   * @returns {Promise<internalReceiptVariance>}
   */
  buildVariantItemsForCompleteInternal() {
    this.buildReceipt();
    return internalReceiptVariance(this.receipt);
  }

  /**
   * @name applyVariantsToCompleteInternal
   * @desciption iterates the received items searching for variances
   * @returns {Promise<variances[]>}
   */
  async applyVariantsToCompleteInternal() {
    const variants = this.buildVariantItemsForCompleteInternal();
    const variantsItems = processVariants(variants, this.receipt);
    await this.caclutateReceiptCosts();

    const variances = [];
    if (variantsItems.length) {
      const _variances = await calculateCostAndApplyVariants(
        variantsItems,
        this.po,
        this.receiptCosts
      );
      variances.push(..._variances);
    }
    return variances;
  }

  /**
   * @name processInvoiceToCostCode
   * @desciption sends the invoice to a certain costcode
   * @param {number} amount
   * @param {station} to
   */
  async processInvoiceToCostCode(amount = 0, to = null) {
    await this.loadMySchema();
    to = to || this.po.from;
    const currency = await this.loadMyCurrency();
    const domain = this.schema.domain;
    const from = this.po.to;
    processInvoiceToCostCode(amount, currency, domain, from, to);
  }

  /**
   * @name invoice
   * @desciption wrapper to send invoice details to a costcode
   * @param {number} amount
   * @param {station} to
   */
  async invoice(amount, to = null) {
    if (Site.isInTestMode()) {
      await this.processInvoiceToCostCode(amount, to);
    } else {
      Jobs.purchaseorderInvoice.add({
        po: this.po,
        cost: amount,
        to: to
      });
    }
  }

  /**
   * @name buildSerials
   * @description instance wrapper for the building the
   *   serial items
   * @param {string} serial
   * @param {serialId} id
   * @param {nodeschema} recepitNode
   * @returns {Promise<buildSerials>}
   */
  buildSerials(serial, id, recepitNode) {
    return buildSerials(serial, id, this.po, this.schema, recepitNode);
  }

  /**
   * @name shiftQuantity
   * @description changes the quantity value of the node
   * @param {nodeinstance} node
   * @param {number} outInQuantity
   * @param {number} inQuantity
   * @param {boolean} inQuant - toogles if in or out param is selected
   */
  shiftQuantity(node = {}, outInQuantity = 0, inQuantity = 0, inQuant = false) {
    node[this.param(inQuant ? this.qIn : this.qOut)] -= outInQuantity;
    node[this.param(this.quant)] += inQuantity;
  }

  /**
   * @name changeNodeQuantities
   * @description changes the values of incoming out outgoing inventory
   * @param {nodeinstance} fromNode
   * @param {nodeinstance} recepitNode
   * @param {any} shippedItem
   * @param {any} item
   */
  changeNodeQuantities(fromNode, recepitNode, shippedItem, item) {
    const delta = shippedItem.quantity - item.quantity || 0;
    this.shiftQuantity(fromNode, shippedItem.quantity, delta);
    this.shiftQuantity(recepitNode, shippedItem.quantity, item.quantity, true);
  }

  /**
   * @name replaceAssetParentStation
   * @descrpition when moving an asset station, we need to change
   *  the parent station from the sending party to the receiving
   *  party
   * @param {stationassset} stationasset
   * @returns {{Promise<stationasset>}}
   */
  async replaceAssetParentStation(stationasset = {}) {
    const fromStation = this.stationsMap[this.po.from];
    const toStation = this.stationsMap[this.po.to];
    const assetId = this.model.getId(stationasset.asset);
    const station = await Station.findOneById(assetId);
    if (!station) {
      throw new Error('Station Asset Not Found with ID', assetId);
    }
    station.parents = station.parents || [];
    _.remove(
      station.parents,
      parent => parent === this.model.getId(fromStation)
    );

    station.parents.push(this.model.getId(toStation));
    return Station.saveAsync(station);
  }

  /**
   * @name moveAssetItemToNewStation
   * @description moves an asset item to a new station
   * @param {nodeserial} serial
   * @returns {Promise<stationasset>}
   */
  async moveAssetItemToNewStation(serial) {
    if (!serial.station_asset) {
      return;
    }
    const asset = await StationAsset.findOneById(
      this.model.getId(serial.station_asset)
    );

    const station = this.stationsMap[this.po.to];
    asset.station = this.model.getId(station);
    await this.replaceAssetParentStation(asset);
    // asset.serial_bind = this.model.getId(serial);
    return StationAsset.saveAsync(asset);
  }

  /**
   * @name generateIteratePriorItemsForAsssets
   * @description seeks the tracking receipt and tryies to find
   *  a stationasset
   * @param {number} schemaId
   * @param {nodeserial} serial
   */
  async generateIteratePriorItemsForAsssets(schemaId, serial) {
    const previousNodes = this.trackingReceiptSerials[schemaId] || [];
    for (let i = 0; i < previousNodes.length; i++) {
      const node = previousNodes[i];
      const item = this.getItemFromMap(node);
      const fromNode = await this.getNodeFromMap(item);
      await this.moveAssetItemToNewStation(fromNode, serial);
    }
  }

  /**
   * @name generateNewSerializedAsset
   * @description wrapper for seeking station assets
   * @param {Promise<nodeserial[]>} serials
   */
  async generateNewSerializedAsset(serials = []) {
    for (let i = 0; i < serials.length; i++) {
      const serial = serials[i];
      const stationAsset = await this.moveAssetItemToNewStation(serial);
      const saId = this.model.getId(stationAsset);
      if (!saId) {
        continue;
      }

      this.appendToMeta('stationAssetChanges', {
        [this.model.getId(serial)]: saId
      });
    }
  }

  /**
   * @name applyTrackingReceiptToSerials
   * @description places the serials in an instance variable for
   *  with the associated params to for quicker access
   * @param {any} serials
   * @param {any} item
   */
  applyTrackingReceiptToSerials(serials = {}, item = {}) {
    for (const sId in serials) {
      this.trackingReceiptSerials[sId] = this.trackingReceiptSerials[sId] || [];
      this.trackingReceiptSerials[sId].push(this.model.getId(item));
    }
  }

  /**
   * @name moveCompletedInventory
   * @description wrapper for moving inventory on a complete state
   * @returns {Promise<void>}
   */
  async moveCompletedInventory() {
    this.buildReceipt();
    await this.loadMyLogParams();
    await this.loadMyStationMap();
    this.trackingReceiptSerials = {};
    const station = this.stationsMap[this.po.to];
    for (const id in this.receipt.countedItems) {
      const item = this.getItemFromMap(id);
      const fromNode = await this.getNodeFromMap(item);
      const shippedItem = this.receipt.items[id];
      const recepitNode = await share.findNodeWithSkuForStation(
        item.sku,
        this.schema,
        station
      );
      try {
        StockNotification.evaluate(recepitNode, this.schema, item.quantity);
      } catch (e) {
        sails.log.error(e);
      }
      this.changeNodeQuantities(fromNode, recepitNode, shippedItem, item);
      const serial = this.receipt.serials[item.id];
      const serials = await this.buildSerials(serial, id, recepitNode);
      this.applyTrackingReceiptToSerials(serials, item);
      Object.assign(this.serialHold, serials);

      try {
        await share.saveNode(recepitNode, this.schema);
        await share.saveNode(fromNode, this.schema, this.site);
      } catch (e) {
        sails.log.error(e);
      }
    }
  }

  /**
   * @name moveComplete
   * @description finalizes the inventory movements for
   *  an internal purcase order
   * @param {boolean} noRebuild - if called by external function
   *   we can make sure we don't redo the work already done, by calling fuction
   * @returns {Promise<nodeserials>}
   */
  async moveComplete(noRebuild = false) {
    if (!noRebuild) {
      await this.rebuildSelf();
    }
    await this.LoadMySite();

    try {
      await this.moveCompletedInventory();
      const serials = await manageSerials(this.serialHold); // here
      await this.buildSerialsItemChanges(serials);
      await this.generateNewSerializedAsset(serials);
      return serials;
    } catch (e) {
      sails.log.error('PurchaseOrderPrivate.moveComplete', e);
      // now rollback
    }
  }

  /**
   * @name moveCompleteInternal
   * @description wrapper for environment testing
   *   in production move complete calls a job for async task
   */
  async moveCompleteInternal() {
    if (Site.isInTestMode()) {
      await this.moveComplete(true);
    } else {
      Jobs.purchaseorderMoveComplete.add({
        po: this.po
      });
    }
  }

  /**
   * @name applyVariancesToInternal
   * @description applies the variance values to the purchase order meta
   * @returns {Promise<void>}
   */
  async applyVariancesToInternal() {
    const variances = await this.applyVariantsToCompleteInternal();
    this.setMetaAttr('variances', variances);
  }

  /**
   * @name caclutateReceiptCosts
   * @description Caculates all of the total costs for the goods in a purchase order
   * @returns {Promise<void>}
   */
  async caclutateReceiptCosts() {
    if (this.receiptCosts) {
      return;
    }

    this.buildReceipt();
    await this.loadMyLogParams();

    const itemIds = Common.getIdArrayFromObjectCache(this.receipt.countedItems);
    if (!itemIds.length && Common.keyLength(this.receipt.items)) {
      itemIds.push(...Common.getIdArrayFromObjectCache(this.receipt.items));
    }

    const itemsCost = {};
    const currency = await this.loadMyCurrency();
    const nodeCache = await share.buildNodeCache(itemIds, this.schema);

    let cost = 0;
    for (let i = 0; i < itemIds.length; i++) {
      const id = itemIds[i];
      const node = nodeCache[id] || {};
      const unit_cost = node[this.param(this.uCost)] || 0;
      const convertedCost = CostCode.convertCurrency(unit_cost, currency);
      itemsCost[id] = {
        unit: unit_cost,
        converted: convertedCost
      };
    }

    for (const id in this.receipt.countedItems) {
      const item = this.receipt.countedItems[id];
      const cCost = itemsCost[id] || {};
      cost += cCost.converted * item.quantity;
    }

    this.receiptCosts = {
      currency: currency,
      nodes: Common.objectValuesToArray(nodeCache),
      cost: cost,
      converted_cost: CostCode.parseValue(cost, currency),
      nodeCache: nodeCache,
      itemsCost: itemsCost
    };
  }

  getPackageItemCache(trackedPackage = {}) {
    const items = trackedPackage.items || [];
    const cache = {};
    items.forEach(item => {
      cache[item.id] = item;
    });
    return cache;
  }

  /**
   * @name buildReceipt
   * @description adds the receit items to the instance attribute
   * @returns void
   */
  buildReceipt() {
    if (this.receipt) {
      return;
    }
    const serials = {};
    // const skus = [];
    const receipt = this.meta.receipt || {};
    const packaging = this.packageCache;
    const items = {};
    const countedItems = {};
    const backupSerials = {};
    for (const pack in receipt) {
      const r = receipt[pack];
      share.iterateItemsToCache(r.items, items, backupSerials);
      share.iterateItemsToCache(
        r.counted_items,
        countedItems,
        serials,
        this.getPackageItemCache(packaging[pack])
      );
    }
    // the user did not include the approprite keys
    if (!Common.keyLength(serials) && Common.keyLength(backupSerials)) {
      Object.assign(serials, backupSerials);
    }
    this.receipt = {
      items,
      countedItems,
      serials
    };
  }

  /**
   * @name pendingState
   * @description manages inventory for the pending state
   * @returns Promise<PurchaseOrderInstance>
   */
  async pendingState() {
    await this.rebuildSelf();
    if (!this.lastStateWas(poStates().PENDING)) {
      return;
    }
    await this.setItemCosts();

    if (Site.isInTestMode()) {
      await this.moveTemp();
    } else {
      Jobs.purchaseorderTempConvertInventory.add(this.po);
    }

    this.setLastState(poStates().APPROVED);
    this.setMetaAttr('approved_on', TimeUtils.isoFormattedDate(now_));
    await this.calculateShipping();
    // this.printMeta();;
    return this.savePoWithState(poStates().APPROVED);
  }

  /**
   * @name isInternal
   * @desciption checks to see if a po is internal
   * @returns boolean - true if interna;
   */
  isInternal() {
    return this.po.scope === 'internal';
  }

  /**
   * @name isExternal
   * @description checks to see if a po is external
   * @returns boolean - true if external
   */
  isExternal() {
    return this.po.scope === 'external';
  }

  /**
   * @name loadMyStationMap
   * @description puts the states for the purchase order in cache
   * @returns Promise<Void>
   */
  async loadMyStationMap() {
    if (this.stationsMap) {
      return;
    }
    this.stationsMap = await share.buildStationMap(this.po, this.isInternal());
  }

  /**
   * @name getItemNodes
   * @description pulls the items nodes in the items array
   * @returns Promise<NodeInstance[]>
   */
  async getItemNodes() {
    await this.loadMyNodeCache();
    const nodes = Common.objectValuesToArray(this.nodeCache);
    return nodes;
  }

  /**
   * @name temporarilyMoveNodeToExternalStation
   * @description moves the inventory for a node when enterning
   * pending state for external purchase Orders
   * @param {NodeInstance} node
   * @return {NodeInstance} the updated node
   */
  async temporarilyMoveNodeToExternalStation(node) {
    const item = this.getItemFromMap(node);
    const quantity = item.quantity;
    const qIn = this.param(this.qIn);
    node[qIn] = node[qIn] || 0;
    node[qIn] += quantity;
    return await share.saveNode(node, this.schema);
  }

  /**
   * @name temporarilyMoveNodeFromSendStation
   * @description moves the inventory from a station in pending state
   * @param {NodeInstance} node
   * @return {NodeInstance} the updated node
   */
  async temporarilyMoveNodeFromSendStation(node) {
    const item = this.getItemFromMap(node);
    const quantity = item.quantity;
    const qOut = this.param(this.qOut);
    const quat = this.param(this.quant);

    node[qOut] = node[qOut] || 0;
    // decrement quantiyt
    node[quat] -= quantity;
    // now set it outgoinf
    node[qOut] += quantity;
    // this the outgoing inventory
    return await share.saveNode(node, this.schema);
  }

  /**
   * @name temporarilyMoveNodeToRecevingStation
   * @description moves tempory nodes to the recieving state
   * @param {NodeInstance} node
   * @return {NodeInstance} the updated node
   */
  async temporarilyMoveNodeToRecevingStation(node) {
    const item = this.getItemFromMap(node);
    const quantity = item.quantity;
    const qIn = this.param(this.qIn);
    const qOut = this.param(this.qOut);
    const quat = this.param(this.quant);
    const toStation = this.model.getId(this.stationsMap[this.po.to]);

    let current = await share.findNodeWithSkuForStation(
      item.sku,
      this.schema,
      toStation
    );
    if (current) {
      current[qIn] = current[qIn] || 0;
      current[qIn] += quantity;
    } else {
      // create if don't have this node
      current = Node.clone(node, this.schema);
      current.station = toStation;
      current[quat] = 0;
      current[qOut] = 0;
      current[qIn] = 0;
      current[qIn] += quantity;
    }
    // this the incoming inventory
    return await share.saveNode(current, this.schema);
  }

  /**
   * @name calculateShipping
   * @description calculates the shipping volume and weight for a given purchase order
   * @returns Promise<Void>
   */
  async calculateShipping() {
    const dimensions = share.getInventoryDimensionParamters(this.schema);
    if (!dimensions.length) {
      return;
    }

    // just taking the first
    const dimension = dimensions[0];
    const weightUnit = dimension.default_weight_unit;
    const legthUnit = dimension.default_length_unit;

    const measurements = {
      length: 0,
      width: 0,
      height: 0,
      weight: 0,
      volume: 0,
      weight_unit: weightUnit,
      length_unit: legthUnit
    };
    const nodes = await this.getItemNodes();
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const item = this.getItemFromMap(node);
      const quantity = item.quantity || 0;
      const nodeDimensions = node[dimension.name] || {};
      const weight = nodeDimensions.weight || 0;
      const length = nodeDimensions.length || 0;
      const width = nodeDimensions.width || 0;
      const height = nodeDimensions.height || 0;
      measurements.length += length * quantity;
      measurements.width += width * quantity;
      measurements.height += height * quantity;
      measurements.weight += weight * quantity;
    }
    measurements.volume =
      measurements.length * measurements.width * measurements.height;
    this.setMetaAttr('measurements', measurements);
  }

  /**
   * @name moveTemp
   * @description moves the inventory when a purchase order
   * goes into a pending state
   */
  async moveTemp() {
    await this.rebuildSelf();
    await this.loadMyStationMap();
    await this.loadMyLogParams();
    const nodes = await this.getItemNodes();
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (this.isInternal()) {
        await this.temporarilyMoveNodeFromSendStation(node);
        // this the outgoing inventory
        await this.temporarilyMoveNodeToRecevingStation(node);
      } else {
        await this.temporarilyMoveNodeToExternalStation(node);
      }
    }
  }

  /**
   * @name appendToMeta
   * @description appends data to a meta object
   * @param {string} key
   * @param {Record<string,any>} obj
   */
  appendToMeta(key, obj = {}) {
    const metaObj = this.getMetaAttr(key) || {};
    const assigned = Object.assign(metaObj, obj);
    this.setMetaAttr(key, assigned);
  }

  /**
   * @name getMetaAttr
   * @description sets the value for a specfic meta param
   * @param {string} attr
   * @return {any} value
   */
  getMetaAttr(attr) {
    this.purchaseorder.meta = this.purchaseorder.meta || {};
    return this.purchaseorder.meta[attr];
  }

  /**
   * @name setMetaAttr
   * @description sets the value for a specfic meta param
   * @param {string} attr
   * @param {any} value
   */
  setMetaAttr(attr, value) {
    this.purchaseorder.meta = this.purchaseorder.meta || {};
    this.purchaseorder.meta[attr] = value;
  }

  /**
   * @name getThisSchema
   * @descriptin gets the nodeschema of the purchase order inventory
   * @returns Promise<NodeSchema>
   */
  getThisSchema() {
    return NodeSchema.findOneById(this.model.getId(this.po.schema));
  }

  /**
   * @name loadMySchema
   * @description sets the schema to the class variable
   * @returns Promise<NodeSchema>
   */
  async loadMySchema() {
    if (this.schema) {
      return;
    }
    const schema = await this.getThisSchema();
    this.schema = schema;
    return schema;
  }

  /**
   * @name loadMyLogParams
   * @description sets the internal log params or if
   * a schema is supplied, it will pull the logparams for
   * that specific schema. Used for
   * @param {NodeSchema} schema
   * @returns Promise<logParams>
   */
  async loadMyLogParams(schema) {
    // they are already set
    if (!schema && this.logParams) {
      return;
    } else if (!schema) {
      await this.loadMySchema();
    }

    const _schema = schema || this.schema;
    const helpers = Module._helpers.logistics();
    const logParams = helpers.logParams(_schema.schema);
    if (!schema) {
      this.logParams = logParams;
    }
    return logParams;
  }

  /**
   * @name loadMyNodeCache
   * Sets the cache for the pulled node params
   *
   * @returns Promise<Void>
   */
  async loadMyNodeCache() {
    if (this.nodeCache) {
      return;
    }
    const items = this.po.items;
    const itemIds = Common.returnItemIds(items);
    await this.loadMySchema();
    this.nodeCache = await share.buildNodeCache(itemIds, this.schema);
  }

  /**
   * @name loadMyDomain
   * @description sets the domain parameter in the instance
   * @returns Promise<Void>
   */
  async loadMyDomain() {
    if (this.domain) {
      return;
    }
    const schema = this.schema || (await this.getThisSchema());
    if (!schema.domain) {
      this.domain = -1;
    } else {
      this.domain = await Domain.findOneById(this.model.getId(schema.domain));
    }
  }

  /**
   * @name getMyDomain
   * @description returns the domain id or numm
   * @returns Promise<number|null>
   */
  async getMyDomain() {
    await this.loadMyDomain();
    if (this.domain === -1) {
      return null;
    }
    return this.domain;
  }

  /**
   * @name loadMySite
   * @description sets the site instance attribute
   * @returns Promise<void>
   */
  async LoadMySite() {
    if (this.site) {
      return;
    }
    const domain = await this.getMyDomain();
    this.site = await Site.thisSiteAsync(domain);
  }

  /**
   * @name loadMyCurrency
   * @description loads the sites currency
   * @returns Promise<void>
   */
  async loadMyCurrency() {
    await this.LoadMySite();
    return this.site.currency || Const.DEFAULT_CURRENCY;
  }

  /**
   * @name setItemCosts
   * @description applies the estimated cost array to the meta parameters
   * @returns {Promise<void>}
   */
  async setItemCosts() {
    await this.loadMyNodeCache();
    await this.loadMyLogParams();

    const nodes = Common.objectValuesToArray(this.nodeCache);
    const items_costs = [];
    for (let i = 0; i < _.size(nodes); i++) {
      const node = nodes[i];
      items_costs.push({
        sku: node[this.param('sku')],
        retail_cost: node[this.param('retail_cost')] || 0,
        purchase_cost: node[this.param('unit_cost')] || 0
      });
    }
    this.setMetaAttr('items_costs', items_costs);
  }

  /**
   * @name isFrom
   * @description is the station_id for the from station
   * @param {string} stationId
   * @returns {boolean}
   */
  isFrom(stationId) {
    return stationId === this.from;
  }

  /**
   * @name isTo
   * @description is the station_id for the to station
   * @param {string} stationId
   * @returns {boolean}
   */
  isTo(stationId) {
    return stationId === this.to;
  }

  /**
   * @name alterNodeParamsForReturn
   * @description changes the quantity for a returned node
   * @param {node} node
   * @param {number} quantity
   * @param {boolean} isFrom
   */
  alterNodeParamsForReturn(node, quantity, isFrom = false) {
    if (isFrom) {
      node[this.param(this.qOut)] -= quantity;
      node[this.param(this.quant)] += quantity;
    } else {
      node[this.param(this.qIn)] -= quantity;
    }
  }

  /**
   * @name restoreSerialsForReturn
   * @description restores the serials to the orginal node
   * @param {number} nId
   * @param {node} restoreNode
   */
  async restoreSerialsForReturn(nId, restoreNode) {
    const serial = this.serialReferences[nId];
    const serialCache = await this.buildSerials(serial, nId, restoreNode);
    await manageSerials(serialCache);
  }

  /**
   * @name filterPotentialItemsAgainToStation
   * @description filters and array of potential nodes and returns the correct one
   * @param {object[]} potentials
   * @param {object} item
   * @returns
   */
  filterPotentialItemsAgainToStation(potentials, item) {
    const nId = this.model.getId(item);
    const node = this.nodeCache[nId];
    for (let j = 0; j < _.size(potentials); j++) {
      const potential = potentials[j];
      if (
        (potential.copy_of === nId && !node.copy_of) ||
        (potential.copy_of === node.copy_of && node.copy_of) ||
        (node.copy_of === potential.id && !potential.copy_of)
      ) {
        return potential;
      }
    }
    return null;
  }

  /**
   * @name findPotentailItemsForStation
   * @description finds the node related to the to station
   * @param {object} item
   * @param {string} stationId
   * @returns {node}
   */
  async findPotentailItemsForStation(item, stationId) {
    const station = this.stationsMap[stationId];
    const sId = this.model.getId(station);
    const potentials = await Node.findNodes(
      {
        where: {
          station: sId,
          __available__: true,
          [this.param(this.skuP)]: item.sku
        }
      },
      this.schema
    );
    return this.filterPotentialItemsAgainToStation(potentials, item);
  }

  /**
   * @name managerItemReturnForToStation
   * @description manages return for the to or receiving station
   * @param {object} item
   * @param {string} stationId
   * @returns {Promise<void>}
   */

  async managerItemReturnForToStation(item, stationId) {
    const quantity = item.quantity;
    const nId = this.model.getId(item);
    const node = this.nodeCache[nId];
    if (this.isExternal()) {
      return this.alterNodeParamsForReturn(node, quantity);
    }
    const stationNode = await this.findPotentailItemsForStation(
      item,
      stationId
    );
    if (stationNode) {
      this.alterNodeParamsForReturn(stationNode, quantity);
      await share.saveNode(stationNode, this.schema);
    }
  }

  /**
   * @name iterateStationsForDeletion
   * @description checks each station involved to
   * restore the inventory back to it's correct state
   */
  async iterateStationsForDeletion() {
    this.buildSerialReferences();
    for (const stationId in this.stationsMap) {
      for (let i = 0; i < this.items.length; i++) {
        const item = this.items[i];
        const quantity = item.quantity;
        const nId = this.model.getId(item);
        const node = this.nodeCache[nId];
        if (this.isFrom(stationId)) {
          this.alterNodeParamsForReturn(node, quantity, true);
          await this.restoreSerialsForReturn(nId, node);
          await share.saveNode(node, this.schema);
        } else if (this.isTo(stationId)) {
          await this.managerItemReturnForToStation(item, stationId);
        }
      }
    }
  }

  /**
   * @name moveRevert
   *
   * @description called when a purchase order is being deleted
   */
  async moveRevert() {
    await this.rebuildSelf();
    await this.loadMyNodeCache();
    await this.loadMyLogParams();
    await this.loadMyStationMap();
    await this.iterateStationsForDeletion();
  }
}

module.exports = { PurchaseOrderPrivates };
