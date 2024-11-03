/**
 * JobTemplateController
 *
 * @description :: Server-side actions for handling incoming requests.
 * @help        :: See https://sailsjs.com/docs/concepts/actions
 */

const { SqlUtils } = require('similie-api-services');

module.exports = {
  find: async function(req, res) {
    const params = req.params.all();
    const strip = params.strip;
    delete params.strip;
    Utils.getParser(req, res, models => {
      if (strip) {
        Message.parseAllBodyContent(models, 'description');
      }
      return res.send(models);
    });
  },

  orgs: async function(req, res) {
    const params = Utils.params(req);
    if (!params.organization) {
      return res.badRequest({
        error: Const.err.ORGANIZATIONAL_CAREER_ID_REQUIRED
      });
    }
    const careerOrgs = await OrganizationalCareer.find().where({
      id: params.organization
    });
    const orgs = _.pluck(careerOrgs, 'organization');
    const jTemplates = await CareerTrack.find().where({
      organization: _.map(orgs, o => Organization.getId(o))
    });
    const jts = _.pluck(jTemplates, 'jobtemplate');
    delete params.organization;
    params.id = jts;
    const send = await JobTemplate.find()
      .where(params)
      .sort(Utils.sort(req))
      .limit(Utils.limit(req))
      .skip(Utils.skip(req))
      .populateAll();
    Message.parseAllBodyContent(send, 'description');
    res.send(send);
  },

  forUser: async function(req, res) {
    const params = req.params.all();
    if (!params.id) {
      return res.badRequest({ error: Const.err.ID_PARAM_NOT_PROVIDED });
    }
    const user = await User.findOneById(params.id).populateAll();
    const organization = user.organization;
    if (!organization) {
      return res.badRequest({
        error: Const.err.USER_MUST_BE_ASSIGNED_ORGANIZATION
      });
    }
    const escape = SqlUtils.escapeUtil();
    const oId = Organization.getId(organization);
    const oResult = await OrganizationalCareer.queryAsync(
      escape(
        `SELECT "id", "organization" FROM "organizationalcareer" WHERE "organization" = %s`,
        oId
      )
    );
    const oc = _.pluck(oResult.rows, 'id').pop();
    const orgs = _.pluck(oResult.rows, 'organization');
    if (!oc) {
      return res.badRequest({
        error: Const.err.ORGNIZATION_HAS_NO_ASSIGNED_CAREER_PROGRESSION
      });
    }
    const badge = user.rank_badge;
    let badgeModel;
    if (badge && badge.group === 'rank') {
      const bId = Badge.getId(badge);
      const bws = await BadgeWeight.find().where({
        badge: bId,
        organization: orgs
      });
      badgeModel = BadgeWeight.maxWeight(bws);
    }
    const actionUtil = Utils.actionUtil();
    const rank = badgeModel ? badgeModel.weight || -1 : -1;
    const results = await Model.queryAsync(
      escape(
        `SELECT "jobtemplate" AS "jt" from "requisition" WHERE "user" = %s`,
        params.id
      )
    );
    const jts = _.pluck(results.rows, 'jt');
    const query = actionUtil.parseCriteria(req);
    delete query.id;

    if (rank !== -1) {
      query.requisition_category_weight = { '<=': rank };
    }
    let cTq = 'SELECT "jobtemplate" FROM "careertrack" WHERE "organization" %s';
    if (_.size(jts)) {
      cTq += ' AND "jobtemplate" NOT %s';
    }
    const ctQ = await CareerTrack.queryAsync(
      escape(cTq, SqlUtils.setInString(orgs), SqlUtils.setInString(jts))
    );

    query.id = _.map(ctQ.rows, c => c.jobtemplate);
    const jobtemplates = await JobTemplate.find()
      .where(query)
      .sort(actionUtil.parseSort(req))
      .skip(actionUtil.parseSkip(req))
      .limit(actionUtil.parseLimit(req));
    Message.parseAllBodyContent(jobtemplates, 'description');
    return res.send(jobtemplates);
  }
};
