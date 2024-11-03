const commonUtils = require('../../utils/common');
module.exports = {
  /**
   * Reduces the parameters to a simpler form.
   * @param {Object} params - The parameters to process.
   * @returns {Object} - The processed parameters.
   */
  _red(params) {
    return params
  },
  /**
   * Assigns a device to a station or node based on the method and parameters.
   * @param {string} method - The HTTP method (GET, POST, PUT, DELETE).
   * @param {Object} params - The parameters for the assignment.
   * @returns {Promise<Object|null>} - The result of the assignment operation.
   */
  async _assign(method, params) {
    const sId = Station.getId(params.station);
    const nId = Station.getId(params.node);
    const dId = Station.getId(params.device);
    const id = Station.getId(params);
    const getDevice = async dId => {
      const query = {
        station: sId,
        node: nId,
        station_only: params.station_only || false
      };
      if (dId) {
        query.device = dId;
      }
      const device = await DeviceMap.find()
        .where(query)
        .populateAll();
      return device;
    };

    const destroyDevice = async q => {
      const del = await DeviceMap.destroy(q);
      return del;
    };

    const createDevices = async params => {
      const created = await DeviceMap.create(params);
      return created;
    };

    const putDevice = async () => {
      const current = await getDevice(dId);
      if (current.length) {
        throw new Error('danger.DEVICE_IS_ALREADY_ASSIGNED');
      }
      let q = {};
      let updated;
      if (id) {
        q.id = id;
        updated = await DeviceMap.update(q, {
          device: dId
        });
      } else {
        q = {
          station: sId,
          node: nId,
          device: dId,
          station_only: params.station_only || false
        };
        updated = await DeviceMap.create(q);
      }
      if (!commonUtils.size(updated)) {
        return null;
      }
      const send = commonUtils.isArray(updated) ? updated.pop() : updated;
      const dMap = await DeviceMap.findOneById(
        DeviceMap.getId(send)
      ).populateAll();
      return dMap;
    };

    if ((!sId || (!nId && !params.station_only)) && !id) {
      return res.send(null);
    }
    let q;
    switch (method) {
      case 'GET':
        return await getDevice();
      case 'DELETE':
        q = {};
        if (id) {
          q.id = id;
        } else {
          q = {
            station: sId,
            node: nId
          };
        }
        return await destroyDevice(q);
      case 'POST':
        if (!dId) {
          return res.badRequest({
            errors: 'A device identity is required'
          });
        }
        return await createDevices({
          device: dId,
          station: sId,
          node: nId,
          station_only: params.station_only || false
        });
      case 'PUT':
        try {
          return await putDevice();
        } catch (e) {
          return res.badRequest({ error: e.message });
        }

      default:
        throw new Error('serverError');
    }
  },
  /**
   * Updates the device's tunnels based on the access key and parameters.
   * @param {string} access_key - The access key of the device.
   * @param {Object|string} params - The parameters or JSON string to update.
   * @returns {Promise<void>}
   */
  async _beat(access_key, params) {
    if (commonUtils.isString(params)) {
      params = JSON.parse(params);
    }

    if (!access_key) {
      return res.badRequest();
    }

    const hosts = [];
    commonUtils.each(params.tunnels, t => {
      hosts.push({
        host: t.public_url,
        addr: t.addr,
        proto: t.proto
      });
    });

    await Device.update(
      {
        access_key: access_key
      },
      {
        tunnels: {
          // [SG]time: moment().tz(tz).format(),
          time: TimeUtils.isoFormattedDate(now_),
          hosts: hosts
        }
      }
    );
  },
  /**
   * Retrieves the configuration of a device based on the access key.
   * @param {string} access_key - The access key of the device.
   * @returns {Promise<Object>} - The device configuration.
   * @throws Will throw an error if the device is not found.
   */
  async _config(access_key) {
    const found = await Device.findOne({
      access_key
    })
    if (!found) {
      throw new Error('DEVICE_NOT_FOUND');
    }
    const meta = Device.formatConfig(found);
    return meta;
  },
  /**
   * Handles the delivery of device data based on the method, access key, and parameters.
   * @param {string} method - The HTTP method (should be POST).
   * @param {string} access_key - The access key of the device.
   * @param {Object} params - The parameters for the delivery.
   * @param {Object} req - The request object.
   * @param {Object} res - The response object.
   * @returns {Promise<void>}
   * @throws Will throw an error if the method is not POST or access key is missing.
   */
  async _delivery(method, access_key, params, req, res) {
    if (method !== 'POST') {
      throw new Error('ROUTE_UNDEFINED')
    }

    if (!access_key) {
      throw new Error('ACCESS_KEY_REQUIRED')
    }

    try {
      const devices = await Device.find().where({
        access_key: access_key
      });
      const failThreshold = { max: devices.length, current: 0 };
      const allCreations = [];
      for (let i = 0; i < devices.length; i++) {
        const device = devices[i];
        Device.applyTunnelsToDevice(device, params);
        const dMap = await Device.deviceStationMap(device);
        const tested = Device.testFailThreshold(dMap, failThreshold);
        if (!tested) {
          continue;
        }
        const creations = await Device.buildCreationsOffMaps(
          dMap,
          device,
          req,
          res
        );
        allCreations.push(...creations);
      }
      Node.sendOneOrAll(allCreations, res);
    } catch (e) {
      sails.log.debug('DeviceController.delivery::error', e.message);
      throw new Error(e.message)
    }
  },
  /**
   * Processes telemetry data for a device based on the method, access key, and parameters.
   * @param {string} method - The HTTP method (should be POST).
   * @param {string} access_key - The access key of the device.
   * @param {Object} params - The telemetry parameters.
   * @returns {Promise<Array>} - The processed telemetry data.
   * @throws Will throw an error if the method is not POST.
   */
  async _telemetry(method, access_key, params) {
    if (method !== 'POST') {
      throw new Error('ROUTE_UNDEFINED')
    }

    const device = await Device.findOne({
      access_key: access_key
    });

    Device.applyTunnelsToDevice(device, params);

    const devices = await DeviceMap.find().where({
      device: Device.getId(device),
      station_only: true
    });
    const telemetries = [];
    for (let i = 0; i < commonUtils.size(devices); i++) {
      const dMap = devices[i];
      if (!dMap.station) {
        continue;
      }

      const station = await Station.findOneById(Station.getId(dMap.station));
      const telemetryDraft = {
        station: Station.getId(station),
        ...params
      };
      try {
        const telemetry = await StationTelemetry.create(telemetryDraft);
        const withWords = telemetry.start_session || telemetry.end_session;
        await telemetry.apply(station, withWords);
        telemetries.push(telemetry);
      } catch (e) {
        sails.log.error('DeviceController::telemtry:error', e);
      }
    }
    return telemetries
  },
  /**
   * Manages sensors for a device based on the method and parameters.
   * @param {string} method - The HTTP method (POST or PUT).
   * @param {Object} params - The parameters including device and sensor IDs.
   * @returns {Promise<boolean>} - The result of the sensor operation.
   * @throws Will throw an error if the method is not POST or PUT.
   */
  async _sensor(method, params) {
    const id = params.id;
    const sensorId = params.sensorId;

    const device = awaitDevice.findOne({ id })
    switch (method) {
      case 'POST':
        await device.sensors.remove(sensorId);
        break;
      case 'PUT':
        await device.sensors.add(sensorId);
        break;
      default:
        throw new Error('serverError');
    }
    try {
      await device.save()
      return true
    } catch {
      throw new Error(err)
    }
  },

  /**
   * Constructs a query to filter data based on the current date.
   * @param {Object} params - The parameters including the query string.
   * @returns {Object|null} - The constructed date query or null if invalid.
   */
  async _getCurrentDateQuery(params) {
    const query = params.query.toLowerCase();
    const language = Translates.getLanguage(req, res);
    const varCache = Variable.varCache(
      await Variable.find({
        or: [{ key: 'system_translations' }]
      }),
      language
    );

    let monthData = [
      varCache['labels.JANUARY'],
      varCache['labels.FEBRURARY'],
      varCache['labels.MARCH'],
      varCache['labels.APRIL'],
      varCache['labels.MAY'],
      varCache['labels.JUNE'],
      varCache['labels.JULY'],
      varCache['labels.AUGUST'],
      varCache['labels.SEPTEMBER'],
      varCache['labels.OCTOBER'],
      varCache['labels.NOVEMBER'],
      varCache['labels.DECEMBER']
    ].findIndex(function(item) {
      return item.toLowerCase().includes(query);
    });

    let d = new Date();
    let m = monthData + 1;

    if (monthData === -1) {
      d = new Date(query);
      const isDate = d instanceof Date && !isNaN(d);

      if (!isDate) {
        return null;
      }

      m = d.getMonth() + 1;
      monthData = d.getMonth();
    }

    const y = d.getFullYear();
    const start = new Date(y, monthData, 1);
    const end = new Date(y, m, 1);

    return { updatedAt: { '>': start, '<=': end } };
  },

  /**
   * Constructs a query to filter data based on active status.
   * @param {Object} params - The parameters including the query string.
   * @returns {Object|null} - The constructed active status query or null.
   */
  _getActiveQuery(params) {
    const query = params.query.toLowerCase();
    const containActive = query.includes('active');
    const isActive = containActive ? !(params.query === 'inactive') : true;

    return containActive ? { active: isActive } : null;
  },

  /**
   * Constructs a query to filter data based on online or offline status.
   * @param {Object} params - The parameters including the query string.
   * @returns {Object|null} - The constructed online/offline status query or null.
   */
  _getOnlineOfflineQuery(params) {
    const query = params.query.toLowerCase();
    const containOnline = query.includes('online');
    const containOffline = query.includes('offline');

    const d = new Date();
    d.setMinutes(d.getMinutes() + 11);

    if (containOnline) {
      return { updatedAt: { '>': d, '<=': new Date() } };
    } else if (containOffline) {
      return { updatedAt: { '<': new Date() } };
    }

    return null;
  },

  /**
   * Searches for devices based on the parameters.
   * @param {Object} params - The search parameters including the query string.
   * @returns {Promise<Array>} - The search results.
   */
  async _search(params) {
    const query = params.query.toLowerCase();

    const containDate = await this.getCurrentDateQuery(req, res);
    const containActive = await this.getCurrentDateQuery(req);
    const containOnlineOffline = await this.getOnlineOfflineQuery(req);

    const whereOr = {
      or: [
        { sku_number: { contains: query } },
        { serial_number: { contains: query } },
        { access_key: { contains: query } },
        containDate,
        containOnlineOffline
      ].filter(item => item)
    };

    const where = query ? containActive || whereOr : {};
    let searchQuery;
    if (req.method === 'GET') {
      searchQuery = Device.count();
    } else {
      searchQuery = Device.find()
        .limit(Utils.limit(req))
        .sort(Utils.sort(req))
        .skip(Utils.skip(req));
    }

    searchQuery.where(where).exec(function(err, data) {
      if (err) {
        throw new Error(err)
      }
      return data;
    });
  }
}