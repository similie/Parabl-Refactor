/**
 * Authentication Controller
 *
 * This is merely meant as an example of how your Authentication controller
 * should look. It currently includes the minimum amount of functionality for
 * the basics of Passport.js to work.
 */

const {
  AuthLoginManager,
  AuthLogoutManager,
  AuthManager,
  AuthApiManager
} = require('../model-utilities/common/auth');

const AuthController = {
  inviteerror: function(req, res) {
    res.view();
  },

  refresh_token: function(req, res) {
    const user = req.user;

    if (!user) {
      return res.badRequest();
    }

    res.send(jwToken.issue(user.toJSON()));
  },

  api_login: async function(req, res) {
    const params = req.params.all();

    if (!params.api_key) {
      return res.badRequest({ error: 'errors.API_KEY_REQUIRED' });
    }

    if (!params.password) {
      return res.badRequest({ error: 'errors.API_KEY_REQUIRED' });
    }

    const apiManager = new AuthApiManager(req, res);
    await apiManager.login();
  },

  profile: function(req, res) {
    const params = req.params.all();

    if (
      (params.user && User.getId(params.user) !== User.getId(req.user)) ||
      !params.user
    ) {
      return res.forbidden();
    }

    if (!params.changes) {
      return res.badRequest();
    }

    User.findOneById(params.user.id).exec(function(err, user) {
      if (err) {
        return res.serverError();
      }

      if (params.changes.username) {
        user.username = params.changes.username;

        user.save(function(err) {
          if (err) {
            return res.serverError();
          }

          if (params.changes.password) {
            User.resetPassword(
              {
                user: user.id,
                password: params.changes.password
              },
              function(err) {
                if (err) {
                  return res.serverError();
                }
                res.send(user.toJSON());
              },
              true
            );
          } else {
            res.send(user.toJSON());
          }
        });
      } else if (params.changes.password) {
        User.resetPassword(
          {
            user: user.id,
            password: params.changes.password
          },
          function(err, user) {
            if (err) {
              return res.serverError();
            }
            res.send(user.toJSON());
          },
          true
        );
      } else {
        res.send(user.toJSON());
      }
    });
  },

  resendInvite: function(req, res) {
    const params = req.params.all();

    if (!params.user) {
      return res.badRequest();
    }

    User.findOneById(params.user).exec(function(err, user) {
      if (err) {
        return res.serverError();
      }

      if (user.active) {
        return res.badRequest(req.__('ACTIVE_USER'));
      }

      user.activateEmail(req, res, function(err) {
        if (err) {
          return res.serverError();
        }

        res.send({
          message: 'user.INVITE_SENT'
        });
      });
    });
  },

  /*
   * This controller manages the view for the invited users
   * /activate-account
   */
  inviteUser: function(req, res) {
    const params = req.params.all();
    if (!params.token) {
      return res.forbidden();
    }
    res.view('index/index');
  },

  activateAccount: function(req, res) {
    const params = req.params.all();

    if (params.password !== params.password_validate) {
      req.flash('error', 'errors.PASSWORD_MISMATCH');
      return res.redirect('/activate-account?token=' + params.token);
    }

    if (!params.username) {
      req.flash('error', 'errors.TRY_AGAIN');
      return res.redirect('/activate-account?token=' + params.token);
    }

    if (!params.first_name) {
      req.flash('error', 'errors.TRY_AGAIN');
      return res.redirect('/activate-account?token=' + params.token);
    }

    if (!params.last_name) {
      req.flash('error', 'errors.TRY_AGAIN');
      return res.redirect('/activate-account?token=' + params.token);
    }

    const target = (res.locals.invite || {}).target;

    if (!target) {
      req.flash('error', 'errors.INVITE_ERROR');
      return res.redirect('/activate-account?token=' + params.token);
    }

    User.finishActivation(params, target, err => {
      if (err) {
        sails.log.error(err);
        // Check if it's a validation error or a crash
        if (err.code === 'E_VALIDATION') {
          if (req.wantsJSON) {
            return res.badRequest('errors.INVALID_USERNAME');
          } else {
            req.flash('error', 'errors.INVALID_USERNAME');
            return res.redirect('/activate-account?token=' + params.token);
          }
        } else return res.serverError(err);
      }

      if (req.wantsJSON) {
        res.send({ message: 'info.ACCOUNT_ACTIVE', cssClass: 'info' });
      } else {
        req.flash('message', 'ACCOUNT_ACTIVE');
        res.redirect('/login');
      }
    });
  },

  /*
   * Post route for updating the password. Protected by the token validation
   * policy
   */
  updatePassword: function(req, res) {
    const params = req.params.all();

    if (params.password !== params.password_validate) {
      req.flash('error', 'PasswordMismatch');
      return res.redirect('/reset-password?token=' + params.token);
    }

    if (!params.user) {
      if (req.wantsJSON) {
        res.send({ message: 'info.USER_NOT_PROVIDED', cssClass: 'error' });
      } else {
        req.flash('error', 'TryAgain');
        return res.redirect('/reset-password?token=' + params.token);
      }
    }

    User.resetPassword(params, err => {
      if (err) {
        return res.serverError(err);
      }

      if (req.wantsJSON) {
        res.send({ message: 'info.PASSWORD_CHANGED', cssClass: 'info' });
      } else {
        req.flash('message', 'info.PASSWORD_CHANGED');
        res.redirect('/login');
      }

      // res.redirect('/reset-password?token=' + params.token);
    });
  },

  /*
   * This controller manages the actual password change.
   * It's protected by the password validation policy.
   */
  resetPassword: function(req, res) {
    const params = req.params.all();
    if (!params.token) {
      return res.forbidden();
    }
    // show the view
    res.view({
      errors: req.flash('error')
    });
  },

  /*
   * Resets the user password with the
   * reset workflow. Initialized with email
   * and invite token
   */
  reset: function(req, res) {
    const params = req.params.all();
    const config = res.locals.siteData;
    const expire = 2;

    User.passwordReset(params.identifier, config, expire, (err, message) => {
      if (err) {
        req.flash('error', err);

        if (req.wantsJSON) {
          return res.badRequest(err);
        } else {
          return res.redirect('/password-reset');
        }
      }

      req.flash('message', message);

      if (req.wantsJSON) {
        res.send(message);
      } else {
        res.redirect('/login');
      }
    });
  },

  passwordReset: function(req, res) {
    res.view({
      errors: req.flash('error')
    });
  },

  /**
   * Render the login page
   *
   * The login form itself is just a simple HTML form:
   *
      <form role="form" action="/auth/local" method="post">
        <input type="text" name="identifier" placeholder="Username or Email">
        <input type="password" name="password" placeholder="Password">
        <button type="submit">Sign in</button>
      </form>
   *
   * You could optionally add CSRF-protection as outlined in the documentation:
   * http://sailsjs.org/#!documentation/config.csrf
   *
   * A simple example of automatically listing all available providers in a
   * Handlebars template would look like this:
   *
      {{#each providers}}
        <a href="/auth/{{slug}}" role="button">{{name}}</a>
      {{/each}}
   *
   * @param {Object} req
   * @param {Object} res
   */
  login: function(req, res) {
    if (req.wantsJSON) {
      return res.ok();
    }
    res.view({
      providers: AuthManager.getAuthStrategyProviders(),
      errors: req.flash('error'),
      messages: req.flash('message')
    });
    // Render the `auth/login.ext` view
  },

  /**
   * Log out a user and return them to the homepage
   *
   * Passport exposes a logout() function on req (also aliased as logOut()) that
   * can be called from any route handler which needs to terminate a login
   * session. Invoking logout() will remove the req.user property and clear the
   * login session (if any).
   *
   * For more information on logging out users in Passport.js, check out:
   * http://passportjs.org/guide/logout/
   *
   * @param {Object} req
   * @param {Object} res
   */
  logout: async function(req, res) {
    const authManager = new AuthLogoutManager(req, res);
    return authManager.logout();
  },

  /**
   * Render the registration page
   *
   * Just like the login form, the registration form is just simple HTML:
   *
      <form role="form" action="/auth/local/register" method="post">
        <input type="text" name="username" placeholder="Username">
        <input type="text" name="email" placeholder="Email">
        <input type="password" name="password" placeholder="Password">
        <button type="submit">Sign up</button>
      </form>
   *
   * @param {Object} req
   * @param {Object} res
   */
  register: function(req, res) {
    res.view({
      errors: req.flash('error')
    });
  },

  /**
   * Create a authentication callback endpoint
   *
   * This endpoint handles everything related to creating and verifying Pass-
   * ports and users, both locally and from third-aprty providers.
   *
   * Passport exposes a login() function on req (also aliased as logIn()) that
   * can be used to establish a login session. When the login operation
   * completes, user will be assigned to req.user.
   *
   * For more information on logging in users in Passport.js, check out:
   * http://passportjs.org/guide/login/
   *
   * @param {Object} req
   * @param {Object} res
   */
  provider: function(req, res) {
    passport.endpoint(req, res);
  },

  callback: async function(req, res) {
    const authManager = new AuthLoginManager(req, res);
    await authManager.login();
  },

  /**
   * Disconnect a passport from a user
   *
   * @param {Object} req
   * @param {Object} res
   */
  disconnect: function(req, res) {
    passport.disconnect(req, res);
  }
};

module.exports = AuthController;
