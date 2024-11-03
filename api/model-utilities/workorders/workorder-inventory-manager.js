const {
  WorkOrderStateChangeManager
} = require('./workorder-state-change-manager');
const { SqlUtils } = require('similie-api-services');
const { WOModes } = require('./workorder-states');

const {
  saveNode,
  findNodeWithSkuForStation
} = require('../purchase-orders/purchase-order-shared');
const SailsExtensions = require('../../services/SailsExtensions');

class WorkOrderInventoryManager extends WorkOrderStateChangeManager {
  _nodeSchemas = {};
  constructor(wo, toState, user) {
    super(wo, toState, user);
  }

  get pQuantity() {
    return 'quantity';
  }

  get pQIn() {
    return 'quantity_incoming';
  }

  get pQOut() {
    return 'quantity_outgoing';
  }

  get mode() {
    return this.wo.mode;
  }

  get items() {
    return this.wo.items || [];
  }

  itemParams(nodeschema = {}) {
    const helpers = Module._helpers.logistics();
    return helpers.logParams(nodeschema.schema);
  }

  async getItemNode(item) {
    const itemSchema = await this.pullItemSchema(item);
    return Node.findOneById(this.getId(item), itemSchema);
  }

  async pullItemSchema(item = {}) {
    const schemaId = item.schema;
    if (this._nodeSchemas[schemaId]) {
      return this._nodeSchemas[schemaId];
    }

    this._nodeSchemas[schemaId] = await NodeSchema.findOneById(schemaId);
    return this._nodeSchemas[schemaId];
  }

  async cleanNodeForServiceStation(node = {}, nodeschema = {}) {
    const params = this.itemParams(nodeschema);
    const serviceStation = await this.toStation();
    node[params(this.pQuantity)] = 0;
    node[params(this.pQIn)] = 0;
    node[params(this.pQOut)] = 0;
    node.station = this.getId(serviceStation);
  }

  async getNodeForServiceStation(item = {}) {
    const serviceStation = await this.toStation();
    const itemSchema = await this.pullItemSchema(item);
    const toItem = await findNodeWithSkuForStation(
      item.sku,
      itemSchema,
      serviceStation
    );
    if (toItem) {
      return toItem;
    }

    const node = await this.getItemNode(item);
    const clone = Node.clone(node, itemSchema);
    await this.cleanNodeForServiceStation(clone, itemSchema);
    return clone;
  }

  getItemsSerialCount(item = {}) {
    const serials = item.serials || [];
    return serials.length;
  }

  zeroOutNegativeParams(node, paramName) {
    node[paramName] = node[paramName] || 0;
    if (node[paramName] < 0) {
      node[paramName] = 0;
    }
  }

  buildParamsForQuantitySetup(node, nodeschema = {}) {
    const params = this.itemParams(nodeschema);
    node[params(this.pQuantity)] = node[params(this.pQuantity)] || 0;
    node[params(this.pQOut)] = node[params(this.pQOut)] || 0;
    node[params(this.pQIn)] = node[params(this.pQIn)] || 0;
    return params;
  }

  sendItemQuantityToOutgoing(quantity = 1, node = {}, nodeschema = {}) {
    const params = this.buildParamsForQuantitySetup(node, nodeschema);
    node[params(this.pQuantity)] -= quantity;
    this.zeroOutNegativeParams(node, params(this.pQuantity));
    node[params(this.pQOut)] += quantity;
  }

  closeItemQuantityFromOutgoing(quantity = 1, node = {}, nodeschema = {}) {
    const params = this.buildParamsForQuantitySetup(node, nodeschema);
    node[params(this.pQuantity)] += quantity;
    node[params(this.pQOut)] -= quantity;
    this.zeroOutNegativeParams(node, params(this.pQOut));
  }

  sendItemQuantityToIncoming(quantity = 1, node = {}, nodeschema = {}) {
    const params = this.buildParamsForQuantitySetup(node, nodeschema);
    node[params(this.pQIn)] += quantity;
  }

  closeItemQuantityFromIncoming(quantity = 1, node = {}, nodeschema = {}) {
    const params = this.buildParamsForQuantitySetup(node, nodeschema);
    node[params(this.pQIn)] -= quantity;
    this.zeroOutNegativeParams(node, params(this.pQIn));
  }

  async placeItemToIncomming(item = {}, close = false) {
    const size = this.getItemsSerialCount(item);
    if (!size) {
      return;
    }
    const toItem = await this.getNodeForServiceStation(item);
    const itemSchema = await this.pullItemSchema(item);

    if (close) {
      this.closeItemQuantityFromIncoming(size, toItem, itemSchema);
    } else {
      this.sendItemQuantityToIncoming(size, toItem, itemSchema);
    }

    return saveNode(toItem, itemSchema);
  }

  async placeItemToOutgoing(item = {}, close = false) {
    const size = this.getItemsSerialCount(item);
    if (!size) {
      return;
    }
    const itemSchema = await this.pullItemSchema(item);
    const node = await this.getItemNode(item);
    if (close) {
      this.closeItemQuantityFromOutgoing(size, node, itemSchema);
    } else {
      this.sendItemQuantityToOutgoing(size, node, itemSchema);
    }
    await saveNode(node, itemSchema);
  }

