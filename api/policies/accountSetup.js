module.exports = function(req, res, next) {
	const params = req.params.all();
	User.pullFromToken(params.token, (err, user) => {
      if (err) {
        return res.badRequest(err);
      }
      
      res.locals.newAccount = user;
      next();
    });

};
