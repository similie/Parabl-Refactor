/**
 * buildStationMap
 *
 * Pulls the stations from the purchase order
 *
 * @param {PurchaseOrderInstance} po
 * @param {boolean} internal - if it is an internal purchase order
 */
async function buildStationMap(po, internal = false) {
  const stationsMap = {};
  const find = [po.from];
  if (internal) {
    find.push(po.to);
  }
  const stations = await Station.find({
    where: { station_id: find }
  });
  for (let i = 0; i < stations.length; i++) {
    const s = stations[i];
    stationsMap[s.station_id] = s;
  }
  return stationsMap;
}

/**
 * buildNodeCache
 *
 * Pulls the nodes form the database and wraps
 * then in an ID object
 *
 * @param {number[]} ids
 * @param {NodeSchema} schema
 * @returns
 */
async function buildNodeCache(ids = [], schema) {
  const nodeCache = {};
  if (!ids.length) {
    return nodeCache;
  }
  const nodes = await Node.findNodes(
    {
      where: {
        id: ids,
        __available__: true
      }
    },
    schema
  );
  _.each(nodes, n => {
    nodeCache[n.id] = n;
  });
  return nodeCache;
}

/**
 * findNodeWithSku
 *
 * gets the node item for the specific SKU
 *
 * @param {string} sku
 * @param {NodeSchemaInstance} schema
 * @param {Station|number} station
 * @returns
 */
async function findNodeWithSku(sku, schema) {
  const helpers = Module._helpers.logistics();
  const logParams = helpers.logParams(schema.schema);
  const recepitNodes = await Node.findNodes(
    {
      where: {
        [logParams('sku')]: sku
      }
    },
    schema
  );
  return recepitNodes;
}

/**
 * findNodeWithSkuForStation
 *
 * gets the node item for the specific station based on the SKU
 *
 * @param {string} sku
 * @param {NodeSchemaInstance} schema
 * @param {Station|number} station
 * @returns
 */
async function findNodeWithSkuForStation(sku, schema, station) {
  const helpers = Module._helpers.logistics();
  const logParams = helpers.logParams(schema.schema);
  const _recepitNodes = await Node.findNodes(
    {
      where: {
        [logParams('sku')]: sku,
        station: Station.getId(station),
        __available__: true
      }
    },
    schema
  );
  const recepitNode = _recepitNodes[0];
  return recepitNode;
}

/**
 * saveNode
 *
 * Saves the node changes to the database
 *
 * @param {NodeInstance} node
 * @param {NodeSchemaInstance} schema
 * @param {SiteInstance} site - if we want to update the modules function
 * @returns Promise<NodeSchemaInstance>
 */
async function saveNode(node, schema, site = null) {
  Node.resetAlarms(node);
  const _node = await Node.updateOrCreate()({
    params: node,
    schema: schema
  });
  if (site) {
    Modules.node(
      {},
      {
        locals: {
          domain: Model.getId((schema || {}).domain),
          schema: schema,
          device: null,
          siteData: site
        }
      }
    )(_node);
  }
  return _node;
}

/**
 * blastChange
 *
 * Calls a job to send updates via websockets
 *
 * @param {PurchaseOrderInstance} po
 * @param {PurchaseOrderInstance} change
 * @param {String} action
 * @param {any} message
 * @returns
 */
async function blastChange(po, change, action, message) {
  if (Site.isInTestMode()) {
    return;
  }
  Jobs.purchaseorderChangeBlast.add({
    po: po,
    change: change,
    action: action,
    message: message
  });
}

/**
 * getInventoryDimensionParamters
 *
 * Gets the invetory params for dimensions
 *
 * @param {NodeSchemaInstance} schema
 * @returns NodeParam[]
 */
function getInventoryDimensionParamters(schema = {}) {
  const _schema = schema.schema || [];
  const send = [];
  for (let i = 0; i < _schema.length; i++) {
    const param = _schema[i];
    if (param.type === 'dimension') {
      send.push(param);
    }
  }
  return send;
}

/**
 * @name reinforceReceivedSerials
 * @description - provides a fallback where if the serials aren't
 *   received we still move the items
 * @param {any} item - the received item
 * @param {*} packedItems - the item actually sent
 * @returns {string[]}
 */
function reinforceReceivedSerials(item, packedItems) {
  const serials = item.serials || [];
  if (!packedItems) {
    return serials;
  }
  const packedSerials = packedItems.serials || [];
  return packedSerials.length && serials.length !== packedSerials.length
    ? packedSerials
    : serials;
}

/**
 * iterateItemsToCache
 *
 * Pulls quantites from the invtory for further accounting
 *
 * @param {InventoryItem[]} items
 * @param {Records} itemStore
 * @param {Records|null} serialStore
 *
 * @return {Records} itemStore
 */
function iterateItemsToCache(
  items,
  itemStore = {},
  serialStore = null,
  packedItems = {}
) {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (itemStore[item.id]) {
      itemStore[item.id].quantity += item.quantity;
    } else {
      itemStore[item.id] = item;
    }
    if (serialStore) {
      const serials = reinforceReceivedSerials(item, packedItems[item.id]);
      if (serials.length) {
        serialStore[item.id] = reinforceReceivedSerials(
          item,
          packedItems[item.id]
        );
      }
    }
  }
}

/**
 * getSchemaParamBasedOnKey
 *
 * Looks for the name of the parameter and returns it
 *
 * @param {string} key
 * @param {NodeSchemaInstance} schema
 * @returns
 */
function getSchemaParamBasedOnKey(key, schema) {
  const sc = schema.schema || [];
  for (let i = 0; i < sc.length; i++) {
    const param = sc[i];
    if (param.name === key) {
      return param;
    }
  }
  return null;
}

module.exports = {
  buildStationMap,
  buildNodeCache,
  findNodeWithSkuForStation,
  saveNode,
  blastChange,
  getInventoryDimensionParamters,
  iterateItemsToCache,
  getSchemaParamBasedOnKey,
  findNodeWithSku
};
