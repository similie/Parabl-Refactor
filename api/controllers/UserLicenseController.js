/**
 * UserLicenseController
 *
 * @description :: Server-side actions for handling incoming requests.
 * @help        :: See https://sailsjs.com/docs/concepts/actions
 */

const { Common } = require('../model-utilities/common/common');
const SailsExtensions = require('../services/SailsExtensions');

module.exports = {
  findOne: async function(req, res) {
    SailsExtensions.findOne(req, res, userLicense => {
      if (!userLicense) {
        return res.badRequest({ error: 'Invalid id' });
      }
      const user = req.user;
      if (
        !User.is(user, Roles.USER_ADMIN) &&
        Model.getId(user) !== Model.getId(userLicense.user)
      ) {
        return res.badRequest({ error: 'Invalid user' });
      }
      res.send(userLicense);
    });
  },
  find: async function(req, res) {
    if (SailsExtensions.primaryKey(req)) {
      return this.findOne(req, res);
    }
    const params = req.params.all();
    const id = +params.user;
    if (!id) {
      return res.badRequest({ error: 'Missing user id' });
    }
    const user = req.user;
    if (!User.is(user, Roles.USER_ADMIN) && user.id !== +id) {
      return res.badRequest({ error: 'Invalid user' });
    }

    try {
      const licenses = await UserLicense.find()
        .where(UserLicense.userLicenseFindQuery(req))
        .populate('document')
        .sort({ createdAt: 'ASC' });

      res.send(licenses);
    } catch (e) {
      res.serverError(e);
    }
  },
  destroy: function(_, res) {
    res.notFound();
  },
  create: function(_, res) {
    res.notFound();
  },
  update: async function(req, res) {
    // only the user can accept the license
    const params = req.params.all();
    const id = params.id;
    if (!id) {
      return res.badRequest({ error: 'Missing id' });
    }

    const license = await UserLicense.findOneById(id);
    if (!license) {
      return res.badRequest({ error: 'Invalid id' });
    }

    if (license.user !== req.user.id) {
      return res.badRequest({ error: 'Invalid user' });
    }

    if (license.accepted) {
      return res.badRequest({ error: 'License already accepted' });
    }

    const accepted = params.accepted;
    if (!accepted) {
      return res.badRequest({ error: 'Missing accepted' });
    }

    license.accepted = accepted;
    license.accepted_on = Common.timeIsNow();
    const saved = await UserLicense.saveAsync(license);
    res.send(saved);
  }
};
