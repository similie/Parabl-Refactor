/**
 * DeviceTracker.js
 *
 * @description :: TODO: You might write a short summary of how this model works and what it represents here.
 * @docs        :: http://sailsjs.org/documentation/concepts/models-and-orm/models
 */

module.exports = {
  attributes: {
    device: {
      model: 'device',
      required: true
    }
  },

  isCarryDevice: function(params, carryDevice) {
    const selectKey = Device.primarySelectKey();
    return (
      !params.device ||
      (carryDevice[selectKey] && carryDevice[selectKey] === params.device)
    );
  },

  formatDeviceCreation: function(devices = []) {
    return devices.map(d => {
      return { device: this.getId(d) };
    });
  },

  createPayloadDevice: async function(params = {}, carryDevice = {}) {
    if (this.isCarryDevice(params, carryDevice)) {
      return this.create({ device: this.getId(carryDevice) });
    }
    const selectKey = Device.primarySelectKey();
    const foundDevices = await Device.find().where({
      [selectKey]: params.device
    });
    const buildDevies = foundDevices.length ? foundDevices : [carryDevice];
    const devices = this.formatDeviceCreation(buildDevies);
    return this.create(devices);
  }
};
