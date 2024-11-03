const { TimeUtils } = require('similie-api-services');
const now_ = TimeUtils.constants.now_;

class VideoStreamCollector {
  _station;
  _nodemap = {};
  constructor(station) {
    this._station = station;
  }

  get station() {
    return this._station;
  }

  async findDevices() {
    const deviceMaps = await DeviceMap.find()
      .where({
        station: Model.getId(this.station)
      })
      .populateAll();
    return deviceMaps;
  }

  async getDeviceMap() {
    const devices = await this.findDevices();
    const dMap = {};

    if (!devices || !devices.length) {
      return dMap;
    }

    for (let i = 0; i < devices.length; i++) {
      const d = devices[i];
      const device = d.device;
      if (!device) {
        continue;
      }
      const serial = device.serial_number;
      this._nodemap[serial] = d.node;
      dMap[serial] = device;
    }
    return dMap;
  }

  get today() {
    return TimeUtils.isoFormattedDate(now_);
  }

  formatTime() {
    const today = this.today;
    const split = today.split('-');
    const daySplit = split[2].split('T');
    return {
      year: split[0],
      month: split[1],
      day: daySplit[0]
    };
  }

  async fillNodes(values) {
    values.forEach(v => {
      v._node = this._nodemap[v.device];
    });
  }

  async findAll(limit = 0, skip = 0, sort = null) {
    const dMap = await this.getDeviceMap();
    const keys = Object.keys(dMap);
    if (!keys.length) {
      return [];
    }
    const query = {
      device: keys
    };
    const captures = VideoCapture.find().where(query);
    if (limit) {
      captures.limit(limit);
    }
    if (sort) {
      captures.sort(sort);
    }

    if (skip) {
      captures.skip(skip);
    }

    const values = await captures;
    await this.fillNodes(values);
    return values;
  }

  async findToday() {
    const dMap = await this.getDeviceMap();
    const keys = Object.keys(dMap);
    if (!keys.length) {
      return [];
    }
    const query = this.formatTime();
    query.device = keys;
    const captures = await VideoCapture.find().where(query);
    await this.fillNodes(captures);
    return captures;
  }
}

module.exports = { VideoStreamCollector };
