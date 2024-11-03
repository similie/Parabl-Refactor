/**
 * EventBroadcastController
 *
 * @description :: Server-side actions for handling incoming requests.
 * @help        :: See https://sailsjs.com/docs/concepts/actions
 */

module.exports = {
  events: async function(req, res) {
    const params = req.params.all();
    try {
      const category = params.category;
      delete params.category;
      const events = await EventBroadcast.getBroadcastByQuery(params, category);
      return res.ok(events);
    } catch (e) {
      return res.serverError({ error: e.message });
    }
  }
};
