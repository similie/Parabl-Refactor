/**
 * PurchaseOrderController
 *
 * @description :: Server-side actions for handling incoming requests.
 * @help        :: See https://sailsjs.com/docs/concepts/actions
 */

const {
  POAfterShip
} = require('../model-utilities/purchase-orders/purchase-order-aftership');
const {
  seekSerializedAssetsBasedNodeSku
} = require('../model-utilities/purchase-orders/purchase-order-serials');
const {
  PurchaseOrderResolver
} = require('../model-utilities/purchase-orders/purchase-order-resolver');
const SailsExtensions = require('../services/SailsExtensions');

module.exports = {
  after_ship: async function(req, res) {
    const params = req.params.all();
    const domain = res.locals.domain;
    const site = await Site.thisSiteAsync(domain);
    const method = req.method;

    if (POAfterShip.hasNoAfterShipIntegration(site)) {
      return res.badRequest({
        error: 'error.NO_SERVICE_INTEGRATED'
      });
    }

    if (!params.id) {
      return res.badRequest({ error: 'error.PURCHASE_ORDER_ID_REQUIRED' });
    }

    const po = await PurchaseOrder.findOneById(params.id);
    const poShip = new POAfterShip(po, params, site, domain);

    try {
      let results;
      switch (method) {
        case 'POST':
          results = await poShip.processPostMessage();
          break;
        case 'PUT':
          // @todo:: implement potential features
          break;
        case 'GET':
          results = await poShip.processGetMessage();
          break;
        case 'DELETE':
          results = await poShip.processDeleteMessage();
          break;
      }
      res.send(results);
    } catch (e) {
      sails.log.error(e);
      res.serverError({ error: e.message });
    }
  },

  serial_check: async function(req, res) {
    const params = req.params.all();
    if (!params.id) {
      return res.badRequest('A node id is required');
    }

    if (!params.schema) {
      return res.badRequest('A schema id is required');
    }

    if (!params.serial) {
      return res.badRequest('A serialized value is required');
    }

    const schema = await NodeSchema.findOneById(params.schema);
    const node = await Node.findOneById(params.id, schema);
    try {
      const available = await seekSerializedAssetsBasedNodeSku(
        node,
        schema,
        params.serial
      );
      res.send({
        [params.serial]: available
      });
    } catch (e) {
      sails.log.error('PurcahseOrderController.serial_check::', e);
      res.serverError({ error: e.message });
    }
  },

  // get PO by dynamic params
  /**
   *
   * @param {*} req
   * @param {*} res
   * @deprecated this function is not correct
   */
  get_po: async function(req, res) {
    const params = req.params.all();
    try {
      const resolver = new PurchaseOrderResolver(params);
      const purchaseorders = await resolver.resolve();
      SailsExtensions.subscribeModels(PurchaseOrder, req, purchaseorders);
      res.send(purchaseorders);
    } catch (e) {
      sails.log.error('PurchaseOrderController::get_po:error', e);
      return res.serverError({ error: e.message });
    }
  }
};
