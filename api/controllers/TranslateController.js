/**
 * TranslateController
 *
 * @description :: Server-side logic for managing Translates
 * @help        :: See http://sailsjs.org/#!/documentation/concepts/Controllers
 */

module.exports = {
  index: async function(req, res) {
    const params = req.params.all();
    const key = Translates.translateIdentity;
    const surveySite = (res.locals.siteData || {}).survey;
    let language = params.lang;

    if (!req.session) {
      return res.serverError();
    }

    if (language) {
      req.session.language = language;
      req.setLocale(language);
    } else if (req.session.language) {
      language = req.session.language;
      req.setLocale(language);
    } else {
      req.session.language = sails.config.language;
      language = req.session.language;
      req.setLocale(language);
    }

    const domains = [
      { domain: null }
    ];

    const domain = res.locals.domain;
  
    if (domain) {
      domains.push({
        domain: Model.getId(domain)
      });
    }
    let membships;
    if (surveySite && domain) {
      let memberships = await Domain.commonDomainTags(domain);
      _.each(memberships, (m) => {
        if (m !== Domain.getId(domain) || m !== null) {
          domains.push({
            domain: m
          });
        }
      });
    }

    const translates = {};
    Variable.find().where({ key: key, or: domains })
      //.populateAll()
      .exec((err, variables) => {

        if (err) {
          sails.log.error(err);
          return res.serverError(err);
        }

        Variable.mergeVariables(variables, domain).then((merged) => {
          _.each(merged, vars => {
            var value =
              (vars.value || {})[language] ||
              (vars.value || {})[Translates.fallbackLanguage] ||
              Translates.noLanguageSet;
            translates[vars.identity] = value;
          });

          /*

            {
            language: language,
            translations: translates
          }
          */  

          res.send(translates);

        }).catch(function(err) {
          sails.log.error(err);
          res.serverError(err);
        });
      });
  }
};
