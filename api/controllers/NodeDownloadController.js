/**
 * NodeDownloadController
 *
 * @description :: Server-side logic for managing Nodedownloads
 * @help        :: See http://sailsjs.org/#!/documentation/concepts/Controllers
 */

module.exports = {
  getCount: async function(req, res) {
    try {
      const count = await NodeDownload.countAttributes(req, res);
      res.send({ total: count });
    } catch (e) {
      res.serverError({ error: e.message });
    }
  },

  build: async function(req, res) {
    try {
      const build = await NodeDownload.buildCraftedModel(req, res);
      const createdDownload = await NodeDownload.create(build);
      res.send(createdDownload);
    } catch (e) {
      res.serverError({ error: e.message });
    }
  },

  stream: async function(req, res) {
    // [AS]: these routes are already protected in the middleware
    try {
      const blankDownload = await NodeDownload.buildBlankModel(req, res);
      const createdDownload = await NodeDownload.create(blankDownload);
      res.send(createdDownload);
    } catch (e) {
      res.serverError({ error: e.message });
    }
  },

  streamReady: async function(req, res) {
    const params = req.params.all();
    const socket = Model.getId(req.socket);
    if (!socket) {
      return res.badRequest({ error: 'errors.SOCKET_ID_REQUIRED' });
    }

    const id = Model.getId(params);
    if (!id) {
      return res.badRequest({ error: 'errors.DOWNLOAD_ID_REQUIRED' });
    }

    const download = await NodeDownload.findOneById(id);
    if (!download) {
      return res.badRequest({
        error: 'errors.A_VALID_DOWNLOAD_CANNOT_BE_FOUND'
      });
    }
    download.socket = sails.sockets.getId(req);
    NodeDownload.applyJob(download);
    res.send(download);
  },

  lastdownload: async function(req, res) {
    const params = Utils.params(req);
    // set this to {recent: null} if you want to test lots of downloads
    if (!params.schema) {
      return res.badRequest({ error: 'danger.SCHEMA_REQUIRED' });
    }

    try {
      const lastDownload = await NodeDownload.getNonExpiredDownload(params);
      res.send({ recent: lastDownload });
    } catch (e) {
      sails.log.error('LAST DOWNLOAD ERROR::', e);
      res.send({ recent: null });
    }
  }
};
