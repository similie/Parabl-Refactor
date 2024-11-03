const { AssetPivot } = require('./logistics/asset-pivot');
const { InventoryTypeCounter } = require('./logistics/inventory-type-counter');
const { ItemCounter } = require('./logistics/item-counter');
const {
  LogisticsChartingShared
} = require('./logistics/logistics-charting-shared');
const { MissionReadyness } = require('./logistics/mission-readiness');

class CommonCharts {
  _stations;
  _identity;
  _context;
  _utils;
  constructor(identity, context) {
    this._identity = identity;
    this._context = context;
    this._utils = new LogisticsChartingShared();
    this._stations = this.utils.pullStationsFromContext(context);
  }

  get utils() {
    return this._utils;
  }

  get stations() {
    return this._stations;
  }

  get identity() {
    return this._identity;
  }

  get context() {
    return this._context;
  }

  get assetPivot() {
    return new AssetPivot(this);
  }

  get hasStations() {
    return !!this.stations.length;
  }

  get storyId() {
    return NodeStory.getId(this.context.story);
  }

  get itemCounter() {
    return new ItemCounter(this);
  }

  get inventoryTypeCounter() {
    return new InventoryTypeCounter(this);
  }

  get missionReadiness() {
    return new MissionReadyness(this);
  }
}
module.exports = { CommonCharts };
