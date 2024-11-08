/**
 * checkAuthentication
 *
 * @module      :: Policy
 * @description :: Simple policy to allow any authenticated user
 *                 Assumes that your login action in one of your controllers sets `req.session.authenticated = true;`
 * @docs        :: http://sailsjs.org/#!/documentation/concepts/Policies
 *
 */
module.exports = function(req, res, next) {
  // User is allowed, proceed to the next policy,
  // or if this is the last policy, the controller
  if (req.session.authenticated) {
    return next();
  }

  // User is not allowed
  // (default res.forbidden() behavior can be overridden in `config/403.js`)
  if (req.isSocket || req.xhr || req.wantsJSON) {
    // req.flash('error','UNAUTENTICATE');
    return res.send(401, 'labels.UNAUTENTICATE');
  }
  if (res.redirect) {
    return res.redirect('/auth/login');
  } else {
    // next(true);
  }
};
