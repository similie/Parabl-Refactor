/**
 * EventImpact.js
 *
 * @description :: A model definition represents a database table/collection.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

const { SqlUtils } = require('similie-api-services');
const SailsExtensions = require('../services/SailsExtensions');

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    station: {
      model: 'station'
    },
    event: {
      type: 'integer'
    },

    ews: {
      model: 'ews'
    },

    category: {
      type: 'string',
      in: ['earlywarning', 'eventcluster'],
      defaultsTo: 'earlywarning'
    },

    method: {
      type: 'string'
    },

    target: {
      type: 'integer'
    },

    domain: {
      model: 'domain',
      defaultsTo: null
    },

    meta: {
      type: 'json'
    }
  },

  countQuery: function(params = {}) {
    const escape = SqlUtils.escapeUtil();
    const query = `
    SELECT COUNT( * ) as "system"
     ${
       params.event
         ? escape(
             ', COUNT(*) filter (where "event"   %s) as "event"',
             SqlUtils.setInString(
               Array.isArray(params.event)
                 ? params.event
                 : [this.getId(params.event)]
             )
           )
         : ''
     } 
     ${
       params.ews
         ? escape(
             ', COUNT(*) filter (where "ews"  %s) as "ews"',
             SqlUtils.setInString(
               Array.isArray(params.ews) ? params.ews : [this.getId(params.ews)]
             )
           )
         : ''
     } 
     ${
       params.station
         ? escape(
             ', COUNT(*) filter (where "station"  %s) as "station"',
             SqlUtils.setInString(
               Array.isArray(params.station)
                 ? params.station
                 : [this.getId(params.station)]
             )
           )
         : ''
     }
  from "eventimpact" WHERE "domain" ${escape(
    `${params.domain ? '= %s' : 'IS NULL'}`,
    this.getId(params.domain)
  )}
    `;
    return query;
  },

  count: async function(req) {
    const params = SailsExtensions.params(req);
    const query = this.countQuery(params);
    const results = await this.queryAsync(query);
    return results.rows[0];
  },

  add: function(targetUser = {}, defaults = {}, method = 'email') {
    const target = this.getId(targetUser);
    const { event, ews, category, station } = defaults;
    const meta = defaults.meta || {};
    return this.create({ event, ews, category, station, target, method, meta });
  },
  addMany: async function(targetUsers = [], defaults = {}, method = 'email') {
    const impacts = [];
    for (let i = 0; i < targetUsers.length; i++) {
      const target = targetUsers[i];
      const impact = await this.add(target, defaults, method);
      impacts.push(impact);
    }
    return impacts;
  }
};
