/**
 * VideoCaptureController
 *
 * @description :: Server-side logic for managing Videocaptures
 * @help        :: See http://sailsjs.org/#!/documentation/concepts/Controllers
 */

const {
  VideoStream
} = require('../model-utilities/devices/video-stream/video-stream');
const {
  VideoStreamCollector
} = require('../model-utilities/devices/video-stream/video-stream-collector');
const SailsExtensions = require('../services/SailsExtensions');

module.exports = {
  available: async function(req, res) {
    const params = req.params.all();

    if (!params.id) {
      return res.badRequest({ error: 'A station ID is required' });
    }
    const vs = new VideoStreamCollector(params.id);
    const streams = await vs.findAll(1);

    return res.send({
      available: !!streams.length
    });
  },

  station: async function(req, res) {
    const params = req.params.all();

    if (!params.id) {
      return res.badRequest({ error: 'A station ID is required' });
    }
    const sort = SailsExtensions.sort(req);
    const limit = SailsExtensions.limit(req);
    const skip = SailsExtensions.skip(req);
    const vs = new VideoStreamCollector(params.id);
    const streams = params.all
      ? await vs.findAll(limit, skip, sort)
      : await vs.findToday();
    return res.send(streams);
  },

  play: async function(req, res) {
    const params = req.params.all();
    if (!params.id) {
      return res.badRequest({ error: 'A video ID is required' });
    }
    const vs = new VideoStream(req, res);
    await vs.play();
  },

  poster: async function(req, res) {
    const params = req.params.all();
    if (!params.id) {
      return res.badRequest({ error: 'A video ID is required' });
    }
    const vs = new VideoStream(req, res);
    await vs.poster();
  }
};
