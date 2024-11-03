/**
 * EventImpactController
 *
 * @description :: Server-side actions for handling incoming requests.
 * @help        :: See https://sailsjs.com/docs/concepts/actions
 */

module.exports = {
  report: async function(req, res) {
    try {
      const counts = await EventImpact.count(req);
      return res.send(counts);
    } catch (e) {
      return res.serverError(e);
    }
  }
};
