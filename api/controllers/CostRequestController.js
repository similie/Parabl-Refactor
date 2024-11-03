/**
 * CostRequestController
 *
 * @description :: Server-side actions for handling incoming requests.
 * @help        :: See https://sailsjs.com/docs/concepts/actions
 */

module.exports = {
  approve: async function(req, res) {
    const params = req.params.all();
    if (!params.id) {
      return req.badRequest({
        error: 'A valid cost request is required'
      });
    }
    let cr = await CostRequest.findOneById(params.id);
    if (!cr) {
      return res.badRequest({
        error: 'A valid cost request is required'
      });
    }

    try {
      CostRequest.checkCredentials(cr, params, res.locals.domain);
    } catch (e) {
      return res.badRequest(e);
    }

    const update = {
      approved_by: params.approved_by
    };
    cr.approved_by = params.approved_by;
    if (params.expires_on) {
      update.expires_on = params.expires_on;
    }
    await CostRequest.update({ id: CostRequest.getId(cr) }, update);

    const status = params.status;

    if (status === CostRequest.status().PENDING) {
      return res.send({
        error: 'A pending approval status cannot be saved'
      });
    }

    try {
      cr = await CostRequest.setApproval(status, cr);
    } catch (e) {
      sails.log.error('COST REQUEST APPROVAL ERROR', e.message);
      return res.send({ error: e.message });
    }

    return res.send(cr);
  },

  signature: async function(req, res) {
    const params = req.params.all();
    if (!params.id) {
      return req.badRequest({
        error: 'A valid cost request is required'
      });
    }

    if (!params.approved_by) {
      return res.badRequest({
        error: 'A valid user is required to request a signature'
      });
    }
    const cr = await CostRequest.findOneById(params.id);

    if (!cr) {
      return res.badRequest({
        error: 'A valid cost request is required'
      });
    }

    try {
      CostRequest.checkCredentials(cr, params, res.locals.domain);
    } catch (e) {
      return res.badRequest(e);
    }

    const token = await CostRequest.issueApprovalToken(cr);
    return res.send({ token: token });
  }
};
