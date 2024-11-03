/**
 * CostRequestController
 *
 * @description :: Server-side actions for handling incoming requests.
 * @help        :: See https://sailsjs.com/docs/concepts/actions
 */

const { _approve, _signature } = require('../model-utilities/logistics/cost-request');

module.exports = {
  approve: async function(req, res) {
    try {
      return res.send(_approve(req.params.all(), res.locals.domain));
    } catch (e) {
      return res.badRequest(e);
    }
  },

  signature: async function(req, res) {
    try {
      return res.send(_signature(req.params.all()));
    } catch (e) {
      return res.badRequest(e);
    }
  }
};
