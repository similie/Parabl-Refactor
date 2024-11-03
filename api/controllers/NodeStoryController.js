/**
 * NodeStoryController
 *
 * @description :: Server-side actions for handling incoming requests.
 * @help        :: See https://sailsjs.com/docs/concepts/actions
 */

module.exports = {
  /**
   * modules
   *
   * Allows us to create programatic stories that are not
   * dependent on derivative statements
   */

  modules: async function(req, res) {
    const params = req.params.all();
    if (!params.id) {
      return res.badRequest({
        error: 'A story ID is required to process this request'
      });
    }
    const ns = await NodeStory.findOneById(params.id);

    if (!ns) {
      return res.badRequest({ error: 'A story with this ID cannot be found' });
    }

    try {
      const moduleData = await NodeStory.processModule(ns, {
        story: params.id,
        ...params.context
      });
      res.send(moduleData);
    } catch (e) {
      const message = e.message;
      sails.log.error(message);
      return res.badRequest({ error: message });
    }
  }
};
