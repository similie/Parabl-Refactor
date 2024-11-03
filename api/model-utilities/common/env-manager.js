const { EnvManager } = require('one-env-crypt');

class EventAuthorizer {
  static #instance;
  constructor() {
    this._env = new EnvManager(EnvAuthManager.siteStaticId);
  }

  async site() {
    const site = await this.env.siteDetails();
    return site;
  }

  async match(key) {
    const match = await this.env.matches(key);
    return match;
  }

  get env() {
    return this._env;
  }

  static get instance() {
    if (!EventAuthorizer.#instance) {
      EventAuthorizer.#instance = new EventAuthorizer();
    }
    return EventAuthorizer.#instance;
  }
}

class EnvAuthManager {
  _auth;
  _req;
  _res;
  constructor(req, res) {
    this._auth = EventAuthorizer.instance;
    this._req = req;
    this._res = res;
  }

  static get siteStaticId() {
    return (
      process.env.SITE_ENVIRONMENT_KEY ||
      'similie-singapore-device-action-group'
    );
  }

  get authKey() {
    return this._req.headers.internal;
  }

  login(cb) {
    const user = User.getAnonymousUser(this._req, Roles.SIMILIE_ADMIN);
    this._req.login(user, err => {
      if (err) {
        return cb(err);
      }
      cb();
    });
  }

  async next(cb) {
    if (!this.authKey) {
      return cb('Authentication Key Required');
    }

    try {
      const match = await this._auth.match(this.authKey);
      sails.log.debug('Internal auth match', match);
      if (match) {
        return this.login(cb);
      }
    } catch (e) {
      sails.log.error('Internal Authorization Error', e);
    }
    this._res.forbidden('You are not authorized to access this environment');
  }
}

module.exports = { EnvAuthManager };
