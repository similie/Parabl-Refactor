const { SqlUtils } = require('similie-api-services');
const { Common } = require('../common/common');
const { getSchemaParamBasedOnKey } = require('./purchase-order-shared');
// //////////////
/// buildSerials
// //////////////
function voidFindSpecificSerialReferences(serial_references = [], id, schema) {
  const nsId = NodeSchema.getId(schema);
  const _id = parseInt(id);
  return sku => {
    const references = [];
    for (let i = 0; i < serial_references.length; i++) {
      const ref = serial_references[i] || {};
      if (ref.scan === sku && ref.identity === nsId && ref.item === _id) {
        references.push(ref);
      }
    }
    return references;
  };
}

function buildNewSerialCacheItem(key, recepitNode, serialSchema, schema, po) {
  const helpers = Module._helpers.logistics();
  const serialParams = helpers.logParams(serialSchema.schema);
  const _sParam = getSchemaParamBasedOnKey(key, schema);
  return {
    via_param: key,
    possessed_by_schema: NodeSchema.getId(serialSchema),
    owned_by_schema: NodeSchema.getId(schema),
    owned_by_node: Model.getId(recepitNode),
    unique: _sParam.unique_identity,
    _meta: {
      count: 0,
      sku: serialParams('sku'),
      quantity: serialParams('quantity'),
      observer: Model.getId(po.completed_by || po.approver)
    },
    skus: {}
  };
}

function applySerialToSerialCache(sku, serial, serialHold) {
  serialHold.skus[sku] = serialHold.skus[sku] || {
    count: NodeSerial.getCountByScan(sku, serial),
    nodes: []
  };
}

function applyReferencesToSerialCache(key, references, serialHold) {
  for (let i = 0; i < references.length; i++) {
    const reference = references[i];
    const serials = reference.serials;
    if (serials.name === key && _.size(serials.nodes)) {
      const nodes = NodeSerial.compress(serials.nodes);
      const union = _.union(serialHold.nodes, nodes);
      serialHold.nodes = union;
    }
  }
}

function pullStationMetaValuesFromReferences(serialReferences = []) {
  const skuCache = {};
  for (let i = 0; i < serialReferences.length; i++) {
    const reference = serialReferences[i];
    const serials = reference.serials;
    const references = {
      serials: serials
    };
    if (reference.station_asset) {
      references.station_asset = reference.station_asset;
    }
    skuCache[reference.scan] = references;
  }

  return (sku, cache = {}) => {
    const references = skuCache[sku];
    if (!references || !cache.skus[sku]) {
      return;
    }
    const nodes = cache.skus[sku].nodes;
    if (nodes && !nodes.length) {
      const refNodes = references.serials.nodes || [];
      nodes.push(...refNodes);
    }
    if (references.station_asset) {
      cache.skus[sku].station_asset = references.station_asset;
    }
  };
}

/**
 * @public
 * buildSerials
 *
 * Builds a serial cache object for the inventory changes to serialized
 * items
 *
 * @param {string} serial
 * @param {string|number} id
 * @param {PurchaseOrderInstance} po
 * @param {NodeSchemaInstance} schema
 * @param {NodeInstance} recepitNode
 * @returns Promise<SerialCacheObject>
 */
async function buildSerials(serial, id, po, schema, recepitNode) {
  const serialHold = {};
  const serialReferences = po.meta.serial_references;
  const ref = voidFindSpecificSerialReferences(serialReferences, id, schema);
  const serialMeta = pullStationMetaValuesFromReferences(serialReferences);
  const serializer = await PosTransaction.setSerialiser(schema);
  for (const key in serializer) {
    const serialSchema = serializer[key].schema || { schema: [] };
    serialHold[NodeSchema.getId(serialSchema)] =
      serialHold[NodeSchema.getId(serialSchema)] ||
      buildNewSerialCacheItem(key, recepitNode, serialSchema, schema, po);
    const serials = NodeSerial.compress(serial);
    for (let j = 0; j < _.size(serials); j++) {
      const sku = serials[j];
      applySerialToSerialCache(
        sku,
        serial,
        serialHold[NodeSchema.getId(serialSchema)]
      );
      serialMeta(sku, serialHold[NodeSchema.getId(serialSchema)]);
      applyReferencesToSerialCache(
        key,
        ref(sku),
        serialHold[NodeSchema.getId(serialSchema)]
      );
    }
  }

  return serialHold;
}

function ensureSearchAttributesForNodeSerial(search) {
  const attributes = NodeSerial._attributes;
  for (const key in search) {
    if (!attributes[key]) {
      delete search[key];
    }
  }
  return search;
}

