/**
 * JWT Authentication Protocol
 *
 *
 * @param {Object}   req
 * @param {string}   identifier
 * @param {Function} next
 */
exports.login = function(token = {}, next) {
  const id = token.user ? Model.getId(token.user) : Model.getId(token);
  User.findOneById(id).exec((err, user) => {
    if (err) {
      return next(err, false);
    }

    if (user) {
      return next(null, user);
    } else {
      return next(null, false);
      // or you could create a new account
    }
  });
};
