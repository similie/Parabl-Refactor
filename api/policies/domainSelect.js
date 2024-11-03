/*
 * We use this policy to set the domains
 * for any incomming requests
 */
module.exports = function(req, res, next) {
  Domain.domainSelect(req, res, next);
};
