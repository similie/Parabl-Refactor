/**
 * NodeSerial.js
 *
 * @description :: A model definition represents a database table/collection.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

const { SqlUtils } = require('similie-api-services');

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    /**
     * This is the parent node that owns the serial. For example,
     * A vehicle node will have an param called VIN number. This is the
     * node that holds this parameter
     */
    owned_by_node: {
      type: 'integer'
    },
    /**
     * This is the actual VIN number node. It is possed by the
     * owner node. It is the global serial for this entity
     */
    possessed_by_node: {
      type: 'integer'
    },
    owned_by_schema: {
      model: 'nodeschema'
    },
    possessed_by_schema: {
      model: 'nodeschema'
    },
    /**
     * Not used. For future functionality
     */
    station: {
      model: 'station'
    },
    unique: {
      type: 'boolean',
      defaultsTo: true
    },
    quantity: {
      type: 'integer',
      min: 0,
      defaultsTo: 0
    },
    station_asset: {
      model: 'stationasset'
    },
    via_param: {
      type: 'string'
    },
    locked: {
      type: 'boolean',
      defaultsTo: false
    }
  },

  errorCodes: {
    UNIQUE_VALUES_VIOLATED: 1
  },

  compress: function(serials) {
    const compression = [];
    const has = {};
    for (let i = 0; i < _.size(serials); i++) {
      const serial = serials[i];
      if (!has[serial]) {
        has[serial] = true;
        compression.push(serial);
      }
    }

    return compression;
  },

  getCountByScan: function(scan, serials) {
    let count = 0;
    for (let i = 0; i < _.size(serials); i++) {
      const serial = serials[i];
      if (serial === scan) {
        count++;
      }
    }
    return count;
  },

  buildUniqueBuildQuery: function(params) {
    const escape = SqlUtils.escapeUtil();
    const schema = params.schema;
    const sku = params.sku;
    const helpers = Module._helpers.logistics();
    const logParams = helpers.logParams(schema.schema);
    let query = escape(
      `SELECT "id" as id FROM "%s"."%s" WHERE "%s" = %L AND "__available__" = true;`,
      schema.domain_schema,
      schema.name,
      logParams('sku'),
      sku
    );

    if (params.force) {
      query = escape(
        `SELECT "id" as id FROM "%s"."%s" WHERE "%s" = %L AND "__available__" = true;DELETE FROM "%s"."%s" WHERE "%s" = %L AND "__available__" = true;`,
        schema.domain_schema,
        schema.name,
        logParams('sku'),
        sku,
        schema.domain_schema,
        schema.name,
        logParams('sku'),
        sku
      );
    }
    return query;
  },

  buildUnique: async function(params) {
    const query = this.buildUniqueBuildQuery(params);
    const deleted = await Model.queryAsync(query);
    const rows = deleted.rows;
    if (!_.size(rows)) {
      return null;
    }
    // if (!params.force) {
    //   throw new Error('error.THIS_SERIAL_IDENTITY_HAS_ALREADY_BEEN_ASSIGNED');
    // }
    const destroy = _.pluck(rows, 'id');
    const sendDestroy = await NodeSerial.destroy({
      possessed_by_node: destroy
    });
    return sendDestroy;
  },

  isUnique: async function(params) {
    // via_param
    const via = params.via;
    const schema = await NodeSchema.findOneById(
      NodeSchema.getId(params.identity)
    );

    if (!schema) {
      throw new Error('Invalid Identity');
    }

    let serialParams = [];

    if (via) {
      serialParams = _.where(schema.schema, {
        name: via,
        serializable: true
      });
    } else {
      _.each(schema.schema, s => {
        if (s.type === 'node' && s.serializable) {
          serialParams.push(s);
        }
      });
    }

    if (!_.size(serialParams)) {
      throw new Error('No valid serial parameters found');
    }
    let valid = true;
    const helpers = Module._helpers.logistics();
    for (let i = 0; i < _.size(serialParams); i++) {
      const serial = serialParams[i];
      if (serial.unique_identity) {
        const ns = await NodeSchema.findOneById(NodeSchema.getId(serial.node));
        const logParams = helpers.logParams(ns.schema);
        const children = await Node.findNodes(
          {
            where: {
              [logParams('sku')]: params.sku,
              __available__: true
            },
            limit: 1
          },
          ns
        );
        if (_.size(children)) {
          valid = false;
          break;
        }
      }
    }
    return valid;
  },

  findNodeForUpdate: function(name, skuParam, nodes) {
    const found = _.where(nodes, { [skuParam]: name });
    return found[0];
  },

  getSerialParam: function(ns, name) {
    const schema = _.isArray(ns) ? ns : (ns || {}).schema;
    const found = _.where(schema, { name: name });
    if (!_.size(found)) {
      return {};
    }

    if (found[0].type === 'node') {
      return found[0];
    }
    return {};
  },
  /*
   * We are going to count quantities
   */

  getSerialCount: function(serials, addTo) {
    let count = 0;

    for (let i = 0; i < _.size(serials); i++) {
      const serial = serials[i];
      count += serial.quantity;
      if (serial.possessed_by_node && _.isArray(addTo)) {
        addTo.push(serial.possessed_by_node);
      }
    }
    return count;
  },

  afterDestroy: async function(_values, next) {
    for (let i = 0; i < _.size(_values); i++) {
      // sails.log.debug("POS CHECKPOINT 4.2.7. 1", Date.now() - start);
      const values = _values[i];
      if (values.owned_by_node && values.via_param) {
        const schema = await NodeSchema.findOneById(
          NodeSchema.getId(values.owned_by_schema)
        );
        const param = _.where(schema.schema, { name: values.via_param });
        // sails.log.debug("POS CHECKPOINT 4.2.7.2", Date.now() - start);
        if (!_.size(param)) {
          continue;
        }
        // sails.log.debug("POS CHECKPOINT 4.2.7.3", Date.now() - start);
        const node =
          (await Node.findOneById(values.owned_by_node, schema)) || {};
        if (node) {
          const helpers = Module._helpers.logistics();
          const logParams = helpers.logParams(schema.schema);
          node[values.via_param] = node[values.via_param] || {};
          // sails.log.debug("POS CHECKPOINT 4.2.7.3", Date.now() - start);
          const nodeSerials = await NodeSerial.find().where({
            owned_by_node: values.owned_by_node,
            possessed_by_node: { '!': null }
          });
          _.remove(nodeSerials, r => r.id === values.id);
          const ids = _.unique(_.pluck(nodeSerials, 'possessed_by_node'));
          // sails.log.debug("POS CHECKPOINT 4.2.7.4", Date.now() - start);
          if (!_.size(ids)) {
            node[values.via_param].count = 0;
          } else {
            // sails.log.debug("POS CHECKPOINT 4.2.7.5", Date.now() - start);
            const childSchema = await NodeSchema.findOneById(
              NodeSchema.getId(values.possessed_by_schema)
            );

            let count = 0;
            // sails.log.debug("POS CHECKPOINT 4.2.7.6", Date.now() - start);
            const nodes = await Node.findNodes(
              {
                where: {
                  id: ids,
                  __available__: true
                }
              },
              childSchema
            );
            for (let i = 0; i < _.size(nodes); i++) {
              const node = nodes[i];
              count += node[logParams('quantity')] || 0;
            }
            node[values.via_param].count = count;
            // sails.log.debug("POS CHECKPOINT 4.2.7.7", Date.now() - start);
          }
          // sails.log.debug("POS CHECKPOINT 4.2.7.8", Date.now() - start);
          await Node.updateOrCreate()({
            params: node,
            schema: schema
          });
        }
      }
    }

    next();
  },

  beforeCreate: async function(values, next) {
    // got the verify. Totes drunk
    if (values.unique) {
      const params = [
        'owned_by_node',
        'possessed_by_node',
        'owned_by_schema',
        'possessed_by_schema',
        'via_param'
      ];
      const every = [];
      _.each(params, p => {
        every.push(!!values[p]);
      });

      if (_.every(every)) {
        const verifyOthers = await NodeSerial.findOne({
          owned_by_node: values.owned_by_node,
          possessed_by_node: values.possessed_by_node,
          owned_by_schema: values.owned_by_schema,
          possessed_by_schema: values.possessed_by_schema,
          via_param: values.via_param
        });

        if (verifyOthers) {
          // return next({ error: "errors.UNIQUE_VALUES_VIOLATED" });
          await NodeSerial.destroy({
            id: verifyOthers.id
          });
        }
      }
    }
    next();
  },

  garbageCollect: async function(serials, casualties) {
    const _s = _.isArray(serials) ? serials : [serials];
    for (let i = 0; i < _.size(_s); i++) {
      const serial = _s[i];
      if (serial.quantity <= 0) {
        await NodeSerial.destroy({
          id: NodeSerial.getId(serial)
        });
        const pNode = Model.getId(serial.possessed_by_node);
        if (_.isArray(casualties) && pNode) {
          casualties.push(pNode);
        }
      } else {
        // @todo
      }
    }
  },

  generateSerializeNode: async function(params, schema) {
    const node = await Node.updateOrCreate()({
      params: {
        __available__: true,
        station: -1,
        ...params
      },
      schema: schema
    });
    return node;
  },

  generateFromReturnedSerial: function() {
    //
  },

  setCache: async function(Cache) {
    for (const sId in Cache) {
      const cache = Cache[sId];
      const nodes = await Node.findNodes(
        {
          where: {
            id: cache.nodesIds,
            __available__: true
          }
        },
        cache.schema
      );
      cache.nodes = {};
      for (let i = 0; i < _.size(nodes); i++) {
        const node = nodes[i];
        cache.nodes[Model.getId(node)] = node;
      }
    }
  },

  buildCache: function(Cache, schema, element) {
    const id = NodeSchema.getId(schema);
    if (!Cache[id]) {
      Cache[id] = {
        schema: schema,
        nodesIds: []
      };
    }
    Cache[id].nodesIds = _.filter(
      _.union(Cache[id].nodesIds, [element]),
      f => !!f
    );
  },

  setNodes: function(oCache, pCache) {
    return serial => {
      const o_schema = NodeSchema.getId(serial.owned_by_schema);
      const p_schema = NodeSchema.getId(serial.possessed_by_schema);
      const o_node = oCache[o_schema].nodes[serial.owned_by_node];
      serial.owned_by_node = o_node;
      const p_node = pCache[p_schema].nodes[serial.possessed_by_node];
      serial.possessed_by_node = p_node;
    };
  },

  pullNodes: async nodeSerials => {
    let one = false;
    const serials = [];
    if (!_.isArray(nodeSerials) && _.isObject(nodeSerials)) {
      one = true;
      serials.push(nodeSerials);
    } else {
      serials.push(...nodeSerials);
    }

    const oCache = {};
    const pCache = {};
    for (let i = 0; i < _.size(serials); i++) {
      const serial = serials[i];
      NodeSerial.buildCache(
        oCache,
        serial.owned_by_schema,
        serial.owned_by_node
      );
      NodeSerial.buildCache(
        pCache,
        serial.possessed_by_schema,
        serial.possessed_by_node
      );
    }
    await NodeSerial.setCache(oCache);
    await NodeSerial.setCache(pCache);
    const set = NodeSerial.setNodes(oCache, pCache);
    for (let i = 0; i < _.size(serials); i++) {
      set(serials[i]);
    }

    return one ? serials.pop() : serials;
  },

  updateNodeQuantity: async function(ns, value) {
    const helpers = Module._helpers.logistics();
    const escape = SqlUtils.escapeUtil();
    const schema = _.isObject(ns.possessed_by_schema)
      ? ns.possessed_by_schema
      : await NodeSchema.findOneById(ns.possessed_by_schema);
    const logParams = helpers.logParams(schema.schema);
    const qParam = logParams('quantity');
    const query = escape(
      `UPDATE "%s"."%s" SET "%s" = "%s" ${
        value > 0 ? '+' : '-'
      } %s WHERE "id" = %s`,
      schema.domain_schema,
      schema.name,
      qParam,
      qParam,
      Math.abs(value),
      Model.getId(ns.possessed_by_node)
    );
    return await Model.queryAsync(query);
  },

  setAllSerialCountsOnTransaction: function(transaction) {
    const serials = transaction.serials;
    for (const key in serials) {
      const serial = serials[key];
      const nodeserial = serial.nodeserial;
      const items = serial.items;
      for (const sku in nodeserial) {
        nodeserial[sku].count = this.getCountByScan(sku, items);
      }
    }
  },

  getTotalItemCount: async function(nodeserial) {
    const ns = Number.isFinite(nodeserial)
      ? await NodeSerial.findOneById(nodeserial)
      : nodeserial;
    const escape = SqlUtils.escapeUtil();
    const query = escape(
      `SELECT SUM("quantity") as "total" FROM "public"."nodeserial" 
    WHERE  "owned_by_schema" = %s AND "owned_by_node" = %s`,
      this.getId(ns.owned_by_schema),
      this.getId(ns.owned_by_node)
    );
    const results = await this.queryAsync(query);
    const counts = results.rows.pop() || {};
    return counts.total || 0;
  },

  getNodeCountChangeQuery: async function(nodeserial) {
    const schema = await NodeSchema.findOneById(nodeserial.owned_by_schema);
    const count = await this.getTotalItemCount(nodeserial);
    const table = Node.getStringTableNameWithSchema(schema);
    const escape = SqlUtils.escapeUtil();
    return escape(
      `UPDATE %s SET "%s" = '{"count": %s}'::JSON WHERE "id" = %s `,
      table,
      nodeserial.via_param,
      count,
      this.getId(nodeserial.owned_by_node)
    );
  },

  setCountOnItemChange: async function(nodeserial) {
    const ns = Number.isFinite(nodeserial)
      ? await NodeSerial.findOneById(nodeserial)
      : nodeserial;
    const query = await this.getNodeCountChangeQuery(ns);
    const results = await this.queryAsync(query);
    return results.rows;
  },

  findSerializedAsset: async function(searchSerial = {}) {
    const search = {
      via_param: searchSerial.via_param,
      possessed_by_schema: searchSerial.possessed_by_schema,
      owned_by_schema: searchSerial.owned_by_schema,
      owned_by_node: searchSerial.owned_by_node,
      unique: searchSerial.unique
    };
    const serial = await this.findOne(search);
    if (!serial) {
      return null;
    }

    const asset = await StationAsset.findOne({
      serial_bind: this.getId(serial)
    });
    return asset;
  },

  buildPosSerial: async function(serial, nSerial, scan, node) {
    if (!serial.nodeserial || !serial.nodeserial[scan]) {
      serial.nodeserial = serial.nodeserial || {};
      serial.nodeserial[scan] = {
        serial: NodeSerial.getId(nSerial),
        node: Model.getId(node)
      };
    }
    await NodeSerial.decrement(nSerial);
  },

  attatchSerialFromScope: async (scope, parentNode) => {
    const ns = await NodeSerial.create({
      possessed_by_node: Model.getId(scope.node),
      possessed_by_schema: scope.id,
      owned_by_node: parentNode.id,
      owned_by_schema: parentNode.schema,
      via_param: scope.param_name,
      quantity: scope.count
    });
    scope.serial = ns;
    return ns;
  },

  buildSerialScope: async function(nodeSerialElements, parent) {
    const nodes = _.pluck(nodeSerialElements.nodes, 'id');
    const scope = nodeSerialElements.scope
      ? [nodeSerialElements.scope]
      : await NodeSerial.find().where({
          possessed_by_schema: nodeSerialElements.id,
          owned_by_node: parent.id,
          via_param: nodeSerialElements.param_name,
          owned_by_schema: NodeSchema.getId(parent.schema),
          possessed_by_node: nodes
        });

    return scope;
  },

  poSerial: async function(serialCache) {
    const ns = {
      ...serialCache
    };
    const created = await NodeSerial.findOrCreate(ns);
    return created;
  },

  transactionSerial: async function(transaction, serial, scan) {
    const nodeserial = serial.nodeserial[scan];
    const ns = {
      via_param: serial.param_name,
      possessed_by_schema: NodeSchema.getId(serial),
      possessed_by_node: NodeSchema.getId(nodeserial.node),
      // quantity: 0,
      owned_by_schema: NodeSchema.getId(transaction.schema),
      owned_by_node: Model.getId(transaction.node)
    };
    const created = await NodeSerial.findOrCreate(ns);
    return created;
  },

  revertNodeSerial: async function(serial) {
    sails.log.error('REVERTING THE DAMAGE DONE', serial);
  },

  restoreLeaveOrTerminate: async function(_serial) {
    const nodeSchema = await NodeSchema.findOneById(
      NodeSchema.getId(_serial.id)
    );
    const serialBySku = _.cloneDeep(_serial.nodeserial) || {};
    const helpers = Module._helpers.logistics();
    const logParams = helpers.logParams(nodeSchema.schema);
    const nodeSend = [];
    for (const sku in serialBySku) {
      const serial = serialBySku[sku];
      const serialID = Model.getId(serial.serial);
      const nodeSerial = await NodeSerial.findOneById(serialID);
      const nodes = await Node.findNodes(
        {
          where: {
            id: Model.getId(serial.node)
          }
        },
        nodeSchema
      );
      serial.count = this.getCountByScan(sku, _serial.items);
      if (!serial.count) {
        continue;
      }

      serial.node = nodes.pop();

      serial.altered_nodes = [];
      serial.serial = nodeSerial;
      // @todo:: investigate why this logic exists
      const save = false;
      if (save) {
        serial.altered_nodes.push(Model.getId(serial.node));
        await Node.updateOrCreate()({
          params: serial.node,
          schema: nodeSchema
        });
      }
      nodeSend.push(serial.node);
    }

    return {
      param_name: _serial.param_name,
      nodes: nodeSend,
      schema: nodeSchema,
      logParams: logParams,
      scope: serialBySku
    };
  },

  getNodesOnTransactionSerial: async function(serial) {
    const nodeSchema = await NodeSchema.findOneById(serial.id);
    const helpers = Module._helpers.logistics();
    const logParams = helpers.logParams(nodeSchema.schema);
    const sendNodes = [];
    for (let i = 0; i < _.size(serial.items); i++) {
      const sku = serial.item[i];
      const nodes = await Node.findNodes(
        {
          where: {
            [logParams('sku')]: sku
          }
        },
        nodeSchema
      );
      if (_.size(nodes)) {
        sendNodes.push(...nodes);
      }
    }
    return sendNodes;
  },

  getSerialOnNode: function() {
    //
  },

  setQuantity: async function(ns, value) {
    const nsId = NodeSerial.getId(ns);
    const _ns = await NodeSerial.findOneById(nsId).populate(
      'possessed_by_schema'
    );
    try {
      _ns.quantity += value;
      const _ns_ = await NodeSerial.update(
        { id: NodeSerial.getId(ns) },
        { quantity: _ns.quantity }
      );
      await this.updateNodeQuantity(_ns, value);
      return _.isArray(_ns_) ? _ns_.pop() : _ns_;
    } catch (e) {
      console.error(e);
    }

    return _ns;
  },

  increment: async function(ns, value) {
    value = value || 1;
    return this.setQuantity(ns, value);
  },

  decrement: function(ns, value) {
    value = value || -1;
    return this.setQuantity(ns, value);
  },

  getSerialThroughNode: function(serials, node) {
    const serialArray = _.where(serials, {
      possessed_by_node: Model.getId(node)
    });
    if (!_.size(serialArray)) {
      return null;
    } else if (_.size(serialArray) > 1) {
      return serialArray;
    } else {
      return serialArray.pop();
    }
  },

  pullFirstInventoryParam: function(nodeSchema) {
    const schema = (nodeSchema || {}).schema || [];
    for (let i = 0; i < schema.length; i++) {
      const param = schema[i];
      if (param.serializable) {
        return param;
      }
    }
    return null;
  },

  pullAllInventoryParams: function(nodeSchema) {
    const schema = (nodeSchema || {}).schema || [];
    const params = [];
    for (let i = 0; i < schema.length; i++) {
      const param = schema[i];
      if (param.serializable) {
        params.push(param);
      }
    }
    return params;
  },

  createLink: async function(possessor, possessed, throughParam, quantity = 0) {
    const store = {
      possessed_by_node: Model.getId(possessed),
      possessed_by_schema: Model.getId(possessed.schema),

      owned_by_node: Model.getId(possessor),
      owned_by_schema: Model.getId(possessor.schema),

      via_param: throughParam.name,
      unique: !!throughParam.unique_identity,
      quantity: quantity
    };
    return NodeSerial.create(store);
  },

  fillInAllAssetValues: async function(nodeserial) {
    const id = this.getId(nodeserial);
    if (!id) {
      return null;
    }

    const value = await this.findOneById(id).populateAll();
    if (!value) {
      return null;
    }

    if (value.possessed_by_schema && value.possessed_by_node) {
      value.possessed_by_node = await Node.findOneById(
        value.possessed_by_node,
        value.possessed_by_schema
      );
    }

    if (value.owned_by_schema && value.owned_by_node) {
      value.owned_by_node = await Node.findOneById(
        value.owned_by_node,
        value.owned_by_schema
      );
    }
    return value;
  },

  adjustDirection: function(node, schema, method) {
    const helpers = Module._helpers.logistics();
    const serialParams = helpers.logParams(schema.schema);
    const whichWay = method === 'POST' ? 1 : -1;
    node[serialParams('quantity')] = node[serialParams('quantity')] || 0;
    node[serialParams('quantity')] += whichWay;
    if (node[serialParams('quantity')] < 0) {
      node[serialParams('quantity')] = 0;
    }
    return {
      whichWay,
      node: node[serialParams('quantity')]
    };
  },

  getFabricatedSearch: function(node, params) {
    const serials = params.serials || {};
    const name = serials.name;
    if (!name) {
      throw new Error('A valid name is required');
    }

    const identity = params.identity;
    const parentNode = params.item;
    const childIdentity = serials.identity;
    const nId = this.getId(node);

    return {
      via_param: name,
      owned_by_node: parentNode,
      owned_by_schema: identity,
      possessed_by_node: nId,
      possessed_by_schema: childIdentity
    };
  },

  fabricateOrFindNodeSerial: async function(node, params) {
    const search = this.getFabricatedSearch(node, params);
    let nSerial = await NodeSerial.findOne(search);
    if (!nSerial) {
      nSerial = await NodeSerial.create({ ...search, quantity: 0 });
    }
    return nSerial;
  },

  saveNode: function(node, schema) {
    return Node.updateOrCreate()({
      params: node,
      schema: schema
    });
  },

  setSerialQuantity: function(nSerial, adjustments) {
    nSerial.quantity += adjustments.whichWay;
    if (nSerial.quantity < 0) {
      nSerial.quantity = 0;
    }
  },

  updateWorkingSerialQuantity: function(nodeserial) {
    const query = { quantity: nodeserial.quantity };
    if (nodeserial.station_asset) {
      query.station_asset = nodeserial.station_asset;
    }
    return this.update(
      { id: this.getId(nodeserial) },
      { quantity: nodeserial.quantity }
    );
  },

  iterateSerializeItems: async function(params, method) {
    const serials = params.serials || {};
    const childIdentity = serials.identity;
    const schema = await NodeSchema.findOneById(childIdentity);
    if (!schema) {
      throw new Error('A valid serial identity is required');
    }
    const nodes = serials.nodes;
    const nSerials = [];
    for (let i = 0; i < _.size(nodes); i++) {
      const nId = nodes[i];
      const node = await Node.findOneById(nId, schema);
      if (!node) {
        continue;
      }
      const nSerial = await this.fabricateOrFindNodeSerial(node, params);
      const adjustments = this.adjustDirection(node, schema, method);
      this.setSerialQuantity(nSerial, adjustments);
      if (adjustments.node <= 0) {
        node.__available__ = false;
        await StationAsset.applyBindingAfterCountAlteration(nSerial);
        await this.destroy({ id: NodeSerial.getId(nSerial) });
      } else {
        node.__available__ = true;
        await StationAsset.applyBindingAfterCountAlteration(nSerial);
        await this.updateWorkingSerialQuantity(nSerial);
      }
      await this.saveNode(node, schema);
      nSerials.push(nSerial);
    }
    return nSerials;
  }
};
