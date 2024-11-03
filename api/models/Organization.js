/**
 * Organization.js
 *
 * @description :: A model definition represents a database table/collection.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    name: {
      type: 'string'
    },
    badge: {
      model: 'badging'
    },
    connected_station: {
      model: 'station'
      // unique: true
    },
    meta: {
      type: 'json'
    },
    active: {
      type: 'boolean',
      defaultsTo: true
    },
    careers: {
      collection: 'variable'
    },
    domain: {
      model: 'domain'
    }
  },

  buildBadgeCache: function(orgs) {
    const bCache = {};
    for (let i = 0; i < _.size(orgs); i++) {
      const org = orgs[i];
      bCache[this.getId(org)] = org.badge || null;
    }
    return bCache;
  },

  stationOrgClone: async function(station) {
    const badge = await StationBadge.find({
      limit: 1,
      sort: { createdAt: 'DESC' }
    }).where({ station: Station.getId(station) });
    const _station = {
      ...station,
      badge: Badge.getId(badge.pop())
    };

    const params = {
      name: 'local_name',
      badge: 'badge',
      connected_station: 'id'
    };
    const organization = { active: true };
    _.each(params, (v, k) => {
      organization[k] = _station[v];
    });
    return organization;
  },

  findUsers: function(organizations = []) {
    const orgIds = [];
    for (const org of organizations) {
      orgIds.push(this.getId(org));
    }
    return User.find({ organization: orgIds });
  }
};
