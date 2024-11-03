/**
 * SiteController
 *
 * @description :: Server-side logic for managing Sites
 * @help        :: See http://sailsjs.org/#!/documentation/concepts/Controllers
 */

module.exports = {
  forbidden: function(req, res) {
    res.forbidden();
  },

  findOne: function(req, res) {
    Utils.findOne(req, res, site => {
      Utils.setTTL(site);
      Site.restrictPrivates(req, site);
      res.send(site);
    });
  },

  find: function(req, res) {
    Utils.getParser(req, res, sites => {
      _.each(_.isArray(sites) ? sites : [sites], site => {
        Utils.setTTL(site);
        Site.restrictPrivates(req, site);
      });
      res.send(sites);
    });
  },

  online: function(req, res) {
    res.ok();
  },

  styles: function(req, res) {
    return res.badRequest({ error: 'This feature is no longer supported' });
  },

  publicDomain: async function(req, res) {
    const params = req.params.all();
    const site = await Site.findPublicSite(params);
    res.send(site);
  }
};
