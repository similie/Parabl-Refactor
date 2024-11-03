/**
 * DistrictsController
 *
 * @description :: Server-side logic for managing districts
 * @help        :: See http://sailsjs.org/#!/documentation/concepts/Controllers
 */

module.exports = {
  region: function(req, res) {
    const params = req.params.all();
    const code = params.id || params.code;
    if (!code) {
      return res.badRequest('errors.CODE_NEEDED_FOR_QUERY');
    }

    District.pullRegions(code)
      .then(districts => {
        if (!_.size(districts)) {
          return {};
        }

        const send = {
          id: code,
          code: code,
          districts: districts
        };
        const smallest = districts[District.findSmallestForGeo(districts)];

        if (!smallest || !smallest.geo) {
          return {};
        }
        return Geo.getCenter(smallest.geo).then(center => {
          send.center = center;
          return send;
        });
      })
      .then(payload => {
        if (!_.size(payload)) {
          return {};
        }

        return District.decorate(payload.districts).then(districts => {
          payload.districts = districts;
          return payload;
        });
      })
      .then(boundary => {
        res.send(boundary);
      })

      .catch(why => {
        sails.log.error(why);
        res.negotiate(why);
      });
  },

  findOne: function(req, res) {
    Utils.findOne(req, res, model => {
      District.decorate(model)
        .then(
          model => {
            res.ok(model);
          },
          why => {
            res.badRequest(why);
          }
        )
        .catch(why => {
          sails.log.error(why);
          res.serverError(why);
        });
    });
  },

  find: async function(req, res) {
    if (District.wantsAsName(req)) {
      return District.pullThroughJsonName(req, res);
    }

    Utils.getParser(req, res, models => {
      District.decorate(models)
        .then(
          models => {
            res.ok(models);
          },
          why => {
            res.badRequest(why);
          }
        )
        .catch(why => {
          sails.log.error(why);
          res.serverError(why);
        });
    });
  },

  simplify: function(req, res) {
    Geo.simplify(req, res);
  },

  findNearest: async function(req, res) {
    const params = req.params.all();
    if (!params.lat) {
      return res.badRequest({ error: 'A latitude param "lat" is required' });
    }

    if (!params.lng) {
      return res.badRequest({ error: 'A longitude param "lng" is required' });
    }

    const point = {
      lat: params.lat,
      lng: params.lng
    };

    try {
      const closest = await District.closestToPoint(point);
      const within = await District.pointWithin(point);
      const stations = await Geo.findClosestStation(point, '', false, 1);
      return res.send({ closest, within, stations });
    } catch (e) {
      sails.log.error('DistrictController.findNearest::', e.message);
      return res.serverError({ error: e.message });
    }
  }
};
