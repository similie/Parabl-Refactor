// @TODO: Refactor to CommonUtils in similie-api-services module
const { TimeUtils } = require('similie-api-services');
const now_ = TimeUtils.constants.now_;
const DateFormats = TimeUtils.constants.formats.Date;

const defaultDisclaimer = function(extra) {
  // extra is an array; I want it to act like different rows/
  return function(language) {
    const defaultDis = {
      en:
        'similie is change. We specialize in delivering sustainable solutions for developing economies.<br/>We are similie,<br/>change by design',
      pt: '',
      tl: ''
    };
    const defaults = defaultDis[language];
    if (extra) {
      _.each(extra[language], extra => {
        defaults.push(extra);
      });
    }

    return defaults;
  };
};

module.exports = {
  translateIdentity: 'system_translations',
  fallbackLanguage: 'en',
  noLanguageSet: 'This variable has an undefined translation',
  pullLanguageFromModel: function(
    lanContent = {},
    language = Translates.fallbackLanguage
  ) {
    let content = lanContent[language];
    if (content) {
      return content;
    }
    content = lanContent[Translates.fallbackLanguage];
    if (content) {
      return content;
    }
    for (const key in lanContent) {
      if (!lanContent[key]) {
        continue;
      }
      return lanContent[key];
    }
    return '';
  },
  pull: function(language, key, cb) {
    // this pulls our variable.
    Variable.pullType(
      { key: key, identity: 'system_translation' },
      (err, variable) => {
        const word =
          variable.value[language] || variable.value[sails.config.language];
        cb(err, word);
      }
    );
  },

  disclaimer: function(language, variables, config) {
    const disclaimer = [];
    let defaultD;
    let selectedD;
    let disclaimerName;
    // csv_disclaimer_name
    // csv_disclaimer
    // json_data_disclaimer
    return {
      // we can rebuild this
      defaults: defaultDisclaimer(),
      model: function(schema) {
        const name = schema.name;

        _.each(variables, v => {
          if (v.key === 'csv_variables' && v.identity === 'csv_disclaimer') {
            defaultD = v;
          } else if (
            v.key === 'csv_variables' &&
            v.identity === 'csv_disclaimer_name'
          ) {
            disclaimerName = v;
          } else if (
            v.key === 'csv_variables' &&
            v.identity === name + '_disclaimer'
          ) {
            selectedD = v;
          }
        });

        const selected =
          ((selectedD || defaultD || {}).value || {})[language] ||
          ((selectedD || defaultD || {}).value || {})[
            config.default_language || Translates.fallbackLanguage
          ] ||
          this.defaults(Translates.fallbackLanguage);

        const parsed = Utils.parseLocals(selected, {
          date: TimeUtils.formattedDate(now_, DateFormats.medium),
          // [sg] date: moment().format('ll'),
          site_name: config.site_name,
          site_url: config.site_url,
          name: name
        });

        const breakUp = parsed.split('<br/>');
        _.each(breakUp, b => {
          disclaimer.push([b]);
        });

        const dName =
          ((disclaimerName || {}).value || {})[language] ||
          ((disclaimerName || {}).value || {})[
            config.default_language || Translates.fallbackLanguage
          ] ||
          'Disclaimer';

        return {
          disclaimer: disclaimer,
          disclaimerName: dName
        };
      }
    };
  },

  restrictedKey: function(key) {
    const rKeys = [
      'id',
      'meta',
      'contractor',
      'data_upload',
      'unknown_contact',
      'borehole_station',
      'createdAt',
      'updatedAt',
      'observer',
      'contact',
      'right_to_abstract',
      'location',
      'geo',
      'geoPoint',
      'district',
      'geo_feature',
      'files',
      'entitlement',
      'archived',
      'chemistry',
      'observation',
      'catchment_area'
    ];
    return _.contains(rKeys, key);
  },

  /*
   * language
   *
   * @legacy - pulls the language from the values
   * @todo:: remove
   */
  language: function(language) {
    return language || Translates.fallbackLanguage;
  },

  getLanguage: function(req, res) {
    return (
      req.session.language ||
      (req.user || {}).preferred_language ||
      ((res.locals || {}).siteData || {}).default_language ||
      sails.config.language ||
      Translates.fallbackLanguage
    );
  }
};
