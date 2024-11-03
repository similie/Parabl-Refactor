/**
 * GeoFeatureController
 *
 * @description :: Server-side logic for managing Geofeatures
 * @help        :: See http://sailsjs.org/#!/documentation/concepts/Controllers
 */
const escape = require('pg-escape');

module.exports = {
  findOne: function(req, res) {
    Utils.findOne(req, res, model => {
      GeoFeature.decorate(model)
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

  find: function(req, res) {
    Utils.getParser(req, res, models => {
      GeoFeature.decorate(models)
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

  min: function(req, res) {
    const params = req.params.all();
    let escaped =
      'SELECT row_to_json(t) as name, row_to_json(v) as type, g.id, g.description FROM geofeature as g LEFT JOIN "translation" as t ON (g.name = t.id) LEFT JOIN variable as v ON (g.type = v.id)';
    // SELECT row_to_json(t) as name, row_to_json(v) as type, g.id, g.description FROM geofeature as g LEFT JOIN "translation" as t ON (g.name = t.id) LEFT JOIN variable as v ON (g.type = v.id) WHERE g.type IN (22, 25) ;
    // SELECT row_to_json(t) as name, row_to_json(v) as type, g.id, g.description FROM geofeature as g LEFT JOIN "translation" as t ON (g.name = t.id) LEFT JOIN variable as v ON (g.type = v.id) WHERE g.primary = false AND g.primary_feature = 693 ;
    if (params.primary) {
      escaped += ' WHERE g.primary = ' + params.primary;
    } else {
      escaped += ' WHERE';
    }

    if (params.type) {
      escaped +=
        ' ' + (params.primary ? 'AND ' : '') + 'g.type = ' + params.type;
    }

    if (params.primary_feature) {
      escaped +=
        ' ' +
        (params.primary ? 'AND ' : '') +
        'g.primary_feature = ' +
        params.primary_feature;
    }
    GeoFeature.query(escape(escaped), (err, results) => {
      if (err) {
        return res.serverError(err);
      }

      res.send(results.rows);
    });
  },

  checkFeaturesAvaibility: async function(req, res) {
    const params = req.params.all();
    const query = escape(
      `select g.type from geofeature g where "type" in (${params.ids.join(
        ', '
      )}) group by "type" `
    );
    const data = await GeoFeature.queryAsync(query);
    const availableIDs = data.rows.map(m => m.type);

    res.send(availableIDs);
  }
};
