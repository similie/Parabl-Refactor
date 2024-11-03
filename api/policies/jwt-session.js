module.exports = function(req, res, next) {
  if (req.headers.authorization) {
    if (req.headers.authorization.startsWith('Bearer')) {
      return passport.authenticate('jwt-bearer', { session: false })(
        req,
        res,
        next
      );
    }

    passport.authenticate('jwt', { session: false })(req, res, next);
  } else {
    return next();
  }
};
