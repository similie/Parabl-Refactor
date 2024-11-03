module.exports = function(req, res, next) {
  var params = req.params.all();
  var token = params.token;

  if (!token) {
    return res.badRequest('errors.VALID_TOKEN_REQUIRED');
  }

  if (req.session.survey && token != req.session.survey.token) {
    req.session.survey = null;
    req.session.user_details = null;
    req.session.complete = false;
  }

  var complete = req.session.completedTokens || [];
  if (_.contains(complete, token)) {
    if (req.wantsJSON) {
      return res.badRequest('errors.SURVEY_ALREADY_COMPLETED');
    } else {
      req.session.reason = 'errors.SURVEY_ALREADY_COMPLETED';
      return res.redirect('/survey/invalid');
    }
  }

  NodeSurvey.findOne({ token: token })
    .populateAll()
    .exec((err, survey) => {
      if (err) {
        return res.negotiate(err);
      }

      res.locals.survey = survey;
      req.session.survey = survey;

      next();
    });
};
