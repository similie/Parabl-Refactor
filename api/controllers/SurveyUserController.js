/**
 * SurveyUserController
 *
 * @description :: Server-side logic for managing Surveyusers
 * @help        :: See http://sailsjs.org/#!/documentation/concepts/Controllers
 */

module.exports = {
  submit: function(req, res) {
    if (req.method !== 'POST') {
      return res.badRequest();
    }
    const params = req.params.all();

    if (!params.user) {
      return res.badRequest('errors.USER_DETAILS_REQUIRED');
    }

    NodeSurvey.isValid(req, res, () => {
      SurveyUser.create(params.user).exec((err, user) => {
        if (err) {
          return res.negotiate(err);
        }
        req.session.user_details = user;
        res.send(user);
      });
    });
  }
};
