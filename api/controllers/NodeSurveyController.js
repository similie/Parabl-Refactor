/**
 * NodeSurveyController
 *
 * @description :: Server-side logic for managing Nodesurveys
 * @help        :: See http://sailsjs.org/#!/documentation/concepts/Controllers
 */

module.exports = {
  submit: function(req, res) {
    var params = req.params.all();

    if (!params.token) {
      return res.badRequest("errors.NO_TOKEN_FOUND");
    }

    if (!params.node) {
      return res.badRequest("errors.NO_NODE_FOUND");
    }

    var survey = _.clone(res.locals.survey);
    var model = (params.node.model = survey.node.name);
    params.node.schema = (survey.node || {}).id;
    const user_details = req.session.user_details;
    const udId = Model.getId(user_details);
    if (!params.user_details && udId) {
      params.user_details = udId;
    }
    Node.create(params.node, req, res)
      .then(node => {
        //return res.send(node);
        //Invite.consume(params.token, function(err) {
        if (req._sails.hooks.pubsub && _.size(node)) {
          sails.sockets.blast(
            model,
            {
              id: node.id,
              verb: req.method == "PUT" ? "updated" : "created",
              data: node
            },
            req
          );
        }

        req.session.completedTokens = req.session.completedTokens || [];

        req.session.completedTokens = _.union(req.session.completedTokens, [
          params.token
        ]);
        req.session.complete = true;
        (
          Modules[model] ||
          function(req, res, sails, update) {
            res.send(update);
          }
        )(req, res, sails, node);
      })
      .catch(why => {
        sails.log.error(why);
        res.serverError(why);
      });
  },

  resolve_survey: function(req, res) {
    NodeSurvey.isValid(req, res, () => {
      const survey = res.locals.survey;
      Variable.resolveVariables(survey.node.schema)
        .then(variables => {
          survey.variables = variables;
          return survey;
        })
        .then(async variables => {
          NodeSchema.stripSchema(survey.node);
          const icons = await Icon.find();
          const sId = Station.getId(survey.station);
          if (sId && sId !== -1) {
            const station = await Station.findOneById(sId).populateAll();
            try {
              await Geo.pullGeoJson(station);
            } catch (e) {
              sails.log.error(e);
            }
            survey.station = station;
          }

          survey.icons = icons;
          res.send(survey);
        })
        .catch(res.serverError);
    });
  },

  survey: function(req, res) {
    var params = req.params.all();
    var user = req.user;
    var disabled = !!user;

    res.locals.disabled = disabled;
    var token = params.token || (req.session.survey || {}).token;

    if (!token) {
      return res.badRequest("errors.SURVEY_TOKEN_REQUIRED");
    }

    var survey = res.locals.survey;

    NodeSurvey.isValid(req, res, () => {
      if (req.session.complete && !req.wantsJSON) {
        return res.redirect("/survey/complete");
      } else if (req.session.complete && req.wantsJSON) {
        return res.send(survey);
      }

      if (params.user_details) {
        req.session.user_details = params.user_details;
      }

      if (survey.required_user_details && !req.session.user_details) {
        if (req.wantsJSON) {
          return res.badRequest("errors.INVALID_SURVEY");
        } else {
          return res.redirect("/userdetails?token=" + token);
        }
      }

      res.view("index/index");
    });
  },

  userdetails: function(req, res) {
    if (
      req.session.survey &&
      req.session.user_details &&
      !req.session.complete
    ) {
      return res.redirect("/survey/" + req.session.survey.token);
    }

    var params = req.params.all();
    var complete = req.session.completedTokens || [];

    if (_.contains(complete, params.token)) {
      if (req.wantsJSON) {
        return res.badRequest("errors.SURVEY_ALREADY_COMPLETED");
      } else {
        req.session.reason = "errors.SURVEY_ALREADY_COMPLETED";
        return res.redirect("/survey/invalid");
      }
    }

    //res.locals.survey = req.session.survey;
    //res.send(req.session.survey);
    res.view("index/index");
    //res.view('survey/details');
  },

  invalid: function(req, res) {
    if (!req.session.reason) {
      return res.redirect("/");
    }
    res.locals.reason = req.session.reason;
    res.view("survey/invalid");
  },

  mark_complete: function(req, res) {
    var params = req.params.all();
    if (
      req.session.user_details != params.user ||
      (req.session.survey && req.session.survey.id != params.survey)
    ) {
      return res.badRequest("errors.REQUEST_MISMATCH");
    }

    if (req.session.complete) {
      return res.badRequest("errors.SESSION_IS_COMPLETE");
    }

    var us = {
      user: params.user,
      node: params.node,
      station: params.station,
      survey: params.data
    };
    UserSurvey.create(us).exec((err, userSurvey) => {
      if (err) {
        sails.log.error(err);
        return res.serverError(err);
      }

      req.session.complete = true;

      res.send(userSurvey);
    });
  },

  complete: function(req, res) {
    var params = req.params.all();
    var user_details = _.clone(req.session.user_details);
    res.locals.survey = _.clone(req.session.survey);
    req.session.survey = null;
    req.session.user_details = null;

    if (user_details) {
      SurveyUser.findOneById(user_details).exec((err, details) => {
        if (err) {
          return res.negotiate(err);
        }
        res.locals.user_details = details;
        res.view("survey/complete");
      });
    } else {
      res.locals.user_details = {};
      res.view("survey/complete");
    }
  }
};
