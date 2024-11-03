/**
 * District.js
 *
 * @description :: TODO: You might write a short summary of how this model works and what it represents here.
 * @docs        :: http://sailsjs.org/#!documentation/models
 */
const Q = require('q');
const { SqlUtils } = require('similie-api-services');

module.exports = {
  attributes: {
    name: {
      type: 'json'
    },
    code: {
      type: 'string',
      //          max: 8,
      required: true,
      unique: true
    },
    district_type: {
      model: 'variable',
      required: true
      //            in: ['Municipal', 'Administrative Post']
    },
    rural: {
      type: 'boolean'
    },
    geo: {
      type: 'geometry' // this will contain the polygon
    },
    color: {
      type: 'string',
      maxLength: 8
    },
    domain: {
      model: 'domain'
    },
    description: 'text',
    meta: {
      type: 'json'
    }
    // toJSON: Geo.stripJSON()
  },

  wantsAsName: function(req) {
    const params = Utils.params(req);
    const or = this.getTheNameQuery(params);
    return !!or;
  },

  getTheNameQuery: function(params) {
    if (params.name) {
      return params.name;
    }

    for (let i = 0; i < _.size(params.or); i++) {
      const o = params.or[i];
      const keys = _.keys(o);
      if (_.contains(keys, 'name')) {
        return _.clone(o);
      }
    }
    return null;
  },

  deleteTheNameQuery: function(params) {
    if (params.name) {
      delete params.name;
    }
    for (let i = 0; i < _.size(params.or); i++) {
      const o = params.or[i];
      const keys = _.keys(o);
      if (_.contains(keys, 'name')) {
        params.or.splice(i, 1);
        break;
      }
    }
  },

  getILike: function(key, value) {
    const escape = SqlUtils.escapeUtil();
    switch (key) {
      case 'contains':
        return escape('%%%s%%', value);
      case 'startsWith':
        return escape('%%%s', value);
      case 'endsWith':
        return escape('%s%%', value);
      default:
        return escape(`%s`, value);
    }
  },

  getLikeValue: function(query) {
    const escape = SqlUtils.escapeUtil();
    if (_.isString(query)) {
      return escape(`= '%s'`, query);
    } else if (_.isString(query.name)) {
      return this.getLikeValue(query.name);
    }
    let send = '';
    const keys = _.keys(query.name);
    const size = _.size(keys);
    for (let i = 0; i < size; i++) {
      const key = keys[i];
      const value = query.name[key];
      send += `ILIKE '${this.getILike(key, value)}'`;
      if (i < size - 1) {
        send += ' AND ';
      }
    }
    return send;
  },

  setNameQuery: function(query) {
    const iLike = this.getLikeValue(query);
    return `SELECT "id" from "district" where "name"::TEXT ${iLike}`;
  },

  getNamesFromQuery: async function(query, req) {
    const escape = SqlUtils.escapeUtil();
    const sort = Utils.sort(req);
    const limit = Utils.limit(req);
    const skip = Utils.skip(req);
    let q = this.setNameQuery(query);

    if (sort) {
      q += ` ${SqlUtils.buildSort(sort)}`;
    }

    if (limit) {
      q += escape(' LIMIT %s', limit);
    }

    if (skip) {
      q += escape(' OFFSET %s', limit);
    }

    const results = await Model.queryAsync(q);
    return _.pluck(results.rows, 'id');
  },

  applyNameSearchIds: function(params, ids) {
    if (params.or) {
      params.or.push({ id: ids });
    } else {
      params.id = ids;
    }
  },

  pullThroughJsonName: async function(req, res) {
    const params = Utils.params(req);
    const nameQuery = this.getTheNameQuery(params);
    const nameIds = await this.getNamesFromQuery(nameQuery, req);
    this.deleteTheNameQuery(params);
    this.applyNameSearchIds(params, nameIds);
    const results = await District.find()
      .where(params)
      .sort(Utils.sort(req))
      .limit(Utils.limit(req))
      .skip(Utils.skip(req));

    Utils.subscribeModels(District, req, results);
    return res.send(results);
  },

  pullAudience: async function(audience, domain) {
    const _audience = [];
    if (!_.size(audience)) {
      return _audience;
    }

    /*
     * Get the doamin for the users
     */
    const config = await Site.thisSiteAsync(domain);
    const language = config.default_language;
    const or = [];

    _.each(audience, a =>
      or.push({
        primary_district: {
          startsWith: a
        }
      })
    );

    const dRs = _.map(
      await DomainRole.find({
        domain: Domain.getId(domain)
      }),
      d => d.user
    );

    const users = _.map(
      await User.find({
        where: {
          active: true,
          id: dRs,
          or: or
        }
      }),
      m => {
        return {
          type: 'user',
          id: m.id,
          name: User.fullName(m),
          email: m.email,
          phone: m.phone,
          language: m.preferred_language || language || 'en'
        };
      }
    );
    const contacts = _.map(
      await Contact.find({
        where: {
          domain: domain,
          or: or
        }
      }),
      m => {
        return {
          type: 'contact',
          id: m.id,
          name: User.fullName(m),
          email: Contact.getPrimary(m),
          phone: Contact.getPrimary(m, 'phone'),
          language: m.preferred_language || language || 'en'
        };
      }
    );
    _audience.push(...users);
    _audience.push(...contacts);
    return _audience;
  },

  variableName: function() {
    return 'district_type';
  },

  beforeCreate: function(values, next) {
    values.color = values.color || Utils.color();
    next();
  },

  geo: function() {
    return ['point', 'polygon'];
  },

  translateKey: function() {
    return 'name';
  },

  // afterUpdate: function(values, next) {
  //     Geo.updateGeo(values, 'district', next);
  // },
  // afterCreate: function(values, next) {
  //     Geo.updateGeo(values, 'district', next);
  // },

  decorate: async function(models) {
    let isOne = false;
    if (!_.isArray(models) && _.isObject(models)) {
      isOne = true;
      models = [models];
    }

    for (let i = 0; i < models.length; i++) {
      const model = models[i];
      await decorations(model);
    }
    return isOne ? models.pop() : models;
  },

  beforeValidate: function(values, next) {
    Geo.setGeo(values, err => {
      if (err) {
        return next(err);
      }

      Variable.pullImports(values, () => {
        if (values.type) {
          const type = values.type;
          let selector = 'district_hamlet';

          if (type === 'District') {
            selector = 'district_municiple';
          } else if (type === 'Subdistrict') {
            selector = 'district_admin_post';
          } else if (type === 'Succo') {
            selector = 'district_succo';
          }

          Variable.pullType(
            {
              key: 'district_type',
              identity: selector
            },
            (err, variable) => {
              // we fail it so we can get it next boot
              if (err || !variable) {
                sails.log.error(err || 'empty vars');
                return next(err);
              }
              values.district_type = variable.id;
              delete values.type;

              next();
            }
          );
        } else {
          return next();
        }
      });
    });
  },

  // beforeUpdate: function(values, next) {
  //     Geo.parseLocation(values, next);
  // },

  // beforeCreate: function(values, next) {
  //     // here we are going to process
  //     Geo.parseLocation(values, next);
  // },

  pullRegions: function(pCode) {
    const code = pCode; // pCode;
    return Variable.find({
      key: District.variableName()
    })
      .then(vars => {
        return vars;
      })
      .then(variables => {
        const regions = [];
        const divisions = [];

        _.each(variables, v => {
          const meta = v.meta;
          if (meta && meta.structure) {
            const c = (meta.structure || '').replaceAll('X', '');
            divisions.push(_.size(c));
          }
        });
        // [2, 4, 6, 8],
        _.each(_.sortBy(divisions), index => {
          regions.push((code || []).slice(0, index));
        });

        if (!_.size(regions)) {
          regions.push(pCode);
        }

        return regions;
      })
      .then(regions => {
        return District.find({
          code: regions
        })
          .populateAll()
          .then(districts => {
            return districts;
          });
      });
  },

  findSmallestForGeo: function(districts) {
    // LET'S FIND THE BIGGEST REGTION.
    let largest = 0;
    let foundIndex = 0;
    _.each(districts, (v, i) => {
      const meta = (v.district_type || {}).meta;
      if (meta && meta.structure) {
        const c = (meta.structure || '').replaceAll('X', '');
        const size = _.size(c);
        if (size > largest && v.geo) {
          largest = size;
          foundIndex = i;
        }
      }
    });

    return foundIndex;
  },
  closestToPoint: async function(point = {}) {
    const escape = SqlUtils.escapeUtil();
    const query = escape(
      `SELECT "id", 
     "code", 
     "district_type",
     ST_Distance(ST_SetSRID(ST_Point ( '%s', '%s'), 4326), ST_SetSRID("geo"::geometry, 4326 )) as "distance" 
     from "district" WHERE "geo" IS NOT NULL order by "distance"  limit 1;`,
      point.lng,
      point.lat
    );
    const results = await this.queryAsync(query);
    return results.rows.pop();
  },

  pointWithin: async function(point = {}) {
    const escape = SqlUtils.escapeUtil();
    const query = escape(
      `SELECT "id", 
      "code", 
      "district_type" from "district" WHERE  ST_WITHIN( ST_SetSRID(ST_Point ( '%s', '%s'), 4326),  ST_SetSRID("geo"::geometry, 4326 ) )  AND "geo" IS NOT NULL;`,
      point.lng,
      point.lat
    );
    const results = await this.queryAsync(query);
    return results.rows;
  }
};

function decorations(models) {
  return Geo.pullDistrict(models, 'geo');
}
