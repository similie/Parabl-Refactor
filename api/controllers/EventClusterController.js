/**
 * EventClusterController
 *
 * @description :: Server-side actions for handling incoming requests.
 * @help        :: See https://sailsjs.com/docs/concepts/actions
 */

const grinder = (devices, deviceCache) => {
  const start = 0;
  const _device = 'device';
  let filtered = [];
  for (let i = start; i < devices.length; i++) {
    const device = devices[i];
    for (let j = start; j < _.size(device.earlywarnings); j++) {
      const ews = device.earlywarnings[j];
      const _dId = Model.getId(ews[_device]);
      if (!_dId) {
        continue;
      }
      if (_.size(deviceCache)) {
        ews.device = deviceCache[_dId];
      } else {
        filtered = _.union([_dId], filtered);
      }
    }
  }
  return (_.size(deviceCache)) ? devices : filtered;
};


module.exports = {

  find: async (req, res) => {
    const ecs = await new Promise((resolve) => {
      Utils.getParser(req, res, resolve);
    });

    const devices = grinder(ecs);

    if (!_.size(devices)) {
      return res.send(ecs);
    }

    const _devices = await Device.find({
      id: devices
    }).populateAll();
    const _dmap = {};
    for (let i = 0; i < _.size(_devices); i++) {
      const _d = _devices[i];
      _dmap[_d.id] = _d;
    }
    const _send = grinder(ecs, _dmap);
    res.send(_send);
  }

};
