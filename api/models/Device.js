/**
 * Device.js
 *
 * @description :: TODO: You might write a short summary of how this model works and what it represents here.
 * @docs        :: http://sailsjs.org/documentation/concepts/models-and-orm/models
 */

const uuid = require('uuid');
const shortid = require('shortid');

const sailsExtensions = require('../services/SailsExtensions');
const { TimeUtils, SqlUtils, CommonUtils } = require('similie-api-services');
const {
  WLDeviceTankView,
  WLDeviceWeeklyPercentageView
} = require('../model-utilities/devices/device-story-modules/device-story-modules');
const {
  DeviceActions
} = require('../model-utilities/early-warning/devices/deviceactions');
const { Common } = require('../model-utilities/common/common');
const now_ = TimeUtils.constants.now_;
const tz = TimeUtils.constants.timeZone;
const Formats = TimeUtils.constants.formats;

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    callback_url: {
      type: 'string'
    },

    serial_number: {
      type: 'string'
    },

    sku_number: {
      type: 'string'
    },

    secret_key: {
      type: 'string'
    },

    access_key: {
      unique: true,
      type: 'string'
    },

    ip_address: {
      type: 'ip'
    },

    sms_number: {
      type: 'string',
      maxLength: 25
      //  unique: true
    },

    active: {
      type: 'boolean',
      defaultsTo: true
    },

    owner: {
      model: 'user'
    },

    external_device_type: {
      model: 'variable'
    },

    external_device_model: {
      model: 'variable'
    },

    command_phrase: {
      type: 'string',
      maxLength: 20
      //  unique: true
    },

    domain: {
      model: 'domain'
    },

    integrations: {
      type: 'json'
    },

    notes: {
      type: 'text'
    },

    check_interval: {
      type: 'boolean'
    },

    tunnels: {
      type: 'json'
    },

    meta: {
      type: 'json'
    },

    config: {
      type: 'json'
    },

    sensors: {
      collection: 'sensor'
    },

    validateSecret: function(secret, next) {
      const device = this.toObject();
      CommonUtils.security.comparePassword(secret, device.secret_key, next);
    },

    toJSON: function() {
      const device = this.toObject();
      delete device.secret_key;
      return device;
    }
  },

  parseParamsPayload: function(req) {
    const params = req.params.all();
    return _.isString(params.payload)
      ? JSON.parse(params.payload)
      : params.payload;
  },

  getDateForPayload: function(payload, req) {
    const params = req.params.all();
    const date = payload.date || params.date || now_;
    return Node.formatDateParam(date);
  },

  formatConfig: function(device = {}) {
    const meta = device.meta || {};
    for (const key in meta) {
      const m = meta[key];
      if (!_.isFinite(parseFloat(m))) {
        continue;
      }
      meta[key] = parseFloat(m);
    }
    meta.current_t = TimeUtils.formattedDate(now_, Formats.Device);
    return meta;
  },

  simplifyBuild: async function(req, res) {
    const params = req.params.all();
    const deviceID = params.device;
    if (!deviceID) {
      throw new Error('Device ID not submitted');
    }
    const device = await Device.findOne({ serial_number: deviceID });

    if (!device) {
      throw new Error('Device not found');
    }
    req.headers.authentication = device.access_key;
    const payload = this.parseParamsPayload(req);
    payload.date = this.getDateForPayload(payload, req);
    req.body = payload;
    res.locals.device = device;
  },

  applyTunnelsToDevice: async function(device, params) {
    const tunnels = device.tunnels || {};
    tunnels.time = TimeUtils.isoFormattedDate(now_);
    Device.setTunnel(device, tunnels);
    Device.deviceLog(device, params, 'Delivery');
  },

  findStationBasedOnDevice: async function(params = {}) {
    if (params.id || params.station) {
      return params.id || params.station;
    }

    const deviceSerial = params.device;
    if (!deviceSerial) {
      return null;
    }
    const devices = await this.find({ serial_number: deviceSerial });
    for (let i = 0; i < devices.length; i++) {
      const device = devices[i];
      const maps = await DeviceMap.find({ device: this.getId(device) });
      for (let j = 0; j < maps.length; j++) {
        const map = maps[j];
        if (map.station) {
          return map.station;
        }
      }
    }
    return null;
  },

  primarySelectKey: function() {
    return 'serial_number';
  },

  stationDeviceMap: async function(station) {
    const query = `SELECT DISTINCT d.node, d.device, d.station, ns.name, ns.title FROM "devicemap" d
    LEFT JOIN "nodeschema" ns on(d.node = ns.id) WHERE d.station = %s`;
    /**
     *  const query = `SELECT DISTINCT d.node, d.device, d.station, ns.name, ns.title FROM "devicemap" d
        JOIN "nodeschema" ns on(d.node = ns.id) WHERE d.station = %s AND d.node IS NOT NULL`;
     */
    const escape = SqlUtils.escapeUtil();
    const _dMap = await Device.queryAsync(escape(query, this.getId(station)));
    return _dMap.rows;
  },

  findFirstAndLastValuesQuery: function(devices = []) {
    const escape = SqlUtils.escapeUtil();
    const query = escape(
      `SELECT "device", MAX("createdAt"), MIN("createdAt") FROM "devicetracker" WHERE "device" %s GROUP BY 1;`,
      SqlUtils.setInString(devices)
    );
    return query;
  },

  findFirstAndLastValues: async function(devices = []) {
    const query = this.findFirstAndLastValuesQuery(
      devices.map(d => this.getId(d))
    );
    const results = await this.queryAsync(query);
    return results.rows;
  },

  mergeDeviceValues: function(
    deviceMap = [],
    devices = [],
    firstAndLastReads = []
  ) {
    const deviceCanche = Common.buildBasicItemCache(deviceMap, 'device');
    const firstAndLastReadsCache = Common.buildBasicItemCache(
      firstAndLastReads,
      'device'
    );
    for (let i = 0; i < devices.length; i++) {
      const device = devices[i];
      const id = this.getId(device);
      device.__applied_device = deviceCanche[id];
      device.__readings = firstAndLastReadsCache[id];
    }
    return devices;
  },

  findDevicesForStation: async function(station = {}) {
    const deviceMap = await this.stationDeviceMap(station);
    if (!deviceMap.length) {
      return [];
    }
    const deviceIds = deviceMap.map(dm => this.getId(dm.device));
    const devices = await this.find()
      .where({ id: deviceIds })
      .populateAll();
    const firstAndLastReads = await this.findFirstAndLastValues(deviceIds);
    return this.mergeDeviceValues(deviceMap, devices, firstAndLastReads);
  },

  storyModules: function(identity, context = {}) {
    const modules = {
      tankLevelDisplay: async function() {
        const wlTview = new WLDeviceTankView(context);
        const values = await wlTview.process();
        return values;
      },
      wLWeeklyPercentage: async function() {
        const wl = new WLDeviceWeeklyPercentageView(context);
        const values = await wl.process();
        return values;
      }
    };
    const module = modules[identity];
    if (!module) {
      throw new Error(`Station Story Module ${identity} not found`);
    }
    return module;
  },

  deviceStationMap: async function(device) {
    const query = `SELECT DISTINCT d.node, d.device, d.station, ns.name FROM "devicemap" d
    JOIN "nodeschema" ns on(d.node = ns.id) WHERE d.device = %s`;
    const escape = SqlUtils.escapeUtil();
    const _dMap = await Device.queryAsync(escape(query, Device.getId(device)));
    return _dMap.rows;
  },

  testFailThreshold: function(deviceStationMap, thresholdMap) {
    const size = _.size(deviceStationMap);
    if (!size) {
      thresholdMap.current++;
    }

    if (thresholdMap.current >= thresholdMap.max) {
      throw new Error('errors.DEVICE_NOT_ASSIGNABLE');
    }

    return size > 0;
  },

  buildCreationsOffMaps: async function(deviceStationMap, device, req, res) {
    const params = req.params.all();
    const creations = [];
    for (let i = 0; i < _.size(deviceStationMap); i++) {
      const map = deviceStationMap[i];
      const dId = Device.getId(map.device);
      const node = map.node;
      const model = map.name;
      const create = _.clone(params);
      const domain = device.domain;

      if (!_.size(create)) {
        continue;
      }
      create.station = this.getId(map.station);
      create.__model = this.getId(map.node);
      create.__device__ = dId;
      create.observer = User.getId(req.user);
      create.domain = Domain.getId(domain);
      try {
        const created = await Node.create(create, req, res);
        if (this.wantsBlast(req, created)) {
          const blasts = Node.blasts(created, req);
          blasts.blastCreatedNodeToStation(model, map.station);
          blasts.renderBirth(model, map.station);
          blasts.blastParentsWithBirth(model, node);
        }
        const send = await this.sendToModules(req, res, model, created);
        creations.push(send);
      } catch (e) {
        sails.log.error(e);
        continue;
      }
    }
    return creations;
  },

  wantsBlast: function(req, created) {
    return req._sails.hooks.pubsub && _.size(created);
  },

  sendToModules: async function(req, res, model, create) {
    const send = await (
      Modules[model] ||
      function(_req, _res, _sails, send) {
        return new Promise(resolve => {
          resolve(send);
        });
      }
    )(req, res, sails, create);
    return send;
  },

  setTunnel: async function(device, tunnels) {
    return await Device.update(
      { id: Device.getId(device) },
      { tunnels: tunnels }
    );
  },

  deviceLog: function(device, item, source) {
    sails.sockets.blast(`realtime-device-creation-${Device.getId(device)}`, {
      id: Model.getId(device),
      source: source || 'created',
      data: item,
      time: TimeUtils.isoFormattedDate(now_)
    });
  },

  setCache: function(deviceId, ews, cache) {
    cache[deviceId] = {
      [Station.getId(ews.station)]: {
        [NodeSchema.getId(ews.node)]: true
      }
    };
  },

  cacheContain: function(deviceId, ews, cache) {
    const station = Model.getId(ews.station);
    const node = Model.getId(ews.node);
    const has = !!(
      cache[deviceId] &&
      cache[deviceId][station] &&
      cache[deviceId][station][node]
    );
    return has;
  },

  returnCallback: (cb, ...params) => {
    (cb || _.noop)(...params);
  },

  doAction: async function(ew, end, domain) {
    try {
      const da = new DeviceActions(ew, end);
      const data = await da.createAction(domain);
      const created = await DeviceAction.create(data);
      return created;
    } catch (e) {
      sails.log.error('Device::doAction Error', e);
      return null;
    }
  },

  /**
   * Using this method, you will have devices which doesn't report in last given-"interval".
   *
   * Flow:
   *   1. Get the most recent device's report for each device
   *   2. Given those reports, find the report which submitted other than given interval (`last n hours`)
   *   3. Given those filtered reports, find the device associated with the report and return them as an array
   *
   * @param {string} timezone
   * @param {string} interval
   *
   * @returns {Promise<Array<{
   *  device: number
   *  id: number
   *  domain: string
   *  serial_number: string
   *  notes: string
   *  email: string
   *  name: string
   *  owner: number
   * }>>}
   */
  async getMissingReport(timezone, interval) {
    const defaultDomain = await Domain.getDefaultDomain();

    return new Promise((resolve, reject) => {
      const queryAlt = `SELECT
      d."id" AS "id",
      d."domain" AS "domain",
      d."serial_number" AS "serial_number",
      d.notes AS "notes",
      COALESCE(o.name, '${defaultDomain.name}' ) AS "domain_name"
    FROM
      device d
      LEFT JOIN "domain" o ON ( o.ID = d.DOMAIN ) 
    WHERE
      d."id" NOT IN (
      SELECT
        "device" 
      FROM
        "devicetracker" dt 
      WHERE
        ( "dt"."createdAt" AT TIME ZONE '${timezone}' ) > ( ( NOW( ) AT TIME ZONE '${timezone}' ) - INTERVAL '${interval}'  ) 
      GROUP BY
      "dt"."device" 
      ) 
      AND d.active = TRUE
      AND d.check_interval = TRUE
    ORDER by d."domain" ASC NULLS FIRST;`;
      DeviceTracker.query(queryAlt, (err, rows) => {
        if (err) return reject(err);
        const devices = (rows || []).rows;
        resolve(devices);
      });
    });
  },

  getMailingAdmin() {
    return new Promise((resolve, reject) => {
      const queryAlt = `
      SELECT 
	      d.user,
	      u.email,
	      u.first_name,
	      u.last_name,
        u.preferred_language,
	      array_agg(d.domain ORDER BY d.domain ASC NULLS FIRST) as domains
      FROM 
        mailingadmin d
	    LEFT JOIN "user" u ON ( u.ID = d.USER )
      GROUP BY d.user, u.id`;

      MailingAdmin.query(queryAlt, (err, rows) => {
        if (err) return reject(err);
        const MailingAdmin = (rows || []).rows;
        resolve(MailingAdmin);
      });
    });
  },

  /*
   * These will be part of
   */
  _timers: [
    {
      interval: Const.timers.DAILY,
      name: 'device_check',
      action: function(_sails) {
        return {
          do: function() {
            Jobs.deviceIntervalCheck.add();
          }
        };
      }
    }
  ],

  _processors: [
    {
      name: 'deviceIntervalCheck',
      process: async function() {
        const mailingAdmin = await Device.getMailingAdmin();

        // Don't proceed if we don't have admin
        if (_.size(mailingAdmin) === 0) return;

        const devices = await Device.getMissingReport(tz, '24 hours');
        // Don't proceed if we found nothing
        if (_.size(devices) === 0) return;

        // // Here, we filter the devices, we want to exclude device which doesn't have owner,
        // // then we group by the owner's email
        const reports = _.groupBy(
          devices.filter(d => d.domain_name),
          d => d.domain_name
        );

        // TODO: temporary commented for testing
        // Here, we "convert" the object to an array, so we can 'Array.map' it.
        const reportCollection = Object.keys(reports).map(domain => {
          const devices = reports[domain];
          const ownerFields = ['domain', 'domain_name'];

          return {
            domain: _.pick(devices[0], ownerFields),
            devices: devices.map(device => _.omit(device, ownerFields))
          };
        });

        const reportData = mailingAdmin.map(admin => {
          return {
            owner: admin,
            email: admin.email,
            reports:
              admin.domains && admin.domains.length
                ? reportCollection.filter(device =>
                    admin.domains.includes(device.domain.domain)
                  )
                : reportCollection
          };
        });

        // Thank you, for making me this sick async version
        // Not sure why we use the first found domain here, but yeah, I'll leave like it "was"
        const config = await Site.thisSiteAsync(devices[0].domain);

        // Here we populate all variables needed before we iterate the `reportCollection`,
        // so the computation time would be reduced.
        const { site_name, default_language } = config;

        const today = TimeUtils.formattedDate(now_, Formats.Date.medium);
        const host = CommonUtils.pullHost(config);

        // Here's why the object converted to array.
        // We use `Promise.all([Promise])` technique here.
        // The promises themselves come from `Array.map`.
        // Now you know how it works, happy coding!
        const results = await Promise.all(
          reportData.map(
            value =>
              new Promise(async (resolve, reject) => {
                const name = User.fullName(value.owner);
                const emailParameters = {
                  to: {
                    address: value.email,
                    name
                  },
                  locals: {
                    name,
                    site_name,
                    today,
                    host
                  },
                  data: value.reports,
                  default_language:
                    value.owner.preferred_language || default_language,
                  template: 'device_tracker',
                  variables: Email.variables.device_tracker.key,
                  tags: ['device report', 'failed devices']
                };

                try {
                  await Jobs.sendEmail.add(emailParameters);

                  resolve(emailParameters);
                } catch (error) {
                  reject(error);
                }
              })
          )
        );

        return results;
      },

      stats: sailsExtensions.stats({
        completed: function(job, result) {
          // Utils.sendReport(null, result);
        },
        failed: function(job, err) {
          console.error('JOB ERROR::', err);
          // Utils.sendexcelMessage(err, job.data);
        }
      })
    }
  ],

  getPhrase: function(values, next) {
    if (values.id && !values.command_phrase) {
      Device.findOneById(values.id).exec((err, dev) => {
        if (err) {
          return next(err);
        }

        const phrase = dev.command_phrase;

        next(null, phrase);
      });
    } else if (values.command_phrase) {
      return next(null, values.command_phrase);
    } else {
      return next();
    }
  },

  reboot: function(req, res) {
    const params = req.params.all();

    const user = req.user;
    const domain = res.locals.domain;

    if (!User.is(user, Roles.MANAGER)) {
      return res.forbidden('warning.ACCESS_DENIED');
    }

    if (!params.id) {
      return res.badRequest('warning.ID_REQUIRED');
    }

    Device.findOneById(params.id).exec((err, dev) => {
      if (err) {
        return res.negotiate(err);
      }

      if (!dev) {
        return res.badRequest('warning.NO_DEVICE_FOUND_WITH_ID');
      }

      if (dev.sms_number) {
        const payload = 'device_reboot%' + dev.command_phrase;
        Sms.send(dev.sms_number, payload, null, dev, domain);
      }

      res.ok();
    });
  },

  change_phrase: function(values, next) {
    if (values.id) {
      Device.findOneById(values.id).exec((err, dev) => {
        if (err) {
          return next(err);
        }

        const number = values.sms_number || dev.sms_number;

        if (number && values.command_phrase !== dev.command_phrase) {
          const payload =
            'change_command_phrase%' +
            dev.command_phrase +
            '%' +
            values.command_phrase;
          Sms.send(number, payload, null, values, dev.domain);
        }
        next();
      });
    } else if (values.sms_number) {
      const payload = 'change_command_phrase%' + values.command_phrase + '%';
      Sms.send(values.sms_number, payload, null, values, values.values);
      return next();
    } else {
      return next();
    }
  },

  pass_hash: function(values, next) {
    CommonUtils.security.hashPassword(values.secret_key, (err, key) => {
      if (err) {
        return next(err);
      }
      const last_time = values.secret_key;
      values.secret_key = key;
      if (values.sms_number) {
        Device.getPhrase(values, (err, phrase) => {
          if (err) {
            return next(err);
          }

          const payload =
            'change_authorization%' +
            phrase +
            '%' +
            values.access_key +
            '%' +
            last_time;
          Sms.send(values.sms_number, payload, null, values, values.domain);
          next();
        });
      } else {
        return next();
      }
    });
  },

  generate: function() {
    const gen = {
      access_key: shortid.generate() /* CommonUtils.security.apiToken() */,
      secret_key: uuid.v4() /* CommonUtils.security.uuid() */
    };

    return gen;
  },

  beforeCreate: function(values, next) {
    if (!values.secret_key) {
      return next('errors.SECRET_KEY_INVALID');
    }

    this.pass_hash(values, function() {
      if (values.command_phrase) {
        this.change_phrase(values, next);
      } else {
        return next();
      }
    });
  },

  beforeUpdate: function(values, next) {
    if (values.secret_key && values.changeSecret) {
      this.pass_hash(values, next);
    } else if (values.command_phrase) {
      this.change_phrase(values, next);
    } else {
      return next();
    }
  },

  afterDestroy: async function(values, next) {
    const devices = Array.isArray(values) ? values : [values];
    for (let i = 0; i < devices.length; i++) {
      const id = this.getId(devices[i]);
      if (!id) {
        continue;
      }
      await DeviceMap.destroy().where({ device: id });
    }
    next();
  }
};