async function findAndApplyCountToSerial(sku, node, cache) {
  const strippedCache = Object.assign({}, cache);
  const skus = Object.assign({}, cache.skus);
  const count = skus[sku].count;
  const search = {
    ...strippedCache,
    possessed_by_node: node
  };
  const ns = await NodeSerial.findOrCreate(
    // running this so no cached attributes
    // can corrupt the search
    ensureSearchAttributesForNodeSerial(search)
  );
  ns.quantity += count;
  await NodeSerial.saveAsync(ns);
  return ns;
}

function buildUniqueSerial(sku, schema) {
  try {
    return NodeSerial.buildUnique({
      schema: schema,
      sku: sku
      // force: true
    });
  } catch (e) {
    sails.log.error(e);
  }
}

function sendCreateOrUpdate(values, schema) {
  return Node.updateOrCreate()({
    params: values,
    schema: schema
  });
}

async function applySerialCountToNode(sku, cache, schema) {
  const meta = Object.assign({}, cache._meta);
  const skus = Object.assign({}, cache.skus);
  const count = skus[sku].count;
  const nodes = skus[sku].nodes;

  const creationAppend = {
    observer: meta.observer,
    station: -1
  };

  const values = {
    [meta.quantity]: count,
    [meta.sku]: sku,
    __available__: count > 0
  };

  if (!nodes.length) {
    return sendCreateOrUpdate(
      {
        ...creationAppend,
        ...values
      },
      schema
    );
  }
  const savedNodes = [];
  for (let i = 0; i < nodes.length; i++) {
    values.id = nodes[i];
    const saved = await sendCreateOrUpdate(values, schema);
    savedNodes.push(saved);
  }
  return savedNodes.length === 1 ? savedNodes.pop() : savedNodes;
}

async function buildNewNodeSerialLink(sku, node, cache) {
  const strippedCache = Object.assign({}, cache);
  const skus = Object.assign({}, cache.skus);
  const count = skus[sku].count;
  delete strippedCache._meta;
  delete strippedCache.skus;
  const create = {
    ...strippedCache,
    possessed_by_node: Model.getId(node),
    quantity: count
  };
  const newSerial = await NodeSerial.create(create);
  return newSerial;
}

async function runSerialQuery(sku, node, cache, schema) {
  const escape = SqlUtils.escapeUtil();
  const meta = Object.assign({}, cache._meta);
  const skus = Object.assign({}, cache.skus);
  const count = skus[sku].count;
  const query = escape(
    `UPDATE "%s"."%s" SET "%s" = "%s" + %s, "__available__" = true WHERE "id" = %s AND "%s" = '%s'`,
    schema.domain_schema,
    schema.name,
    meta.quantity,
    meta.quantity,
    count,
    node,
    meta.sku,
    sku
  );
  delete cache.unique;
  const results = await Model.queryAsync(query);
  return results.rows;
}

async function applySerialToStationAssets(sku, cache = {}, nodeserial = {}) {
  const skus = Object.assign({}, cache.skus);
  const stationAssets = skus[sku].station_asset || [];
  const nodes = skus[sku].nodes || [];
  if (
    !stationAssets.length ||
    nodes.indexOf(Model.getId(nodeserial.possessed_by_node)) === -1
  ) {
    return;
  }

  for (let i = 0; i < stationAssets.length; i++) {
    const stationAsset = stationAssets[i];
    nodeserial.station_asset = Model.getId(stationAsset);
    await StationAsset.bindAllSerialAssetValues(nodeserial, stationAsset);
  }
}

async function applySerialNodeIdentity(sku, node, cache, schema) {
  const ns = await findAndApplyCountToSerial(sku, node, cache);
  // the total count is based in the single serial item, our per-station
  // count is based on the nodeserial quantity, not the serial node quantity
  await runSerialQuery(sku, node, cache, schema);
  return ns;
}

/**
 * @public
 * manageSerials
 *
 * Manages the work required to build up serialized inventory
 *
 * @param {any} serialsCache
 * @returns
 */
async function manageSerials(serialsCache) {
  const serials = [];
  for (const sid in serialsCache) {
    const schema = await NodeSchema.findOneById(sid);
    const cache = serialsCache[sid];
    for (const sku in cache.skus) {
      if (cache.unique) {
        await buildUniqueSerial(sku, schema);
        // cache.skus[sku].serialBinding = Model.getId(serial);
        const node = await applySerialCountToNode(sku, cache, schema);
        const ns = await buildNewNodeSerialLink(sku, node, cache);
        await applySerialToStationAssets(sku, cache, ns);
        serials.push(ns);
      } else {
        const nodes = cache.skus[sku].nodes || [];
        if (!nodes.length) {
          const node = await applySerialCountToNode(sku, cache, schema);
          const ns = await buildNewNodeSerialLink(sku, node, cache);
          serials.push(ns);
        }

        for (let i = 0; i < nodes.length; i++) {
          // create this for the nodes
          const node = Model.getId(nodes[i]);
          const ns = await applySerialNodeIdentity(sku, node, cache, schema);
          // the total count is based in the single serial item, our per-station
          // count is based on the nodeserial quantity, not the serial node quantit
          serials.push(ns);
        }
      }
    }
  }
  return serials;
}

