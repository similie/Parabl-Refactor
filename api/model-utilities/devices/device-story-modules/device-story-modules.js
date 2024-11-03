const { WLDeviceManager } = require('./wl-device-module');
const { WLDeviceWeeklyPercentage } = require('./wl-device-weekly-percentage');

class WLDeviceTankView {
  wlDeviceManager = null;
  constructor(context) {
    this.wlDeviceManager = new WLDeviceManager(context);
  }

  process() {
    return this.wlDeviceManager.process();
  }
}

class WLDeviceWeeklyPercentageView {
  wlDeviceManager = null;
  constructor(context) {
    this.wlDeviceManager = new WLDeviceWeeklyPercentage(context);
  }

  process() {
    return this.wlDeviceManager.process();
  }
}

module.exports = { WLDeviceTankView, WLDeviceWeeklyPercentageView };
