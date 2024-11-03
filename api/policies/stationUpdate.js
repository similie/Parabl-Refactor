const _lo = require('lodash');

module.exports = function(req, _res, next) {
  if (req.method === 'GET') {
    return next();
  }

  const params = req.params.all();
  if (Object.keys(params).length) {
    const restricted = [
      'id',
      'schema',
      'meta',
      'geoPoint',
      'features',
      'createdAt',
      'updatedAt',
      'station_type'
    ];

    Station.findOne({ id: params.id })
      .populateAll()
      .exec((err, s) => {
        if (err) {
          return next(err);
        }

        const station = _.clone(s.toJSON());
        station.files = _.pluck(station.files, 'id');

        const schema = Station._attributes;
        _.each(schema, (s, key) => {
          if (s.model && s.model === 'variable') {
            station[key] = Station.getId(station[key]);
          }
        });

        const meta = { update: [] };
        const setupMeta = function(params, schema) {
          _.each(params, (_v, key) => {
            let stationParam = station[key];

            if (schema) {
              station[schema] = station[schema] || {};
              stationParam = station[schema][key];
            }

            const number = _.isFinite(stationParam);
            let keyValue = params[key];
            if (number) {
              keyValue = _lo.isInteger(keyValue)
                ? parseInt(keyValue)
                : parseFloat(keyValue);
            }

            let equal = keyValue === stationParam;

            if (_.isObject(keyValue)) {
              equal = _.isEqual(keyValue, stationParam);
            }

            if (restricted.indexOf(key) === -1 && !equal) {
              meta.update.push({
                key: key,
                from: stationParam,
                to: params[key]
              });
            }
          });
        };

        setupMeta(params);
        if (params.schema) {
          setupMeta(params.schema, 'schema');
        }

        params.meta = params.meta || {};
        params.meta.update = meta.update || [];
        Activity.createActivity(params, 'station_updated');
        next();
      });
  }
};
