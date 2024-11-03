/**
 * DeviceController
 *
 * @description :: Server-side logic for managing Devices
 * @help        :: See http://sailsjs.org/#!/documentation/concepts/Controllers
 */

const { TimeUtils } = require('similie-api-services');
const now_ = TimeUtils.constants.now_;

module.exports = {
  red: async function(req, res) {
    const params = req.params.all();
    return res.send(params);
  },

  assign: async function(req, res) {
    const method = req.method;
    const params = req.params.all();
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
      if (!_.size(updated)) {
        return null;
      }
      const send = _.isArray(updated) ? updated.pop() : updated;
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
        return res.send(await getDevice());
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
        return res.send(await destroyDevice(q));
      case 'POST':
        if (!dId) {
          return res.badRequest({
            errors: 'A device identity is required'
          });
        }
        return res.send(
          await createDevices({
            device: dId,
            station: sId,
            node: nId,
            station_only: params.station_only || false
          })
        );
      case 'PUT':
        try {
          return res.send(await putDevice());
        } catch (e) {
          return res.badRequest({ error: e.message });
        }

      default:
        res.serverError();
    }
  },

  beat: async function(req, res) {
    let params = req.params.all();
    if (_.isString(params)) {
      params = JSON.parse(params);
    }

    const access_key = req.headers.authentication || params.access_key;
    if (!access_key) {
      return res.badRequest();
    }

    const hosts = [];
    _.each(params.tunnels, t => {
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
    res.ok();
  },

  reboot: function(req, res) {
    Device.reboot(req, res);
  },

  config: function(req, res) {
    const params = req.params.all();
    const access_key = req.headers.authentication || params.access_key;
    Device.findOne({
      access_key: access_key
    }).exec((err, found) => {
      if (err) {
        return res.serverError(err);
      }
      if (!found) {
        return res.badRequest('warning.DEVICE_NOT_FOUND');
      }
      const meta = Device.formatConfig(found);
      res.send(meta);
    });
  },

  delivery: async function(req, res) {
    if (req.method !== 'POST') {
      return res.notFound({
        error: 'errors.ROUTE_UNDEFINED'
      });
    }

    const access_key = req.headers.authentication;
    if (!access_key) {
      return res.forbidden({
        error: 'errors.ACCESS_KEY_REQUIRED'
      });
    }
    const params = req.params.all();
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
      return res.send({ error: e.message });
    }
  },

  generate: function(_req, res) {
    res.send(Device.generate());
  },

  simplify: async function(req, res) {
    try {
      await Device.simplifyBuild(req, res);
    } catch (e) {
      sails.log.debug('Device.simplify::error::', e.message);
      return res.notFound({ error: e.message });
    }
    this.delivery(req, res);
  },

  telemetry: async function(req, res) {
    if (req.method !== 'POST') {
      return res.notFound({
        error: 'errors.ROUTE_UNDEFINED'
      });
    }

    const params = req.params.all();
    const access_key = req.headers.authentication;
    if (!access_key) {
      return res.forbidden({
        error: 'errors.ACCESS_KEY_REQUIRED'
      });
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
    for (let i = 0; i < _.size(devices); i++) {
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

    res.ok(telemetries);
  },

  simplifytelemetry: async function(req, res) {
    try {
      await Device.simplifyBuild(req, res);
    } catch (e) {
      sails.log.error(e.message);
      return res.serverError({ error: e.message });
    }
    this.telemetry(req, res);
  },

  diagnostic: async function(req, res) {
    const params = req.params.all();

    try {
      const diagnostic = await ParticleAPI.getDeviceDiagnostic(
        res,
        params.serial
      );

      return res.send(diagnostic);
    } catch (e) {
      sails.log.error(e);
      res.badRequest({ error: e.message });
    }
  },

  detail: async function(req, res) {
    const params = req.params.all();
    const diagnostic = await ParticleAPI.getDeviceDetail(res, params.serial);

    return res.send(diagnostic);
  },

  callSensor: async function(req, res) {
    const params = req.params.all();
    const diagnostic = await ParticleAPI.callFunction(res, params);

    return res.send(diagnostic);
  },

  sensor: async function(req, res) {
    const method = req.method;
    const params = req.params.all();
    const id = params.id;
    const sensorId = params.sensorId;

    Device.findOne({ id })
      .then(function(device) {
        switch (method) {
          case 'POST':
            device.sensors.remove(sensorId);
            break;
          case 'PUT':
            device.sensors.add(sensorId);
            break;
          default:
            return res.serverError();
        }

        return device.save();
      })
      .then(() => res.ok({ success: true }))
      .fail(function(err) {
        sails.log.error('Unexpected error: ' + err);
        return res.serverError({ error: true });
      });
  },

  getCurrentDateQuery: async (req, res) => {
    const params = req.params.all();
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

  getActiveQuery: async req => {
    const params = req.params.all();
    const query = params.query.toLowerCase();
    const containActive = query.includes('active');
    const isActive = containActive ? !(params.query === 'inactive') : true;

    return containActive ? { active: isActive } : null;
  },

  getOnlineOfflineQuery: async req => {
    const params = req.params.all();
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

  search: async function(req, res) {
    const params = req.params.all();
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
      if (err) return res.serverError({ error: true, message: err });
      res.json(data);
    });
  }
};
