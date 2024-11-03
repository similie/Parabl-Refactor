/*
 * This policy is looking at what the user is
 * doing and saving the activities of
 * user interactions
 */
module.exports = function(req, res, next) {
  let restricted = false;
  /*
   * Here we test if we are restricting the route
   */
  if (res.locals.device) {
    return next();
  }

  _.each(Const.ACTIVITY_RESTRICT_PATH, path => {
    if (_.contains(req.path, path)) {
      restricted = true;
    }
  });

  if (
    (req.method !== 'GET' || Const.TRACK_GET) &&
    !restricted &&
    !process.env.RESTRICT_ACTIVITY
  ) {
    UserActivity.set(UserActivity.API_ACCESS, null, req);
  }

  next();
};
