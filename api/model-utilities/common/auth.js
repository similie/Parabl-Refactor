class AuthManager {
  static getAuthStrategyProviders() {
    const strategies = sails.config.passport;
    const providers = {};
    // Get a list of available providers for use in your templates.
    Object.keys(strategies).forEach(function(key) {
      if (key === 'local') {
        return;
      }

      providers[key] = {
        name: strategies[key].name,
        slug: key
      };
    });
    return providers;
  }

  constructor(req, res) {
    this.req = req;
    this.res = res;
  }

  reqLogin(user) {
    return new Promise((resolve, reject) => {
      this.req.login(user, err => {
        if (err) {
          return reject(err);
        }
        resolve();
      });
    });
  }

  blastLogin(user) {
    return sails.sockets.blast('user_local_login', user);
  }

  get ttl() {
    const config = this.res.locals.siteData || {};
    return Site.getTTl(config);
  }
}

class AuthLoginManager extends AuthManager {
  constructor(req, res) {
    super(req, res);
  }

  getDirection() {
    const action = this.req.param('action');
    let direction = '/login';
    switch (action) {
      case 'register':
        direction = '/register';
        break;
      case 'disconnect':
        direction = 'back';
        break;
      // default:
      //     res.redirect('/login');
    }
    return direction;
  }

  sendError(error) {
    if (this.req.wantsJSON) {
      return this.res.send(error);
    }
    this.res.redirect(this.getDirection());
  }

  errorSetup(err) {
    const flashError = this.req.flash('error').pop();
    const error = { cssClass: 'warning' };
    if (err) {
      // sails.log.error(err);
      //  req.flash('error', 'Error.Passport.Generic');
      error.error = err;
    } else if (flashError) {
      this.req.flash('error', flashError);
      error.error = flashError;
    }
    return error;
  }

  tryAgain(err) {
    // Only certain error messages are returned via req.flash('error', someError)
    // because we shouldn't expose internal authorization errors to the user.
    // We do return a generic error and the original request body.
    const error = this.errorSetup(err);
    this.sendError(error);
  }

  needToApplyLanguage(user) {
    return (
      user.preferred_language &&
      user.preferred_language !== this.req.session.language &&
      !this.req.headers.authorization
    );
  }

  applyLanguageToStore(user) {
    this.req.store.add('language', user.preferred_language);
  }

  needToApplyLanguageToSession(user) {
    if (!this.req.store) {
      return false;
    }
    if (!this.req.headers.authorization) {
      return false;
    }
    if (!user.preferred_language) {
      return false;
    }
    const storeData = this.req.store.getData() || {};
    if (!storeData) {
      return false;
    }
    return storeData.language !== user.preferred_language;
  }

  setActivity() {
    return new Promise((resolve, reject) => {
      UserActivity.set(UserActivity.USER_LOCAL_LOGIN, null, this.req, function(
        err,
        activity
      ) {
        if (err) {
          return reject(err);
        }
        resolve(activity);
      });
    });
  }

  setLanguage(user) {
    this.req.session.language = user.preferred_language;
    this.req.setLocale(user.preferred_language);
    this.req.session.save();
  }

  async redisSession(activity) {
    Session.setSessionTimestamp(this.req);
    const sessionDetails = await Session.getSessionDetails(this.req, activity);
    const session = new Session(sessionDetails, this.ttl);
    const user = await session.online();
    await session.track();
    return user;
  }

  passportLogin() {
    return new Promise((resolve, reject) => {
      passport.callback(this.req, this.res, async (err, user, challenges) => {
        if (err) {
          return reject(err);
        }
        if (!user) {
          return reject(challenges);
        }
        resolve(user);
      });
    });
  }

  send(user, direction = '/') {
    if (this.req.wantsJSON) {
      if (direction) {
        return this.res.send({ __redirect: direction });
      }
      return this.res.send(user.toJSON());
    }
    this.res.redirect(direction);
  }

  getUserToken(user) {
    return User.findPasswordChangeInviteToken(
      user,
      Const.USER_TOKEN_GENERATION
    );
  }

  async manageReset(user) {
    try {
      const token = await this.getUserToken(user);
      const redirect = User.passwordResetToken(token);
      this.send(user, redirect);
    } catch (e) {
      return this.res.serverError({ error: e.message });
    }
  }

  accountInactive(user) {
    return user.user_access_disabled || !user.active;
  }

  async applySessionDetails(user) {
    if (this.needToApplyLanguage(user)) {
      this.setLanguage(user);
    }
    const activity = await this.setActivity();
    const sessionUser = await this.redisSession(activity);
    this.blastLogin(sessionUser);
    if (this.needToApplyLanguageToSession(sessionUser)) {
      this.applyLanguageToStore(sessionUser);
    }
    return sessionUser;
  }

