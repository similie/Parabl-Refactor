module.exports = async function(req, res, next) {
  const params = req.params.all();
  const site = await Site.findPublicSite(params);
  res.locals.siteData = site || {};
  next();
};