/**
 * @public
 * iterateItemCountsToCacheWithSerials
 *
 * Counts up the item quantity for the inventory
 *
 * @param {InventoryItem[]} items
 * @param {Object} itmmConntStore - counts of the inventory items
 * @param {Object} serialStore
 */
function iterateItemCountsToCacheWithSerials(
  items = [],
  itmmConntStore = {},
  serialStore
) {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!itmmConntStore[item.id]) {
      itmmConntStore[item.id] = 0;
    }
    itmmConntStore[item.id] += item.quantity || 0;
    const serials = item.serials || item.serial || [];
    if (serials.length && serialStore) {
      serialStore[item.id] = serialStore[item.id] || [];
      serialStore[item.id].push(...serials); // = _.union(serialStore[item.id], serials);
    }
  }
}

function isParamCorrectTypeNode(param, inventorySchema) {
  return (
    param.type === 'node' && param.node === NodeSchema.getId(inventorySchema)
  );
}

async function searchPossessedNodeScope(param, inventorySchema, node) {
  const search = {
    via_param: param.name,
    possessed_by_schema: param.node,
    owned_by_schema: Model.getId(inventorySchema),
    owned_by_node: Model.getId(node),
    possessed_by_node: { '!': null }
  };
  const nSerials = await NodeSerial.find().where(search);
  return nSerials.map(ns => ns.possessed_by_node);
}

async function findScopedNodesForSerialSchema(
  sku,
  paramName,
  scope = [],
  serialSchema
) {
  if (!scope.length) {
    return scope;
  }
  const nodes = await Node.findNodes(
    {
      where: {
        id: scope,
        [paramName]: sku,
        __available__: true
      }
    },
    serialSchema
  );

  return nodes;
}

async function buldCountForSerial(
  node,
  nodes,
  serialSchema,
  inventorySchema,
  key
) {
  const nodeSerials = await NodeSerial.find().where({
    owned_by_schema: Model.getId(inventorySchema),
    possessed_by_schema: Model.getId(serialSchema),
    possessed_by_node: nodes.map(n => Model.getId(n)),
    via_param: key,
    owned_by_node: Model.getId(node)
  });

  const sendValues = {};
  for (let i = 0; i < nodeSerials.length; i++) {
    const nodeserial = nodeSerials[i];
    sendValues[Model.getId(nodeserial.possessed_by_node)] = {
      node: Model.getId(nodeserial.possessed_by_node),
      schema: Model.getId(nodeserial.possessed_by_schema),
      id: Model.getId(nodeserial),
      quantity: nodeserial.quantity,
      via: nodeserial.via_param,
      label: serialSchema.title || serialSchema.name
    };
  }
  return sendValues;
}

async function sendValidationForSerialCheck(
  serialSchema,
  inventorySchema,
  node,
  key,
  sku
) {
  const helpers = Module._helpers.logistics();
  const serialParams = helpers.logParams(serialSchema.schema);
  let available = false;
  for (let i = 0; i < _.size(inventorySchema.schema); i++) {
    const s = inventorySchema.schema[i];
    if (!isParamCorrectTypeNode(s, serialSchema)) {
      continue;
    }
    const scope = await searchPossessedNodeScope(s, inventorySchema, node);
    if (!scope.length) {
      continue;
    }
    const nodes = await findScopedNodesForSerialSchema(
      sku,
      serialParams('sku'),
      scope,
      serialSchema
    );

    if (!nodes.length) {
      continue;
    }

    const nHold = await buldCountForSerial(
      node,
      nodes,
      serialSchema,
      inventorySchema,
      key
    );

    available = {
      nodes: nodes.map(n => Model.getId(n)),
      identity: NodeSchema.getId(serialSchema),
      name: key,
      serialDetails: nHold
    };
    break;
  }
  return available;
}

async function seekSerializedAssetsBasedNodeSku(node, schema, sku) {
  let available = false;
  const serializer = await PosTransaction.setSerialiser(schema);
  for (const key in serializer) {
    const serial = serializer[key];
    available = await sendValidationForSerialCheck(
      serial.schema,
      schema,
      node,
      key,
      sku
    );

    if (available) {
      break;
    }
  }
  return available;
}

module.exports = {
  buildSerials,
  manageSerials,
  iterateItemCountsToCacheWithSerials,
  buildNewSerialCacheItem,
  seekSerializedAssetsBasedNodeSku
};
