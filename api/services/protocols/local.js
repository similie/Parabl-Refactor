var validator = require("validator");
var crypto = require("crypto");

/**
 * Local Authentication Protocol
 *
 * The most widely used way for websites to authenticate users is via a username
 * and/or email as well as a password. This module provides functions both for
 * registering entirely new users, assigning passwords to already registered
 * users and validating login requesting.
 *
 * For more information on local authentication in Passport.js, check out:
 * http://passportjs.org/guide/username-password/
 */

/**
 * Register a new user
 *
 * This method creates a new user from a specified email, username and password
 * and assign the newly created user a local Passport.
 *
 * @param {Object}   req
 * @param {Object}   res
 * @param {Function} next
 */
exports.register = function(req, res, next) {
  var email = req.param("email"),
    username = req.param("username"),
    password = req.param("password");

  if (!email) {
    req.flash("error", "Error.Passport.Email.Missing");
    return next(new Error("No email was entered."));
  }

  if (!username) {
    req.flash("error", "Error.Passport.Username.Missing");
    return next(new Error("No username was entered."));
  }

  if (!password) {
    req.flash("error", "Error.Passport.Password.Missing");
    return next(new Error("No password was entered."));
  }

  User.create(
    {
      username: username,
      email: email
    },
    (err, user) => {
      if (err) {
        if (err.code === "E_VALIDATION") {
          if (err.invalidAttributes.email) {
            req.flash("error", "Error.Passport.Email.Exists");
          } else {
            req.flash("error", "Error.Passport.User.Exists");
          }
        }

        return next(err);
      }

      // Generating accessToken for API authentication
      var token = crypto.randomBytes(48).toString("base64");

      Passport.create(
        {
          protocol: "local",
          password: password,
          user: user.id,
          accessToken: token
        },
        (err) => {
          if (err) {
            if (err.code === "E_VALIDATION") {
              req.flash("error", "Error.Passport.Password.Invalid");
            }

            return user.destroy(destroyErr => {
              next(destroyErr || err);
            });
          }

          next(null, user);
        }
      );
    }
  );
};

/**
 * Assign local Passport to user
 *
 * This function can be used to assign a local Passport to a user who doens't
 * have one already. This would be the case if the user registered using a
 * third-party service and therefore never set a password.
 *
 * @param {Object}   req
 * @param {Object}   res
 * @param {Function} next
 */
exports.connect = function(req, res, next) {
  var user = req.user,
    password = req.param("password");

  Passport.findOne(
    {
      protocol: "local",
      user: user.id
    },
    (err, passport) => {
      if (err) {
        return next(err);
      }

      if (!passport) {
        Passport.create(
          {
            protocol: "local",
            password: password,
            user: user.id
          },
          (err) => {
            next(err, user);
          }
        );
      } else {
        return next(null, user);
      }
    }
  );
};

/**
 * Validate a login request
 *
 * Looks up a user using the supplied identifier (email or username) and then
 * attempts to find a local Passport associated with the user. If a Passport is
 * found, its password is checked against the password supplied in the form.
 *
 * @param {Object}   req
 * @param {string}   identifier
 * @param {string}   password
 * @param {Function} next
 */
exports.login = function(req, identifier, password, next) {
  var isEmail = validator.isEmail(identifier),
    query = {};

  if (isEmail) {
    query.email = identifier;
  } else {
    query.username = identifier;
  }

  query.archive = false;

  User.findOne(query)
    .populateAll()
    .exec((err, user) => {
      if (err) {
        sails.log.error("AUTHENTICATION ERROR::", err);
        return next(err, false, "errors.UNKNOWN_ERROR");
      }
      if (!user) {
        var error = "errors.USERNAME_NOT_FOUND";
        if (isEmail) {
          //req.flash('error', 'errors.USERNAME_NOT_FOUND' );
          error = "errors.EMAIL_NOT_FOUND";
        }
        // else {
        //req.flash('error', 'errors.USERNAME_NOT_FOUND' );
        // /}
        return next(null, false, error);
      }

      Passport.findOne(
        {
          protocol: "local",
          user: user.id,
          inactive: false
        },
        (err, passport) => {
          if (err) {
            sails.log.error(err);
            return next(err);
          }

          if (passport) {
            passport.validatePassword(password, (err, res) => {
              if (err) {
                return next(err);
              }

              if (!res) {
                //req.flash('error', 'errors.WRONG_PASSWORD' );
                return next(null, false, "errors.WRONG_PASSWORD");
              } else {
                return next(null, user);
              }
            });
          } else {
            //req.flash('error', 'errors.PASSWORD_NOT_SET' );
            return next(null, false, "errors.PASSWORD_NOT_SET");
          }
        }
      );
    });
};
