/**
 * DeviceController
 *
 * @description :: Server-side logic for managing Devices
 * @help        :: See http://sailsjs.org/#!/documentation/concepts/Controllers
 */
const { TimeUtils } = require('similie-api-services');
const now_ = TimeUtils.constants.now_;

const { _red, _assign, _beat, _config, _delivery, _telemetry, _sensor, _getCurrentDateQuery, _search } = require('../model-utilities/devices/device-controller')

module.exports = {
  test(req, res) {
    res.send("test")
  },
  red: async function(req, res) {
    const result = _red(req.params.all())
    return res.send(result);
  },

  assign: async function(req, res) {
    const method = req.method;
    const params = req.params.all();
    try {
      const result = await _assign(method, params);
      return res.send(result)
    } catch {
      res.serverError();
    }
  },

  beat: async function(req, res) {
    const params = req.params.all();
    await _beat(access_key, params)
    res.ok();
  },

  reboot: function(req, res) {
    Device.reboot(req, res);
  },

  config: async function(req, res) {
    const params = req.params.all();
    const access_key = req.headers.authentication || params.access_key;
    try {
      const meta = await _config(access_key)
      res.send(meta);
    } catch {
      return res.badRequest('warning.DEVICE_NOT_FOUND');
    }
  },

  delivery: async function(req, res) {
    const access_key = req.headers.authentication;
    const params = req.params.all();
    try {
      await _delivery(req.method, access_key, params, req, res)
    } catch (e) {
      if (e.message === 'ROUTE_UNDEFINED') {
        return res.notFound({
          error: 'errors.ROUTE_UNDEFINED'
        });
      } else if (e.message === 'ACCESS_KEY_REQUIRED') {
        return res.forbidden({
          error: 'errors.ACCESS_KEY_REQUIRED'
        });
      } else {
        res.send({ error: e.message });
      }
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
    try {
      const telemetries = await _telemetry(req.method, access_key, params)
      res.ok(telemetries);
    } catch {
      res.notFound({
        error: 'errors.ROUTE_UNDEFINED'
      });
    }
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
    console.log(params);
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
    try {
      await _sensor(method, params)
      res.ok({ success: true })
    } catch(e) {
      if (e.message === 'serverError') {
        res.serverError();
      } else {
        res.serverError({ error: true });
      }
    }
  },

  getCurrentDateQuery: async (req, res) => {
    const params = req.params.all();
    return await _getCurrentDateQuery(req);
  },

  getActiveQuery: async req => {
    const params = req.params.all();

    return _getActiveQuery(params);
  },

  getOnlineOfflineQuery: async req => {
    const params = req.params.all();
    return _getOnlineOfflineQuery(params);
  },

  search: async function(req, res) {
    const params = req.params.all();

    try {
      const data = await _search(params)
      console.log(data);
      res.json(data);
    } catch (e) {
      return res.serverError({ error: true, message: e.message });
    }
  }
};
