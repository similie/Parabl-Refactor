/**
 * StationAsset.js
 *
 * @description :: A model definition represents a database table/collection.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

const { TimeUtils, SqlUtils } = require('similie-api-services');
const now_ = TimeUtils.constants.now_;

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    station: {
      model: 'station'
    },

    asset: {
      model: 'station',
      unique: true,
      required: true
    },

    serial_bind: {
      model: 'nodeserial',
      unique: true
    },

    domain: {
      model: 'domain'
    },

    maintenance: {
      type: 'boolean',
      defaultsTo: false
    }
  },

  setAssetsIntoMantenanceModel: async function(
    assetIds = [],
    maintenance = true
  ) {
    const maintenceChanges = await this.find().where({ id: assetIds });
    const assets = maintenceChanges.map(mc => mc.asset).filter(a => a != null);
    const stations = await Station.find().where({ id: assets });
    const stateIdentity = maintenance ? 'maintenance_state' : 'active_state';
    for (let i = 0; i < stations.length; i++) {
      const station = stations[i];
      await Station.setSpecialState(station, stateIdentity);
    }
  },

  assetBoundaries: async function(nodeserial, nodeId, boundaryCache) {
    const stationAssets = await StationAsset.find()
      .where({
        serial_bind: NodeSerial.getId(nodeserial)
      })
      .populate('asset')
      .populate('serial_bind');

    const boundaries = _.where(stationAssets, {
      serial_bind: { owned_by_node: nodeId }
    });
    _.each(boundaries, s => {
      if (s.serial_bind.possessed_by_node) {
        boundaryCache[NodeSerial.getId(s.serial_bind.possessed_by_node)] = s;
      }
    });
  },

  assignTransactionSerial: async function(transaction, nodeserial) {
    const aa = await StationAsset.update(
      {
        id: Model.getId(transaction.station_asset)
      },
      { serial_bind: NodeSerial.getId(nodeserial) }
    );
    return aa;
  },

  assetRegister: async function(nodeserial, searchNode, transaction, client) {
    const sAcontext = {};
    await this.assetBoundaries(nodeserial, transaction.node, sAcontext);
    const stationAsset = sAcontext[Model.getId(searchNode)];
    if (stationAsset) {
      const sa = await AssetAssignment.findOne().where({
        // stationAsset: Station.getId(stationAsset.asset),
        asset: Station.getId(stationAsset.asset),
        active: true
      });
      if (sa) {
        sa.active = false;
        sa.returned_date = TimeUtils.isoFormattedDate(now_);
        await AssetAssignment.saveAsync(sa);
      }
      const creation = {
        user: User.getId(client),
        asset: Station.getId(stationAsset.asset),
        in_pos: PointOfSale.getId(transaction.pointofsale),
        transaction: PosTransaction.getId(transaction),
        serial_bind: NodeSerial.getId(stationAsset.serial_bind)
      };
      const newAssig = await AssetAssignment.create(creation);
      transaction.assignment = AssetAssignment.getId(newAssig);
      transaction.station_asset = NodeSerial.getId(stationAsset);
      await PosTransaction.saveAsync(transaction);

      return newAssig;
    }
  },

  openLinkQuery: function(params) {
    const node = params.node;
    const schema = params.id;
    const all = params.all;
    const query = `SELECT ns.* FROM "nodeserial" ns
    LEFT JOIN "stationasset" sa ON (ns.id = sa.serial_bind)
     WHERE 
    "owned_by_node" = %s AND "owned_by_schema" = %s${
      all ? '' : ' AND sa.id IS NULL'
    };`;
    const escape = SqlUtils.escapeUtil();
    return escape(query, node, schema);
  },

  afterDestroy: async function(values, next) {
    const _vals = _.isArray(values) ? values : [values];
    for (let i = 0; i < _.size(_vals); i++) {
      const value = _vals[i];
      if (value.asset) {
        const aHelpers = Module._helpers.logistics('asset_parameter');
        const asset = await Station.findOneById(value.asset).populate(
          'station_type'
        );
        const assetParams = aHelpers.logParams(asset.station_type.schema);
        asset.schema = asset.schema || {};
        asset.schema[assetParams('serial')] = null;
        asset.parents = [];
        await Station.saveAsync(asset);
      }
      if (value.serial_bind) {
        await this.updateSetSerialBind(value.serial_bind);
      }
    }
    next();
  },

  updateSetSerialBind: async function(nodeserial, id = null) {
    const serialId = this.getId(nodeserial);
    if (!serialId) {
      throw new Error('A serial ID is required');
    }
    const updateId = this.getId(id);
    const alteredID = updateId === null ? 'NULL' : updateId;
    const escape = SqlUtils.escapeUtil();
    const query = escape(
      `UPDATE "public"."nodeserial" SET "station_asset" = %s WHERE "id" = %s`,
      alteredID,
      serialId
    );
    const results = await this.queryAsync(query);
    return results.rows;
  },

  getSchemasFromAssetStations: async function(stationAssets) {
    const schemas = [];
    const hasSchema = {};
    const hasStation = {};
    for (let i = 0; i < stationAssets.length; i++) {
      const stationAsset = stationAssets[i];
      if (!stationAsset.asset || hasStation[stationAsset.asset]) {
        continue;
      }
      hasStation[stationAsset.asset] = true;
      const station = await Station.findOneById(
        this.getId(stationAsset.asset)
      ).populate('station_type');

      if (!station) {
        continue;
      }
      const ssId = this.getId(station.station_type);
      if (hasSchema[ssId]) {
        continue;
      }
      hasSchema[ssId] = true;
      schemas.push(station.station_type);
    }
    return schemas;
  },

  searchForDanglingAssetStation: async function(
    serialNumber,
    stationSchema = {}
  ) {
    const aHelpers = Module._helpers.logistics('asset_parameter');
    const assetParams = aHelpers.logParams(stationSchema.schema);
    const escape = SqlUtils.escapeUtil();
    const query = escape(
      `SELECT * from "public"."station" WHERE "schema"->>'%s' = '%s';`,
      assetParams('serial'),
      serialNumber
    );
    const results = await this.queryAsync(query);
    return results.rows;
  },

  getSerialAssetStation: async function(serial) {
    const stationNode = serial.owned_by_node;
    const serialNode = serial.possessed_by_node;
    if (!stationNode || !serialNode) {
      return null;
    }
    const possesedSchema = serial.possessed_by_schema;
    const searchedStations = [];
    const helpers = Module._helpers.logistics();
    const nodeparams = helpers.logParams(possesedSchema.schema);
    const serialNumber = serialNode[nodeparams('sku')];
    if (!serialNumber) {
      return searchedStations;
    }
    const search = {
      station: this.getId(stationNode.station),
      asset: { '!': null },
      serial_bind: null
    };
    const stationAssets = await this.find().where(search);
    const stationSchemas = await this.getSchemasFromAssetStations(
      stationAssets
    );
    const sendStations = [];
    for (let i = 0; i < stationSchemas.length; i++) {
      const stationSchema = stationSchemas[i];
      const stations = await this.searchForDanglingAssetStation(
        serialNumber,
        stationSchema
      );
      if (stations && stations.length) {
        sendStations.push(...stations);
        break;
      }
    }
    return sendStations;
  },

  deepSearchStationAsset: async function(serial = {}) {
    const allValues = await NodeSerial.fillInAllAssetValues(serial);
    const assets = await this.getSerialAssetStation(allValues);
    if (!assets || !assets.length) {
      return null;
    }
    const stationNode = allValues.owned_by_node;
    const search = {
      station: this.getId(stationNode.station),
      serial_bind: null,
      asset: assets.map(a => this.getId(a))
    };
    return this.find().where(search);
  },

  doSearchOnDanglingAsset: async function(serial) {
    const station_asset = serial.station_asset;
    if (station_asset) {
      return this.find().where({ id: station_asset });
    }
    const assets = await this.deepSearchStationAsset(serial);
    if (!assets || !assets.length) {
      return null;
    }
    return assets;
  },

  unbindAllSerialAssetValues: async function(serial = {}) {
    if (serial.station_asset) {
      await this.update({ id: serial.station_asset }, { serial_bind: null });
    }
    return this.updateSetSerialBind(serial);
  },

  bindAllSerialAssetValues: async function(serial = {}, stationAsset) {
    const id = this.getId(stationAsset);
    if (id) {
      await this.update({ id: id }, { serial_bind: this.getId(serial) });
    }
    return this.updateSetSerialBind(serial, stationAsset);
  },

  applyBindingAfterCountAlteration: async function(serial = {}) {
    if (!serial.unique || !serial.id) {
      return;
    }
    if (serial.quantity <= 0) {
      return this.unbindAllSerialAssetValues(serial);
    }
    const stationAssets = await this.doSearchOnDanglingAsset(serial);
    if (!stationAssets) {
      return this.unbindAllSerialAssetValues(serial);
    }
    const stationAsset = stationAssets.pop();
    if (stationAsset) {
      serial.station_asset = this.getId(stationAsset);
      return this.bindAllSerialAssetValues(serial, stationAsset);
    }
    return this.unbindAllSerialAssetValues(serial);
  },

  afterCreate: async function(values, next) {
    if (values.asset && values.serial_bind) {
      const helpers = Module._helpers.logistics();
      const aHelpers = Module._helpers.logistics('asset_parameter');
      const asset = await Station.findOneById(values.asset).populate(
        'station_type'
      );
      const assetParams = aHelpers.logParams(asset.station_type.schema);
      const serial_bind = await NodeSerial.findOneById(
        values.serial_bind
      ).populate('possessed_by_schema');

      if (!serial_bind) {
        return next();
      }

      try {
        await this.updateSetSerialBind(serial_bind, values);
        const serialParams = helpers.logParams(
          serial_bind.possessed_by_schema.schema
        );
        const node = await Node.findOneById(
          serial_bind.possessed_by_node,
          serial_bind.possessed_by_schema
        );
        if (_.size(node) && assetParams('serial')) {
          asset.parents = [Station.getId(values.station)];
          asset.schema = asset.schema || {};
          asset.schema[assetParams('serial')] = node[serialParams('sku')];
          await Station.saveAsync(asset);
        }
      } catch (e) {
        sails.log.error('StationAsset.afterCreate ERROR', e);
      }
    }
    next();
  }
};
