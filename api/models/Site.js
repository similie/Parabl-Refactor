/**
 * Site.js
 *
 * @description :: TODO: You might write a short summary of how this model works and what it represents here.
 * @docs        :: http://sailsjs.org/documentation/concepts/models-and-orm/models
 */

const fs = require('fs');
const checkInternetConnected = require('check-internet-connected');
const { CommonUtils } = require('similie-api-services');
module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    site_email: {
      type: 'email'
    },
    site_name: {
      type: 'string'
    },
    style_mode: {
      type: 'string'
    },
    restricted: {
      type: 'boolean',
      defaultsTo: true
    },

    motivation: {
      type: 'boolean',
      defaultsTo: true
    },

    survey: {
      type: 'boolean',
      defaultsTo: false
    },

    logistics: {
      type: 'boolean',
      defaultsTo: false
    },

    graph_not_approved: {
      type: 'boolean',
      defaultsTo: false
    },

    currency: {
      type: 'string',
      defaultsTo: 'USD'
    },

    site_url: {
      type: 'string'
    },

    max_users: {
      type: 'integer'
    },

    max_nodedownload: {
      type: 'integer'
    },

    file_size_restriction: {
      type: 'integer'
    },

    require_d_codes: {
      type: 'boolean',
      defaultsTo: true
    },

    secure_protocol: {
      type: 'boolean',
      defaultsTo: false
    },

    sounds: {
      type: 'json'
    },

    constants: {
      type: 'json'
    },

    disable_cache: {
      type: 'boolean',
      defaultsTo: true
    },

    has_early_warning: {
      type: 'boolean',
      defaultsTo: false
    },

    public_site: {
      type: 'boolean',
      defaultsTo: false
    },

    personnel_site: {
      type: 'boolean',
      defaultsTo: false
    },

    payroll: {
      type: 'boolean',
      defaultsTo: false
    },

    languages: {
      type: 'array'
    },

    default_language: {
      type: 'string',
      minLength: '2',
      maxLength: '2',
      defaultsTo: 'en'
    },

    language_labels: {
      type: 'json'
    },

    station_type: {
      type: 'array'
    },

    api_route: {
      type: 'string',
      defaultsTo: '/api/v1/',
      maxLength: 100
    },

    integrations: {
      type: 'json'
    },

    file_cache: {
      type: 'string',
      defaultsTo: '86400'
    },

    files: {
      type: 'json'
    },

    gods: {
      type: 'array'
    },

    address_format: {
      type: 'array'
    },

    active: {
      type: 'boolean',
      defaultsTo: true
    },

    starting_geopoint: {
      type: 'json'
    },

    geopoint_thresholds: {
      type: 'json'
    },

    retail_adjusted_cost: {
      type: 'integer',
      min: 0,
      max: 100
    },

    roles: {
      type: 'json',
      defaultsTo: {
        SIMILIE_ADMIN: 9,
        DOMAIN_ADMIN: 8,
        SITE_ADMIN: 7,
        USER_ADMIN: 6,
        MANAGER: 5,
        RECORDER: 4,
        REPORTER: 3,
        SURVEYOR: 2,
        VISITOR: 1,
        ANONYMOUS: 0
      }
    },

    auth_profiles: {
      type: 'json'
    },

    colors: {
      type: 'json'
    },

    permits: {
      type: 'json'
    },

    logos: {
      type: 'json'
    },

    ldap_enabled: {
      type: 'boolean',
      defaultsTo: false
    },

    owner: {
      model: 'user'
    },

    default_page_view: {
      type: 'string',
      in: ['map', 'rows', 'forecast', 'charts', 'simulation'],
      defaultsTo: 'map'
    },

    index_reports: {
      type: 'boolean',
      defaultsTo: false
    },

    report_tags: {
      collection: 'tag'
    },

    routes: {
      type: 'json',
      defaultsTo: {
        '/': {
          name: 'mekong',
          description:
            'Powerful water resource management system created by similie'
        }
      }
    },

    demo_site: {
      type: 'boolean',
      defaultsTo: false
    },

    navigation: {
      type: 'json',
      defaultsTo: {
        'app.profile': 'VISITOR',
        'app.stats': 'REPORTER',
        'app.messages': 'SURVEYOR',
        'app.domains': 'DOMAIN_ADMIN',
        'app.site': 'SITE_ADMIN',
        'app.users': 'USER_ADMIN',
        'app.variables': 'SITE_ADMIN',
        'app.tags': 'SITE_ADMIN',
        'app.globals': 'REPORTER',
        'app.districts': 'SITE_ADMIN',
        'app.geofeatures': 'SITE_ADMIN',
        'app.reports': 'MANAGER',
        'app.contacts': 'REPORTER',
        'app.contractors': 'REPORTER',
        'app.surveys': 'SURVEYOR',
        'app.dashboard': 'VISITOR'
      }
    },

    router: {
      type: 'json',
      defaultsTo: {
        SURVEYOR: 'app.surveys',
        VISITOR: 'app.dashboard'
      }
    },

    domain: {
      model: 'domain',
      unique: true
    },

    public_sms: {
      type: 'boolean',
      defaultsTo: false
    },

    meta: {
      type: 'json'
    },

    require_user_license: {
      type: 'boolean',
      defaultsTo: false
    },

    simulation: {
      type: 'boolean',
      defaultsTo: false
    },

    buildUrl: function() {
      return Site.buildUrl(this.toObject()); // `${config.secure_protocol ? 'https://'}`
    }
  },

  _straps: [
    /*
     *
     */

    function(cb) {
      return cb();
    }
  ],

  isProcessMaster: function() {
    const clusterRole = process.env.CLUSTERED;
    const processMaster = !clusterRole || clusterRole === 'master';
    return processMaster;
  },

  getTTl: function(site = {}) {
    return +site.file_cache || 86400;
  },

  rawDefaultSite: function() {
    return sails.config.seeds.site()[0];
  },

  getImportBase: function() {
    let path = sails.config.paths.tmp;
    path = path.replace('.tmp', 'import');
    fs.existsSync(path) || fs.mkdirSync(path);
    return path;
  },

  restrictPrivates: function(req, site) {
    if (
      (!req.user || !User.is(req.user, Roles.SIMILIE_ADMIN)) &&
      _.size((site.meta || {}).privates)
    ) {
      _.each(site.meta.privates, (d, key) => {
        _.each(d, (p, k) => {
          if (p) delete site[key][k];
        });
      });
    }
  },

  ON_LINE_THRESHOLD_HIGH: 'HIGH',
  ON_LINE_THRESHOLD_LOW: 'MED',

  findPublicSite: async function(params = {}) {
    const query = {};
    if (params.domain) {
      const dId = params.domain || 'default';
      const domainId = dId === 'default' ? null : this.getId(dId);
      query.domain = domainId;
    } else if (params.user) {
      const domain = await Domain.findDomainThroughUser(params.user);
      query.domain = Model.getId(domain);
    } else {
      return {};
    }
    return this.thisSiteAsync(query.domain);
  },

  isOnline: function(threshold) {
    const config = {
      // timeout: 500, //timeout connecting to each server(A and AAAA), each try (default 5000)
      // retries: 1, //number of retries to do before failing (default 5)
      domain: 'google.com' // the domain to check DNS record of
    };
    switch (threshold) {
      case this.ON_LINE_THRESHOLD_HIGH:
        config.timeout = 10000;
        config.retries = 5;
        break;
      case this.ON_LINE_THRESHOLD_LOW:
        config.timeout = 500;
        config.retries = 1;
        break;
    }

    return new Promise(resolve => {
      checkInternetConnected(config)
        .then(() => {
          resolve(true);
        })
        .catch(() => {
          resolve(false);
        });
    });
  },

  passThrough: function(model) {
    return model === 'site';
  },

  thisSiteAsync: function(domain) {
    const _this = this;
    return new Promise(function(resolve, reject) {
      let q = {
        active: true,
        domain: null
      };

      if (domain) {
        if (domain.site) {
          q = {};
          q.id = _this.getId(domain.site);
        } else {
          q.domain = _this.getId(domain);
        }
      }
      Site.findOne(q).exec(function(err, d) {
        if (err) {
          return reject(err);
        }
        resolve(d);
      });
    });
  },

  siteLanguage: async function(domain) {
    const config = await this.thisSiteAsync(domain);
    return config.default_language || Translates.fallbackLanguage;
  },

  thisSite: function(cb, domain) {
    let q = {
      active: true,
      domain: null
    };

    if (domain) {
      if (domain.site) {
        q = {};
        q.id = this.getId(domain.site);
      } else {
        q.domain = this.getId(domain);
      }
    }
    Site.findOne(q).exec(cb);
  },

  beforeValidate: function(values, next) {
    if (!values.meta || !values.meta.import) {
      return next();
    }

    const keys = _.keys(values.meta.import);

    let variables = [];

    _.each(keys, key => {
      const imports = _.map(values.meta.import[key], imp => {
        return {
          key: key,
          identity: imp
        };
      });

      variables = _.union(variables, imports);
    });

    const model = this.attributes;

    Variable.pullType(variables, (err, variables) => {
      if (err) {
        return next(err);
      }

      variables.forEach(variable => {
        // if it is a string, then we need to fined our variable
        const value = _.where(variables, {
          key: variable.key,
          identity: variable.identity
        });

        if (!value.length) {
          return next('errors.INCORRECT_VARIABLE');
        }

        if (
          model[variable.key].type === 'array' ||
          model[variable.key].collection
        ) {
          values[variable.key] = values[variable.key] || [];
          values[variable.key].push(value[0].id);
        } else {
          values[variable.key] = value[0].id;
        }
      });

      delete values.meta.import;

      next();
    });
  },

  beforeCreate: function(values, next) {
    /*
     * Need to reconsider the current logic
     * this my not be appropriate for domians
     */
    next();
  },

  isInTestMode: function() {
    return (
      process.env.NODE_ENV === 'test' || process.env.WEBPACK_ENV === 'test'
    );
  },

  isProd: function() {
    return (
      process.env.NODE_ENV === 'production' ||
      process.env.WEBPACK_ENV === 'production'
    );
  },

  isInTestOrProductionMode: function() {
    return this.isInTestMode() || this.isProd();
  },

  buildUrl: function(config = {}) {
    return CommonUtils.pullHost(config); // `${config.secure_protocol ? 'https://'}`
  }
};
