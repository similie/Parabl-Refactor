/*
 * Policy for setting a user as authenticated or public
 */
module.exports = function(req, res, next) {
  Site.thisSite((err, site) => {
    if (err) {
      return res.negotiate(err);
    }
    res.locals.siteData = site || {};
    Utils.setTTL(res.locals.siteData);
    if (req.isSocket) {
      Site.subscribe(req, _.pluck([site], 'id'));
    }
    next();
  }, res.locals.domain);
};
