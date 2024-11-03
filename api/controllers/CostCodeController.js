/**
 * CostCodeController
 *
 * @description :: Server-side actions for handling incoming requests.
 * @help        :: See https://sailsjs.com/docs/concepts/actions
 */
const { _currencies, _ledger, _primary, _connect } = require('../model-utilities/logistics/cost-code')

module.exports = {
  currencies: function(req, res) {
    const params = req.params.all();
    res.send(_currencies(params));
  },

  ledger: async function(req, res) {
    const actionUtil = Utils.actionUtil();
    // const params = req.params.all(); // this is the parsed params as from req  with a where clause
    const parsedParams = actionUtil.parseValues(req); // this has stripped out the where an gives us raw params
    // const searchField = parsedParams.search;
    // const stationId = parsedParams.station;
    // const nodeType = parsedParams.schema;
    try {
      const result = await _ledger(parsedParams);
      res.send(result)
    } catch(e) {
      res.badRequest({ error: e.message });
    }
  },

  create: function(req, res) {
    return res.forbidden();
  },

  destroy: function(req, res) {
    return res.forbidden();
  },

  update: function(req, res) {
    return res.forbidden();
  },

  primary: async function(req, res) {
    const params = req.params.all();
    try {
      const result = await _primary(params)
      res.send(result)
    } catch(e) {
      res.badRequest({
        error: e.message
      });
    }
  },

  connect: async function(req, res) {
    /*
     * Note! All auth and permissions is handled by middlewhere that is located in the api/services directory
     */
    const actionUtil = Utils.actionUtil();
    // const params = req.params.all(); // this is the parsed params as from req  with a where clause
    const parsedParams = actionUtil.parseValues(req); // this has stripped out the where an gives us raw params
    try {
      const result = await _connect(parsedParams);
      res.send(result);
    } catch(e) {
      res.badRequest({
        error: e.message
      });
    }
  },

  test: function(req, res) {
    return res.ok();
  }
};
