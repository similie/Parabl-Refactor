const { buildStationMap, saveNode } = require('./purchase-order-shared');

function calculateCosts(items = [], nodeCache = {}, currency, paramName) {
  let total_cost = 0;
  const itemsCost = {};

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const id = Model.getId(item);
    const node = nodeCache[id] || {};
    const unit_cost = node[paramName] || 0;
    const convertedCost = CostCode.convertCurrency(unit_cost, currency);
    itemsCost[id] = {
      unit_cost: unit_cost,
      converted_cost: convertedCost,
      quantity: item.quantity
    };
    total_cost += convertedCost * item.quantity;
  }

  return {
    ...itemsCost,
    total_cost: total_cost
  };
}

function internalReceiptVariance(receipt) {
  const variants = {};
  const notAssigned = {
    ...receipt.items
  };
  for (const id in receipt.countedItems) {
    const item = receipt.countedItems[id];
    const shippedItem = receipt.items[id];
    const delta = shippedItem.quantity - item.quantity || 0;
    variants[id] = delta;
    delete notAssigned[id];
  }
  // now we want to capture what isnt there
  for (const id in notAssigned) {
    const shippedItem = receipt.items[id];
    const delta = shippedItem.quantity;
    variants[id] = delta; // * -1;
  }

  return variants;
}

function processVariants(variants, receipt) {
  const variantsItems = [];
  for (const id in variants) {
    const delta = variants[id];
    if (delta === 0) {
      continue;
    }

    const item = receipt.countedItems[id] || {};
    const shippedItem = receipt.items[id];
    variantsItems.push({
      id: id,
      sku: item.sku || shippedItem.sku,
      value: null,
      quantity: item.quantity || 0,
      quantity_shipped: shippedItem.quantity,
      delta: delta
    });
  }
  return variantsItems;
}

async function calculateCostAndApplyVariants(variantsItems, po, yeild) {
  const stationsMap = await buildStationMap(po);
  const variantItems = [];
  for (let i = 0; i < variantsItems.length; i++) {
    const variant = variantsItems[i];
    const id = variant.id;
    const costs = yeild.itemsCost[id];
    const varianceValue = calculateVariance(
      variant.delta,
      costs.unit,
      yeild.currency
    );
    variant.value = varianceValue;
    variantItems.push(variant);
    await ItemVariance.create({
      station: Station.getId(stationsMap[po.from]),
      purchase_order: PurchaseOrder.getId(po),
      node: id,
      quantity: variant.delta,
      value: varianceValue,
      initial_value: CostCode.convertCurrency(
        po.meta.projected_cost,
        yeild.currency
      )
    });
  }

  return variantItems;
}

function calculateVariance(variance, value, currency) {
  const varianceValue = CostCode.convertCurrency(value, currency) * variance;
  return varianceValue;
}

function getAllCompleteCostConvertedElements(po, site) {
  const currency = site.currency || Const.DEFAULT_CURRENCY;
  const meta = po.meta;
  const taxes = CostCode.convertCurrency(meta.invoice_taxes || 0, currency);
  const service = CostCode.convertCurrency(meta.service_fees || 0, currency);
  const customs = CostCode.convertCurrency(meta.customs_fees || 0, currency);

  const additional = CostCode.convertCurrency(
    meta.additional_fees || 0,
    currency
  );
  return {
    taxes,
    service,
    customs,
    additional,
    currency,
    site
  };
}

async function ensureRetailCostIsCorrect(node, cost, parsedCost, schema, site) {
  const helpers = Module._helpers.logistics();
  const logParams = helpers.logParams(schema.schema);
  const uCost = 'unit_cost';
  const rCost = 'retail_cost';

  if (node[logParams(uCost)] >= cost) {
    return;
  }
  // bump the cost 20% as default
  const currency = site.currency || Const.DEFAULT_CURRENCY;
  const retailLift = Math.ceil(
    parsedCost * ((site.retail_adjusted_cost || 20) / 100)
  );
  const retailAdjust = CostCode.parseValue(parsedCost + retailLift, currency);
  if (node.copy_of) {
    const parentNode = await Node.findOneById(node.copy_of, schema);
    parentNode[logParams(uCost)] = cost;
    node[logParams(uCost)] = cost;
    if (parentNode[logParams(rCost)] < cost) {
      parentNode[logParams(rCost)] = retailAdjust;
      node[logParams(rCost)] = retailAdjust;
    }
    await saveNode(parentNode, schema);
  } else {
    node[logParams(uCost)] = cost;
    if (node[logParams(rCost)] < cost) {
      node[logParams(rCost)] = retailAdjust;
    }
    await saveNode(node, schema);
  }
}

function processInvoiceToCostCode(amount, currency, domain, from, to) {
  return CostCode.invoice({
    from: from, // money coming from the to station
    to: to, //  model going to the from station
    amount: amount,
    currency: currency,
    domain: domain,
    entity: 'purchase_order'
  });
}

module.exports = {
  internalReceiptVariance,
  processVariants,
  calculateCostAndApplyVariants,
  calculateCosts,
  getAllCompleteCostConvertedElements,
  ensureRetailCostIsCorrect,
  processInvoiceToCostCode
};
