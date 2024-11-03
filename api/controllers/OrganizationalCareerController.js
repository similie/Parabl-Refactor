/**
 * OrganizationalCareerController
 *
 * @description :: Server-side actions for handling incoming requests.
 * @help        :: See https://sailsjs.com/docs/concepts/actions
 */

module.exports = {
  clone: async function(req, res) {
    if (req.method != 'POST') {
      return res.notFound();
    }
    const params = req.params.all();
    if (!params.id) {
      return res.badRequest({ error: 'A clone to ID is required' });
    }

    if (!params.from) {
      return res.badRequest({ error: 'A from ID is required' });
    }

    const ocToCloneTo = await OrganizationalCareer.findOneById(
      params.id
    ).populateAll();
    const ocToCloneFrom = await OrganizationalCareer.findOneById(params.from);
    ocToCloneTo.career_progression = OrganizationalCareer.getClonedCareers(
      ocToCloneFrom
    );
    await OrganizationalCareer.saveAsync(ocToCloneTo);
    return res.send(ocToCloneTo);
  },

  canCloneFrom: async function(req, res) {
    const params = req.params.all();
    const domain = res.locals.domain;
    const limit = req.limit || 30;
    const skip = req.skip || 0;

    const orgs = await Organization.find()
      .where({
        domain: Organization.getId(domain)
      })
      .populate('badge')
      .sort({ name: 'ASC' })
      .limit(limit)
      .skip(skip);

    const orgIds = _.pluck(orgs, 'id');
    if (!_.size(orgIds)) {
      return res.send(orgIds);
    }
    const bCache = Organization.buildBadgeCache(orgs);
    const where = { organization: orgIds };

    if (params.id) {
      where.id = { '!': params.id };
    }

    const _ocs = await OrganizationalCareer.find()
      .where(where)
      .populateAll();

    const organzations = _.filter(_ocs, oc => _.size(oc.career_progression));
    OrganizationalCareer.simplifyProgression(organzations, bCache);
    return res.send(organzations);
  },

  uncover: async function(req, res) {
    const params = req.params.all();

    if (!params.id) {
      return res.badRequest({
        error: 'ID Required'
      });
    }

    const station = await Station.findOneById(params.id);

    if (!station) {
      return res.badRequest({
        error: 'Invalid Station'
      });
    }

    const ancestors = await Station.ancestors(station, true);

    if (!_.size(ancestors)) {
      return res.send([]);
    }
    const sIds = [];
    _.each(ancestors, a => {
      const sId = Station.getId(a);
      sIds.push(sId);
    });

    const orgs = await Organization.find().where({
      connected_station: sIds
    });

    if (!_.size(orgs)) {
      return res.send(orgs);
    }
    const orgCareers = await OrganizationalCareer.find()
      .where({
        organization: _.pluck(orgs, 'id')
      })
      .populateAll();
    res.send(orgCareers);
  }
};
