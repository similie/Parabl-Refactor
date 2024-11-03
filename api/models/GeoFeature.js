/**
 * GeoFeature.js
 *
 * @description :: TODO: You might write a short summary of how this model works and what it represents here.
 * @docs        :: http://sailsjs.org/#!documentation/models
 */
const Q = require('q');

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    name: {
      type: 'json'
    },

    type: {
      model: 'variable'
    },

    color: {
      type: 'string',
      maxLength: 9
    },
    geo: {
      type: 'geometry' // this will contain the polygon
    },
    domain: {
      model: 'domain'
    },
    description: 'text',
    meta: {
      type: 'json'
    },

    restricted: {
      type: 'boolean'
    }

    //toJSON: Geo.stripJSON()
  },

  decorate: function(models, param) {
    var isOne = false;
    if (!_.isArray(models) && _.isObject(models)) {
      isOne = true;
      models = [models];
    }

    var deferred = Q.defer();

    var promises = [];
    _.each(models, station => {
      promises.push(decorations(station, param));
    });

    Q.allSettled(promises)
      .then(results => {
        if (isOne) {
          return deferred.resolve(models.pop());
        }
        deferred.resolve(models);
      })
      .catch(deferred.reject);

    return deferred.promise;
  },

  beforeValidate: function(values, next) {
    this.catchSeeds(values, err => {
      if (err) {
        return next();
      }

      Geo.setGeo(values, next);
    });
  },

  // afterUpdate: function(values, next) {
  //     Geo.updateGeo(values, 'geofeature', next);
  // },
  // afterCreate: function(values, next) {
  //     Geo.updateGeo(values, 'geofeature', next);
  // },

  // beforeUpdate: function(values, next) {
  //     this.strip(values, function() {
  //         Geo.parseLocation(values, next);
  //     });
  // },

  beforeCreate: function(values, next) {
    values.color = values.color || Utils.color();
    next();
  },

  catchSeeds: function(values, next) {
    if (values.seed) {
      Variable.pullType(
        { identity: values.seed.identity, key: values.seed.key },
        (err, vars) => {
          if (err) {
            sails.log.error(err);
            return next(err);
          }
          values.type = (vars || {}).id;
          values.color = ((vars || {}).meta || {}).color;
          delete values.seed;
          next();
        }
      );
    } else {
      return next();
    }
  },

  geo: function() {
    return ['point', 'polygon', 'polyline'];
  },

  translateKey: function() {
    return 'name';
  },

  strip: function(values, next) {
    if (values.primary) {
      values.primary_feature = null;
    }

    Variable.pullType(
      [{ identity: 'water_course', key: 'geo_feature' }],
      (err, models) => {
        if (err) {
          sails.log.error(err);
          return next(err);
        }

        var id = _.pluck(models, 'id');

        if (id.length && values.type != id[0]) {
          values.watercourse = null;
        }

        next();
      }
    );
  }
};

function decorations(models, param) {
  return Q.fcall(() => {
    return Geo.pullGeoFeature(models, 'geo', param);
  });
}
