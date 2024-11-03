const QRCode = require('qrcode');
const { CommonUtils } = require('similie-api-services');
class WOProcessModel {
  constructor(workorder = {}) {
    this.workorder = workorder;
  }

  getId(value) {
    return WorkOrder.getId(value);
  }

  get workorder() {
    return this._workorder;
  }

  set workorder(workorder) {
    this._workorder = workorder;
  }

  get qrcode() {
    return this._qrcode;
  }

  set qrcode(qrcode) {
    this._qrcode = qrcode;
  }

  get meta() {
    return this.workorder.meta || {};
  }

  get requestManagerName() {
    return this._requestManagerName;
  }

  get facilityManagerName() {
    return this._facilityManagerName;
  }

  get toStation() {
    return this._toStation;
  }

  get fromStation() {
    return this._fromStation;
  }

  get siteConfig() {
    return this._siteConfig;
  }

  get bs64logo() {
    return this._bs64logo;
  }

  set bs64logo(bs64logo) {
    this._bs64logo = bs64logo;
  }

  async pullSiteLogo(domain = undefined) {
    const config = await this.pullSiteConfig(domain);
    const logo = config.logos.navbar;
    const imagePath = _.contains(logo, 'http')
      ? logo
      : `${sails.config.__parentDir}/assets${logo}`;
    const bslogo = await CommonUtils.imaging.encodeImage(imagePath);
    this.bs64logo = 'data:image/png;base64,' + bslogo;
  }

  async pullSiteConfig(domain = undefined) {
    if (this._siteConfig) {
      return this._siteConfig;
    }
    if (domain !== undefined) {
      this._siteConfig = await Site.thisSiteAsync(domain);
    } else {
      const station = await this.pullToStation();
      this._siteConfig = await Site.siteThroughStation(station);
    }
    return this._siteConfig;
  }

  async buildQRCode() {
    this.qrcode = await QRCode.toDataURL(this.workorder.workorder_id);
  }

  async pullNodeSerial() {
    if (this._nodeSerial || this.meta.nodeserial) {
      return this._nodeSerial || this.meta.nodeserial;
    }
    const nId = this.getId(this.workorder.nodeserial);
    if (!nId) {
      return null;
    }
    this._nodeSerial = await NodeSerial.findOneById(nId);
    return this._nodeSerial;
  }

  async getFacilityManagerName() {
    if (this._facilityManagerName) {
      return this._facilityManagerName;
    }
    const manager = await this.stationManager();
    this._facilityManagerName = manager ? User.fullName(manager) : 'No manager';
    return this._facilityManagerName;
  }

  async getRequestManagerName() {
    if (this._requestManagerName) {
      return this._requestManagerName;
    }

    const requestManager = await this.requestManager();
    this._requestManagerName = requestManager
      ? User.fullName(requestManager)
      : 'No manager';
    return this._requestManagerName;
  }

  async requestManager() {
    const fromStation = await this.pullFromStation();
    const fromRquisitions = await Requisition.find({
      role: Roles.MANAGER,
      station: this.getId(fromStation)
    }).populate('user');
    const [user] = fromRquisitions;
    return user;
  }

  async stationManager() {
    const toStation = await this.pullToStation();
    const toRequisitions = await Requisition.find({
      role: Roles.MANAGER,
      station: this.getId(toStation)
    }).populate('user');
    const [user] = toRequisitions;
    return user;
  }

  async pullFromStation() {
    if (this._fromStation) {
      return this._fromStation;
    }
    this._fromStation = await Station.findOne({
      station_id: this.workorder.from
    });
    return this._fromStation;
  }

  async pullToStation() {
    if (this._toStation) {
      return this._toStation;
    }
    this._toStation = await Station.findOne({
      station_id: this.workorder.service_station
    });

    return this._toStation;
  }

  async populateAll() {
    const workorder = await WorkOrder.findOne({
      id: this.getId(this.workorder)
    });
    return workorder;
  }
}

module.exports = { WOProcessModel };
