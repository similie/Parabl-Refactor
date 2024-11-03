/**
 * EventDependentController
 *
 * @description :: Server-side actions for handling incoming requests.
 * @help        :: See https://sailsjs.com/docs/concepts/actions
 */
const SailsExtensions = require('../services/SailsExtensions');

module.exports = {
  station: async function(req, res) {
    const params = SailsExtensions.params(req);
    if (!params.id) {
      return res.badRequest({
        error: 'An event ID is required for this request'
      });
    }

    if (!params.station) {
      return res.badRequest({
        error: 'A station ID is required for this request'
      });
    }
    try {
      const avaliableEvents = await EventDependent.selectInvalidDependents(
        params.station,
        params.id
      );
      res.send(avaliableEvents);
    } catch (e) {
      return res.badRequest({ error: e.message });
    }
  }
};
