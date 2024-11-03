const { poStates } = require('./purchase-order-states');
const { TimeUtils } = require('similie-api-services');
const now_ = TimeUtils.constants.now_;

async function getReplacementTemplate(po, totalReturn, returnItems) {
  const meta = po.meta;
  return {
    name: `${(po.name || '').trim().replace(' (RETURN)')} ${' (RETURN)'}`,
    state: poStates().PROCESSING,
    to: po.to,
    request_memo: po.request_memo,
    vendors: [
      ..._.filter(po.vendors, v => {
        return {
          sku: v.sku,
          externalvendor: v.externalvendor,
          quantity: v.quantity
        };
      })
    ],
    transaction_id: `${po.transaction_id}/ret-${await Tracker.findCodeBody(
      'short'
    )}`,
    items: [...returnItems],
    scope: 'external',
    schema: NodeSchema.getId(po.schema),
    station: Station.getId(po.station),
    parent: PurchaseOrder.getId(po),
    requester: User.getId(meta.return_details.requester || po.requester),
    last_active: User.getId(meta.return_details.requester || po.last_active),
    approver: User.getId(po.approver),
    meta: {
      last_state: poStates().APPROVED,
      itemsCount: totalReturn,
      projected_cost: 0,
      total_actual_item_costs: 0,
      invoice_taxes: 0,
      service_fees: 0,
      additional_fees: 0,
      customs_fees: 0,
      invoice_notes: meta.invoice_notes,
      approved_on: TimeUtils.isoFormattedDate(now_),
      items_costs: [...returnItems]
    }
  };
}

module.exports = { getReplacementTemplate };