  async login() {
    try {
      const user = await this.passportLogin();
      if (user.force_reset) {
        return this.manageReset(user);
      }
      if (this.accountInactive(user)) {
        return this.tryAgain('errors.USER_ACCOUNT_DISABLED');
      }
      await this.reqLogin(user);
      //   console.log('WHAT IS THIS', this.req);
      const sendUser = await this.applySessionDetails(user);
      this.send(sendUser);
    } catch (e) {
      sails.log.error('AUTH::Login::ERROR', e);
      if (!e.message) {
        return this.tryAgain(e);
      }
      this.tryAgain('errors.USER_LOGIN_FAILED');
    }
  }
}

class AuthLogoutManager extends AuthManager {
  constructor(req, res) {
    super(req, res);
  }

  findActivities() {
    return UserActivity.find({
      user: Model.getId(this.req.user),
      event: UserActivity.USER_LOCAL_LOGIN,
      sort: { createdAt: 'DESC' },
      limit: 1,
      resolution: null
    });
  }

  async managerActivities() {
    const activities = await this.findActivities();

    if (!activities || activities.length <= 0) {
      return;
    }

    const activity = activities.pop();
    if (!activity) {
      return;
    }
    activity.resolution = UserActivity.USER_LOCAL_LOGOUT;
    await activity.save();
  }

  get redirect() {
    const config = this.res.locals.siteData || {};
    return `/${config.public_site ? '' : 'login'}`;
  }

  send() {
    if (this.req.wantsJSON) {
      return this.res.ok();
    }
    this.res.redirect(this.redirect);
  }

  async destroyStore() {
    if (!this.req.store) {
      return;
    }
    return this.req.store.destroy();
  }

  torch() {
    return this.req.user.torchSession(UserSession.reqSession(this.req));
  }

  async logout() {
    if (!this.req.user) {
      return this.res.redirect(this.redirect);
    }
    try {
      await this.managerActivities();
      await Passport.terminateV15Session(this.req, this.res);
      await this.torch();
      await this.destroyStore();
      await this.req.user.offline();
      await this.req.logout();
      this.blastLogin();

      this.send();
    } catch (err) {
      sails.log.error(err);
    }
  }
}

class AuthApiManager extends AuthManager {
  constructor(req, res) {
    super(req, res);
    this.params = req.params.all();
  }

  validate(passport) {
    return new Promise((resolve, reject) => {
      passport.validatePassword(this.params.password, (err, valid) => {
        if (err) {
          return reject(err);
        }
        resolve(valid);
      });
    });
  }

  passport() {
    return Passport.findOne({
      accessToken: this.params.api_key,
      inactive: false
    });
  }

  async fallBackPassport(passport) {
    if (passport) {
      return;
    }
    const user = await User.findOne({ api_key: this.params.api_key });
    if (!user) {
      return null;
    }
    return Passport.findOne({
      user: Model.getId(user),
      inactive: false
    });
  }

  user(passport) {
    return User.findOneById(passport.user).populateAll();
  }

  send(user) {
    this.res.send(jwToken.issue(user));
  }

  async setSession(user, activity) {
    this.req.user = user;
    this.req.activity = activity;
    const session = new Session(this.req, this.ttl);
    await session.online();
    session.touch();
    session.add('user', user);
    session.track();
    return user.toJSON();
  }

  activity() {
    return new Promise((resolve, reject) => {
      UserActivity.set(
        UserActivity.USER_API_LOGIN,
        null,
        this.req,
        (err, activity) => {
          if (err) {
            return reject(err);
          }

          resolve(activity);
        }
      );
    });
  }

  async login() {
    try {
      let passport = await this.passport();
      if (!passport) {
        passport = await this.fallBackPassport(passport);
      }
      if (!passport) {
        return this.res.badRequest({ error: 'errors.USER_NOT_FOUND' });
      }

      try {
        await this.validate(passport);
      } catch {
        return this.res.badRequest({ error: 'errors.INVALID_PASSWORD' });
      }

      const user = await this.user(passport);

      if (!user) {
        return this.res.badRequest({ error: 'errors.USER_NOT_FOUND' });
      }

      if (!user.active) {
        return this.res.badRequest({ error: 'errors.USER_IS_NOT_VALID' });
      }

      await this.reqLogin(user);
      const activity = await this.activity();
      const sendUser = await this.setSession(user, activity);
      this.send(sendUser);
    } catch (e) {
      return this.res.badRequest({ error: e.message });
    }
  }
}

module.exports = {
  AuthManager,
  AuthLoginManager,
  AuthLogoutManager,
  AuthApiManager
};
