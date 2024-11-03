/*
 * Policy for setting a user as authenticated or public
 */
const { TimeUtils } = require('similie-api-services');
const { EnvAuthManager } = require('../model-utilities/common/env-manager');
const now_ = TimeUtils.constants.now_;

module.exports = function(req, res, next) {
  // we have an internal service requesting access
  if (req.headers.internal || req.headers['x-internal-auth']) {
    const env = new EnvAuthManager(req, res);
    return env.next(next);
  }

  // User is allowed, proceed to the next policy,
  // or if this is the last policy, the controller
  if (req.user && _.isFunction(req.isAuthenticated) && req.isAuthenticated()) {
    if (!req.headers.authorization) {
      const fmt = TimeUtils.constants.formats.Time.UnixMillis;
      req.session.timestamp = TimeUtils.formattedDate(now_, fmt);
    }

    /*
     * Here we check to see if the site has been restricted
     */
    if (
      (res.locals.siteData || {}).restricted &&
      !User.is(req.user, Roles.SIMILIE_ADMIN)
    ) {
      return res.redirect('/restricted');
    }

    return next();
  }

  /*
   * Here we look to see if it is public or private
   */
  if (
    res.locals.siteData &&
    !res.locals.siteData.public_site &&
    !NodeSurvey.validSurvey(req)
  ) {
    // User is not allowed
    // (default res.forbidden() behavior can be overridden in `config/403.js`)
    if (req.isSocket || req.xhr || req.wantsJSON) {
      if (Site.passThrough(req.options.model)) {
        return next();
      }

      return res.forbidden();
    }

    if (res.redirect) {
      /*
       * We are now going to put a routing mechanism in the system
       * based on a use login, event
       */
      return redirect(req, res);
    }
  }
  anonymousLogin(req, next);
};

function anonymousLogin(req, next) {
  // SURVEYOR
  const user = User.getAnonymousUser(req);
  req.login(user, err => {
    if (err) {
      sails.log.error(err);
      return next(err);
    }
    // Mark the session as authenticated to work with default Sails sessionAuth.js policy
    req.session.authenticated = true;
    req.session.holduser = user;
    // Upon successful login, send the user to the homepage were req.user
    // will be available.
    next();
  });
}

function fallbackRedirect(route, req) {
  if (route.includes('?routeTo=')) {
    return route;
  }
  const referrer = req.headers['content-referrer'];
  if (!referrer) {
    return route;
  }

  try {
    const referral = JSON.parse(referrer);
    if (!referral.url) {
      return route;
    }
    return `${route}?routeTo=${referral.url}`;
  } catch {
    return route;
  }
}

function redirect(req, res) {
  const route = req.path;
  let redirect = '/login';
  const routes = [
    redirect,
    'logout',
    'password-reset',
    'forms',
    'activate-account',
    'reset-password',
    'invite-error',
    'events'
  ];
  let whiteListed = false;
  for (let i = 0; i < routes.length; i++) {
    const route = routes[i];
    if (!whiteListed) {
      whiteListed = _.contains(route, route);
    } else {
      break;
    }
  }
  if (route && !whiteListed && route !== '/') {
    redirect += '?routeTo=' + route;
  }
  return res.redirect(fallbackRedirect(redirect, req));
}
