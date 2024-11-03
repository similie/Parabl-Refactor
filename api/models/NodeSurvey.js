/**
 * NodeSurvey.js
 *
 * @description :: TODO: You might write a short summary of how this model works and what it represents here.
 * @docs        :: http://sailsjs.org/documentation/concepts/models-and-orm/models
 */

var shortid = require("shortid");

module.exports = {
  attributes: {
    station: {
      model: "station",
      required: true
    },

    node: {
      model: "nodeschema",
      required: true
    },

    requestor: {
      model: "user"
    },

    token: {
      type: "string",
      required: true,
      unique: true
    },

    active: {
      type: "boolean",
      defaultsTo: true
    },

    required_user_details: {
      type: "boolean",
      defaultsTo: false
    },

    requires_approval: {
      type: "boolean",
      defaultsTo: false
    },

    expires: {
      type: "datetime"
    },

    primary: {
      type: "boolean",
      defaultsTo: false
    },

    tags: {
      type: "array"
    }
  },

  validSurvey: function(req) {
    const survey = req.session.survey;
    let valid = false;
    if (survey && survey.expires && survey.expires < new Date()) {
      valid = true;
    } else if (survey && !req.session.complete) {
      valid = true;
    }
    return valid;
  },

  isValid: function(req, res, next) {
    var survey = res.locals.survey;
    if (survey && survey.expires && survey.expires < new Date()) {
      req.session.reason = "labels.EXPIRED_SURVEY";
      if (req.wantsJSON) {
        return res.badRequest("errors.EXPIRED_SURVEY");
      } else {
        return res.redirect("/survey/invalid");
      }
    }

    if (!survey || !survey.active) {
      req.session.reason = "labels.INACTIVE_SURVEY";
      if (req.wantsJSON) {
        return res.badRequest("errors.INVALID_SURVEY");
      } else {
        return res.redirect("/survey/invalid");
      }
    }

    next();
  },

  beforeValidate: async function(values, next) {
    var now = new Date();
    try {
      const ns = await NodeSurvey.findOne({
        station: values.station,
        node: values.node,
        active: true
      });

      if (ns && ns.expires > now) {
        return next("error.SURVEY_ALREADY_ACTIVE_FOR_STATION");
      }
      if (ns && ns.id !== values.id) {
        ns.active = false;
        ns.save(function(err) {
          if (err) {
            sails.log.error(err);
          }
        });
      } else if (values.active == null) {
        values.active = true;
      }
      // adding a primary feature for chatbots
      if (values.primary && values.id) {
        const pNs = await NodeSurvey.find({
          node: values.node,
          active: true,
          primary: true,
          id: { "!": values.id }
        });
        for (let i = 0; i < _.size(pNs); i++) {
          const p = pNs[i];
          p.primary = false;
          p.save(function(err) {
            if (err) {
              sails.log.error(err);
            }
          });
        }
      }

      const token = shortid.generate(); //uuid.v4();
      values.token = token;

      return next();
    } catch (e) {
      return next(e);
    }
  }
};
