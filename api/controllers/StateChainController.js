/**
 * StateChainController
 *
 * @description :: Server-side actions for handling incoming requests.
 * @help        :: See https://sailsjs.com/docs/concepts/actions
 */

module.exports = {

  create: function(req, res) {
    return res.forbidden();
  },

  destroy: function(req, res) {
    return res.forbidden();
  },

  update: function(req, res) {
    return res.forbidden();
  },


  validate: async function(req, res) {

    const user = req.user;

    if (!User.is(user, Roles.SITE_ADMIN)) {
      return res.forbidden();
    }

    const params = req.params.all();

    let sc;

    if (params.id) {
      sc = await StateChain.findOneById(params.id);
    } else if (params.entity && params.costcode) {
      sc = await StateChain.findOne({
        entity: params.entity,
        costcode: params.costcode
      });
    } else {
      return res.badRequest({ error: 'This request cannot be return as valid' });
    }

    if (!sc) {
      return res.badRequest({ error: 'This state chain cannot be found' });
    }
    try {
      const valid = await sc.validateAllStates();
      return res.send({
        healthy: valid
      });
    } catch (e) {
      sails.log.error(e);
      return res.send(500, {error: e.message});
    }


  }

};
