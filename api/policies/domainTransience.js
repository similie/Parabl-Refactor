module.exports = function(req, res, next) {
  Domain.searchTransience(req, res, next);
};
