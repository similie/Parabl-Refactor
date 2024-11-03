const { poStates } = require('./purchase-order-states');

const { PurchaseOrderPrivates } = require('./purchase-order-private');

class PurchaseOrderUtility {
  static poStates() {
    return poStates();
  }

  static costRequestTemplate(po, rejection) {
    const request = {
      costcode: rejection.costcode,
      statement_of_purpose: po.request_memo,
      submittal_files: po.request_files,
      target: PointOfSale.getId(po),
      model: 'purchaseorder',
      rule: Model.getId(rejection),
      requested_by: User.getId(po.requester),
      requested_through: User.getId(po.requester),
      coms: false // process.env.NODE_ENV !== "test"
    };
    return request;
  }

  static pullSocketTrackerId() {
    return Tracker.findCodeBody('short');
  }

  static getStateUpdateMessage(po = {}, from = false) {
    const verb = from ? 'from' : 'to';
    return `po-altered-${po[verb]}`;
  }

  static sendUpdateMessageToBothParties(po, message) {
    sails.sockets.blast(PurchaseOrderUtility.getStateUpdateMessage(po, true), {
      ...message,
      direction: 'from'
    });
    sails.sockets.blast(PurchaseOrderUtility.getStateUpdateMessage(po), {
      ...message,
      direction: 'to'
    });
  }

  static setItemCount(values) {
    let total = 0;
    const items = values.items || [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      item.max_quantity = item.quantity;
      total += item.quantity;
    }
    return total;
  }

  static buildNodeCache() {
    return PurchaseOrderPrivates.buildNodeCache(...arguments);
  }

  local = null;
  constructor(po) {
    this.local = new PurchaseOrderPrivates(po);
  }

  get po() {
    return this.local.po;
  }

  set po(values) {
    this.local.po = values;
  }

  applyRejection() {
    return this.local.applyRejection();
  }

  calculateCosts() {
    return this.local.calculateCosts();
  }

  pendingState() {
    return this.local.pendingState();
  }

  moveCompleteExternal() {
    return this.local.finalizeMoveCompleteExternal();
  }

  moveComplete() {
    return this.local.moveComplete();
  }

  completeState() {
    return this.local.completeState();
  }

  shippedState() {
    return this.local.shippedState();
  }

  applyProjectedCosts() {
    return this.local.applyProjectedCosts();
  }

  moveTemp() {
    return this.local.moveTemp();
  }

  moveRevert() {
    return this.local.moveRevert();
  }
}

module.exports = { PurchaseOrderUtility };
