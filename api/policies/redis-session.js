/*
 * Logic for implementing a cookieless session
 * controller.
 */

module.exports = async function(req, res, next) {
  /*
   * If we no JWT header
   */

  const config = res.locals.siteData;
  if (!req.user || !config) {
    return next();
  }
  const storeDetails = await Session.getSessionDetails(req);
  req.store = new Session(storeDetails, Site.getTTl(config));
  if (!req.user.online) {
    req.user = await req.store.online();
  }
  req.store.touch(err => {
    if (err) {
      return next(err);
    }
    req.store.pull(next);
  });
};
