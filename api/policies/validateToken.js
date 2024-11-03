/**
 * validates an auth tokem
 *
 * if the controller only allows access through an invite token
 *
 *
 * @param {Object}   req
 * @param {Object}   res
 * @param {Function} next
 */

module.exports = function(req, res, next) {
  const params = req.params.all();

  if (!params.token) {
    return res.forbidden('errors.NOT_PERMITTED');
  }
  Invite.findOne({
    token: params.token,
    active: true,
    target_model: Invite.actions().match(req.path)
    // type: Invite.actions().match(req.path)
    // we check to see if the invite expires
  })
    .where({ or: [{ expire: null }, { expire: { '>=': new Date() } }] })
    .populateAll()
    .exec((err, invite) => {
      if (err) {
        return res.negotiate(err);
      }

      if (!invite) {
        if (req.wantsJSON) {
          return res.badRequest('errors.INVALID_INVITE');
        }
        return res.redirect('/invite-error');
      }
      // place the content in locals
      res.locals.invite = invite;
      next();
    });
};
