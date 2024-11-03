/**
 * DomainController
 *
 * @description :: Server-side logic for managing Domains
 * @help        :: See http://sailsjs.org/#!/documentation/concepts/Controllers
 */

module.exports = {
  memberSearch: async function(req, res) {
    const params = req.params.all();
    try {
      const users = await DomainRole.externalDomainMembers(params);
      return res.send(users);
    } catch (e) {
      sails.log.error(e);
      return res.negotiate({ error: e.message });
    }
  },
  group: async function(req, res) {
    const params = req.params.all();
    const domain =
      params.id || params.domain || Domain.getId(res.locals.domain);
    if (!domain) {
      return res.badRequest({ error: 'errors.DOMAIN_ID_REQUIRED' });
    }
    try {
      const domainIds = await Domain.commonDomainTags(domain);
      const domains = await Domain.find({ id: domainIds }).populateAll();
      res.send(domains);
    } catch (e) {
      sails.log.error(e);
      return res.negotiate(e);
    }
  },

  member_roles: async function(req, res) {
    const params = req.params.all();
    if (!params.id || !_.size(params.roles)) {
      return Utils.sendErrorCode(
        res,
        Utils.setErrorCode(Const.code.BAD_REQUEST)
      );
    }
    const users = await Domain.getMembersOnRoles(params.id, params.roles);
    res.send(users);
  },

  members: async function(req, res) {
    const user = req.user;
    if (!User.is(user, Roles.DOMAIN_ADMIN)) {
      return Utils.sendErrorCode(res, Utils.setErrorCode(Const.code.FORBIDDEN));
    }
    const params = req.params.all();

    try {
      const domain = params.id;
      const users = await Domain.getMembers(user, domain);
      return res.send(users);
    } catch (e) {
      return res.negotiate(e);
    }
  },

  select: async (req, res) => {
    const params = req.params.all();
    /*
     * We need to make sure we have our ID params. From the front end
     * we will send param -1 to signify the Global Domain
     */
    if (!params.id) {
      return res.badRequest({ error: 'errors.DOMAIN_ID_REQUIRED' });
    }

    const user = req.user;
    let u;
    try {
      u = await User.changeDomain(
        user,
        parseInt(params.id) === -1 ? null : params.id
      );
    } catch (e) {
      sails.log.error(e.error);
      return res.send(e.error, 400);
    }
    /*
     * We now need to updated our user in session
     *
     */
    req.login(u, err => {
      if (err) {
        sails.log.error(err);
      }
      res.send(u);
    });
  },

  defaultDomain: async function(_req, res) {
    const defaultDomain = await Domain.getDefaultDomain();
    res.send(defaultDomain);
  },

  test: async (req, res) => {
    const params = req.params.all();
    res.ok(params);
  }
};
