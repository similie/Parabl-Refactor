module.exports = {
    approve: async function(params, domain) {
      var cr = parseCostRequest(params, domain);
      const status = params.status;
      if (status === CostRequest.status().PENDING)
        return { error: 'A pending approval status cannot be saved' };
  
      const update = {
        approved_by: params.approved_by
      };
      cr.approved_by = params.approved_by;
      if (params.expires_on) {
        update.expires_on = params.expires_on;
      }
      await CostRequest.update({ id: CostRequest.getId(cr) }, update);
  
      try {
        cr = await CostRequest.setApproval(status, cr);
      } catch (e) {
        sails.log.error('COST REQUEST APPROVAL ERROR', e.message);
        return { error: e.message };
      }
  
      return cr;
    },
  
    signature: async function(params) {
      let (good_req, cr) = parseCostRequest(params);
      if (!params.approved_by) 
        throw { error: 'A valid user is required to request a signature' };
      
      const token = await CostRequest.issueApprovalToken(cr);
      return { token: token };
    }
};
  
  async function parseCostRequest(params, domain) {
    if (!params.id) throw { error: 'A valid cost request is required' };
    let cr = await CostRequest.findOneById(params.id);
    if (!cr) throw { error: 'A valid cost request is required' };
    CostRequest.checkCredentials(cr, params, domain);
    return cr;
  }
  