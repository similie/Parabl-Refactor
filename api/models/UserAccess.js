/**
 * UserAccess.js
 *
 * @description :: TODO: You might write a short summary of how this model works and what it represents here.
 * @docs        :: http://sailsjs.org/documentation/concepts/models-and-orm/models
 */

module.exports = {
  attributes: {
    station: {
      model: 'station'
    },

    entity: {
      type: 'string',
      in: [
        'node',
        'station',
        'stationschema',
        'domain',
        'sysfile',
        'tag',
        'param'
      ]
    },

    target: {
      type: 'integer'
    },

    roles: {
      type: 'array'
    },

    users: {
      collection: 'user'
    },

    global: {
      type: 'boolean',
      defaultsTo: false
    },

    domain: {
      type: 'domain'
    },

    tags: {
      collection: 'tag'
    }
  },

  control: async function(models, user, access) {
    const ua = (await UserAccess.find(access)) || {};
    if (!_.size(ua)) {
      return models;
    }
    const isArray = _.isArray(models);
    const mods = isArray ? models : [models];
    const passport = _.clone(access);
    const hold = [];

    for (let i = 0; i < _.size(mods); i++) {
      const m = mods[i];
      if (m) {
        const p = _.clone(passport);
        p.target = m.id;
        if (user.hasAccess(p, ua)) {
          hold.push(m);
        }
      }
    }

    return isArray ? hold : hold[0];
  },

  beforeCreate: function(values, next) {
    const query = {
      target: values.target,
      entity: values.entity
    };

    if (values.station) {
      query.station = values.id;
    }

    UserAccess.find(query).exec((err, found) => {
      if (err) {
        return next(err);
      }

      if (_.size(found)) {
        const ids = _.pluck(found, 'id');
        UserAccess.destroy({ id: ids }).exec(err => {
          if (err) {
            return next(err);
          }

          next();
        });
      } else {
        return next();
      }
    });
  }
};
