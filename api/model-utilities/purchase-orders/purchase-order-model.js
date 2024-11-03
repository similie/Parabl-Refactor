const { Model } = require('../model/models');

class PurchaseOrderModel extends Model {
  constructor() {
    super('purchaseorder');
  }
}

module.exports = { PurchaseOrderModel };