  async setSerialsToLockedState(serialIds = [], locked = true) {
    const escape = SqlUtils.escapeUtil();
    const VALUE = locked ? 'TRUE' : 'FALSE';
    const query = escape(
      `UPDATE "nodeserial" SET "locked" = %s WHERE "id" %s`,
      VALUE,
      SqlUtils.setInString(serialIds)
    );
    await this.sqlQuery(query);
  }

  async iterateSeriaContent(item = {}, cb) {
    const serialHold = {};
    for (const sku in item.serial_content) {
      const serial = item.serial_content[sku];
      const bindId = serial.serial_bind;
      if (serialHold[bindId]) {
        continue;
      }
      serialHold[bindId] = true;
      await cb(serial, sku);
    }
  }

  async lockNodeSerials(item = {}, locked = true) {
    const serialIds = [];
    await this.iterateSeriaContent(item, serial => {
      const bindId = serial.serial_bind;
      serialIds.push(bindId);
    });
    await this.setSerialsToLockedState(serialIds, locked);
  }

  async getBoundNodeSerial(serial) {
    const bindId = serial.serial_bind;
    return NodeSerial.findOneById(bindId);
  }

  async cloneSerialsToSeriviceStation(item = {}, serviceNode = {}) {
    const serviceNodeID = this.getId(serviceNode);
    const assetValues = [];
    await this.iterateSeriaContent(item, async serial => {
      const bindId = serial.serial_bind;
      const nodeSerial = await this.getBoundNodeSerial(serial);
      if (!nodeSerial) {
        return;
      }
      const stationAsset = nodeSerial.station_asset || null;
      const clonedSerial = SailsExtensions.cloneModel(nodeSerial);
      clonedSerial.owned_by_node = serviceNodeID;
      const bridgeSerial = await NodeSerial.create(clonedSerial);
      const metaValues = {
        nodeserial: bindId,
        stationasset: stationAsset,
        bridgeserial: this.getId(bridgeSerial)
      };
      assetValues.push(metaValues);
    });
    return assetValues;
  }

  async placeValuesIntoServiceState(metaValues = [], maintenance = true) {
    const stationAssets = metaValues
      .map(mv => mv.stationasset)
      .filter(st => st !== null);

    await StationAsset.update(
      { id: stationAssets },
      { maintenance: maintenance }
    );
    await StationAsset.setAssetsIntoMantenanceModel(stationAssets, maintenance);
  }

  saveItems() {
    return WorkOrder.update({ id: this.getId(this.wo) }, { items: this.items });
  }

  saveValues(values = {}) {
    return WorkOrder.update({ id: this.getId(this.wo) }, values);
  }

  /**
   * @description we simply need to lock the nodeSerials
   *  and update the station assets into maintenance
   */
  async setAssetsIntoMaintenance(close = false) {
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      await this.lockNodeSerials(item, !close);
      item.metaValues = [];
      await this.iterateSeriaContent(item, async serial => {
        const bindId = serial.serial_bind;
        const nodeSerial = await this.getBoundNodeSerial(serial);
        const stationAsset = nodeSerial.station_asset || null;
        item.metaValues.push({
          nodeserial: bindId,
          stationasset: stationAsset
        });
      });
      await this.placeValuesIntoServiceState(item.metaValues, !close);
    }
    await this.saveItems();
  }

  async destroyBridge(item) {
    const metaValues = item.metaValues || [];
    const bridges = metaValues
      .map(mv => this.getId(mv.bridgeserial))
      .filter(mv => mv != null);
    if (!bridges.length) {
      return metaValues;
    }
    await NodeSerial.destroy({ id: bridges });
    return metaValues;
  }

  /**
   * @description Rules for maintenance approvals.
   * * If they are the same station, make no inventory changes
   * * Move the inventory to outgoing the to station.
   * * The item because an incomming item for the service station
   * * We lock the nodeserial and assign a clone to the maintenance station
   * * If there is a station asset we place it into maintenance,
   *    we also assign the asset to the also to the cloned serial
   * * Place the station asset in mantenance if available
   * * Place work fragments into the meta to facilitate rollback
   */
  async mainenceModeApproval(close = false) {
    const serviceStation = await this.toStation();
    const assetStation = await this.fromStation();
    if (this.getId(serviceStation) === this.getId(assetStation)) {
      return this.setAssetsIntoMaintenance(close);
    }

    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      await this.placeItemToOutgoing(item, close);
      await this.lockNodeSerials(item, !close);
      const seriviceNode = await this.placeItemToIncomming(item, close);
      const metaValues =
        close && item.metaValues
          ? await this.destroyBridge(item)
          : await this.cloneSerialsToSeriviceStation(item, seriviceNode);

      if (!close) {
        item.metaValues = metaValues;
      }
      await this.placeValuesIntoServiceState(item.metaValues, !close);
    }
    await this.saveItems();
  }

  async byproductModelApproval(close = false) {
    // @todo
  }

  executeApproval(close = false) {
    if (this.mode === WOModes.BYPRODUCT) {
      return this.byproductModelApproval(close);
    }
    // default opperation
    return this.mainenceModeApproval(close);
  }

  async close() {
    return this.executeApproval(true);
  }
}

module.exports = { WorkOrderInventoryManager };
