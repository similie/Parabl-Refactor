/**
 * StationController
 *
 * @description :: Server-side logic for managing stations
 * @help        :: See http://sailsjs.org/#!/documentation/concepts/Controllers
 */
// var update = require('../../node_modules/sails/lib/hooks/blueprints/actions/update');

const { SqlUtils } = require('similie-api-services');

module.exports = {
  lineageItems: async function(req, res) {
    const params = req.params.all();
    const stationId = Station.getId(params.id);
    const assets = params.assets || false;
    const shallow = params.shallow || false;
    if (!stationId) {
      return res.badRequest({
        error: 'A station ID is required for this request'
      });
    }
    try {
      const lineage = await Station.children(stationId, assets, shallow);
      const nodes = await StationSchema.familyTreeIventoryNodes(lineage);
      return res.send(nodes);
    } catch (e) {
      res.serverError(e.message);
    }
  },
  removeParameter: async function(req, res) {
    const method = req.method;
    if (method !== 'DELETE') {
      return res.notFound();
    }
    const params = Utils.params(req);
    const id = params.id;
    if (!id) {
      return res.badRequest({ error: 'A NodeSchema ID is required' });
    }
    const name = params.name;
    if (!name) {
      return res.badRequest({ error: 'A parameter machine name is required' });
    }
    const station = await Station.findOneById(id);
    if (!station) {
      return res.badRequest({ error: 'A station with ID cannot be found' });
    }
    _.remove(station.schema, s => s.name === name);
    const _station = await Station.saveAsync(station);
    res.send(_station);
  },

  asset: async function(req, res) {
    const actionUtil = Utils.actionUtil();
    const where = actionUtil.parseCriteria(req);
    const domain = Domain.getId(res.locals.domain);
    const escape = SqlUtils.escapeUtil();
    const query = escape(
      `SELECT "asset" as "id" FROM "public"."stationasset" WHERE "domain" %s`,
      `${domain ? `= ${domain};` : 'IS NULL;'}`
    );

    const assetTypes = await StationSchema.find().where({
      is_asset: true,
      domain: Domain.getId(domain)
    });

    const tIds = _.pluck(assetTypes, 'id');

    if (!_.size(tIds)) {
      return res.send([]);
    }

    const results = await Model.queryAsync(query);
    const ids = _.pluck(results.rows, 'id');

    const otherId = where.id;
    if (otherId && _.size(ids)) {
      where.or = where.or || [];
      where.or.push(...[{ id: { '!': ids } }, { id: otherId }]);
    } else if (_.size(ids)) {
      where.id = {
        '!': ids
      };
    }

    where.station_type = tIds;

    const limit = actionUtil.parseLimit(req);
    const skip = actionUtil.parseSkip(req);
    const sort = actionUtil.parseSort(req);
    delete where.domain;

    const sQuery = Station.find()
      .sort(sort)
      .where(where)
      .limit(limit)
      .skip(skip);
    try {
      res.send(
        await new Promise((resolve, reject) => {
          sQuery.exec((err, results) => {
            if (err) {
              return reject(err);
            }
            resolve(results);
          });
        })
      );
    } catch (e) {
      res.serverError(e);
    }
  },

  ancestry: async function(req, res) {
    const params = req.params.all();
    if (!params.id) {
      return res.badRequest({
        error: Const.err.REQUIRED_PARAMETERS_NOT_SUPPLIED
      });
    }
    const parents = params.parents;
    const no_assets = params.no_assets;
    let ancestry;
    if (parents) {
      ancestry = await Station.ancestors(params.id, no_assets);
    } else {
      ancestry = await Station.children(params.id, no_assets);
    }

    const schemaIds = _.unique(_.pluck(ancestry, 'station_type'));

    const ss = await StationSchema.find()
      .where({
        id: schemaIds
      })
      .populateAll();
    const sCache = {};
    _.each(ss, s => {
      sCache[s.id] = s;
    });
    _.each(ancestry, a => {
      a.station_type = sCache[a.station_type];
    });

    res.send(ancestry);
  },

  generate_keys: async function(req, res) {
    if (!User.is(req.user, Roles.SIMILIE_ADMIN)) {
      return res.forbidden();
    }
    const params = req.params.all();
    const id = params.id;

    const station = await Station.findOneById(id);
    await StateKeys.registerState(station, 'station', 'station_type');

    return res.send(station);
  },

  station_map: async function(req, res) {
    /*
    Consider a generic solution
    */
    res.ok();
  },

  points: async function(req, res) {
    const params = req.params.all();
    const actionUtil = Utils.actionUtil();
    const where = actionUtil.parseCriteria(req);
    await Station.boundaryQuery(params, where);
    const limit = actionUtil.parseLimit(req);
    const skip = actionUtil.parseSkip(req);
    const spSchema = Geo.stationPointSchema();
    const w = Node.parseWhere(where, spSchema, null, Const.STRING_ONLY);
    const notNull = '"geo" IS NOT NULL';
    const user = req.user;
    let membershipQuery = '';
    if (!User.is(user, Roles.USER_ADMIN)) {
      const memberships = await Requisition.find().where(
        Station.getMembershipsQueryForRequisitions(user)
      );
      const access = await Station.getMembershipAncestry(memberships);
      const orgAccess = await Station.getOrganizationalIds(user);
      const union = _.union(access, orgAccess);
      membershipQuery = `  ("lg"."members_only" IS NULL OR "lg"."members_only" = FALSE`;
      if (_.size(union)) {
        membershipQuery += ` OR ("lg"."members_only" = TRUE AND "lg"."id" ${SqlUtils.setInString(
          union
        )}))`;
      } else {
        membershipQuery += ')';
      }
    }
    const and = `${membershipQuery ? ' AND ' : ''}`;
    let sQuery = Geo.stationPointQuery(
      (w ? ` WHERE ${w} AND ${notNull} ${and}` : `${notNull} ${and}`) +
        membershipQuery
    );
    if (limit) {
      sQuery += ` LIMIT ${limit}`;
    }

    if (skip) {
      sQuery += ` OFFSET ${skip}`;
    }
    let s;
    try {
      s = await Station.queryAsync(sQuery);
    } catch (e) {
      sails.log.error(e);
      return res.serverError(e);
    }

    const stations = s.rows;
    const filtered = await UserAccess.control(stations, user, {
      entity: 'station',
      global: true
    });
    // @todo::: put into the query
    try {
      let ewsQuery;
      try {
        ewsQuery = Station.ewsMapQuery(filtered.map(f => Model.getId(f)));
      } catch (e) {
        return res.send([]);
      }
      const ews = await Model.queryAsync(ewsQuery);
      Station.applyEventsToFilteredStations(filtered, ews.rows);
      res.ok(filtered);
    } catch (e) {
      sails.log.debug(e);
      res.ok(filtered);
    }
  },

  linkable: async function(req, res) {
    const params = req.params.all();
    if (!params.id) {
      return res.badRequest('errors.STATION_ID_REQUIRED');
    }
    delete params.parent;
    const domain = res.locals.domain;
    const q = Utils.params(req);
    const where = _.clone(q);
    const restrictedId = await Station.buildRestrictedIdsForDomainsQuery(req);

    try {
      if (!domain) {
        const stations = await Station.setNoDomainQuery(
          where,
          restrictedId,
          req
        );
        return res.send(stations);
      }
      const sharedDomains = await Domain.mergeCommonDomainWithSelfDomain(
        domain
      );
      const stations = await Station.pullStationsByDomain(
        Station.buildMergeQueryForLinkedStations(
          where,
          sharedDomains,
          restrictedId,
          req
        )
      );
      res.send(stations);
    } catch (e) {
      sails.log.error(e);
      return Utils.sendErrorCode(
        res,
        Utils.setErrorCode(Const.code.SERVER_ERROR)
      );
    }
  },

  links: async function(req, res) {
    const params = req.params.all();
    if (!params.id) {
      return res.badRequest('errors.STATION_ID_REQUIRED');
    }
    const station = await Station.findOneById(params.id);
    if (!station) {
      return res.badRequset('errors.STATION_NOT_FOUND');
    }
    const links = station.parents;
    if (!_.size(links)) {
      return res.send([]);
    }
    const stations = await Station.find({
      id: links
    }).populateAll();
    res.send(stations);
  },

  count: async function(req, res) {
    const params = req.params.all();
    const actionUtil = Utils.actionUtil();
    const where = actionUtil.parseCriteria(req);
    await Station.boundaryQuery(params, where);
    delete where.__model;
    const user = req.user;
    if (!User.is(user, Roles.USER_ADMIN)) {
      await Station.setMembership(user, where);
    }
    const count = await Station.count().where(where);
    res.send({
      total: count
    });
  },

  findOne: function(req, res) {
    Utils.findOne(req, res, station => {
      Station.decorate(station)
        .then(station => {
          res.ok(station);
        }, res.badRequest)
        .catch(why => {
          sails.log.error(why);
          res.serverError(why);
        });
    });
  },

  find: async function(req, res) {
    const params = req.params.all();
    if (params.id && !_.isArray(params.id)) {
      return this.findOne(req, res);
    }
    const user = req.user;
    const actionUtil = Utils.actionUtil();
    const where = actionUtil.parseCriteria(req);
    await Station.boundaryQuery(params, where);
    const limit = actionUtil.parseLimit(req);
    const skip = actionUtil.parseSkip(req);
    const sort = actionUtil.parseSort(req);

    if (!User.is(user, Roles.USER_ADMIN)) {
      try {
        await Station.setMembership(user, where);
      } catch (e) {
        sails.log.error('Station FindController:: Membership Check', e);
        return res.send(e);
      }
    }
    const stations = await Station.find()
      .where(where)
      .limit(limit)
      .skip(skip)
      .sort(sort)
      .populateAll();

    let decorations;
    try {
      decorations = await Station.decorate(stations, Const.WITHOUT_GEO);
    } catch (e) {
      sails.log.error('Station FindController:: Decorations Check', e);
      return res.serverError(e);
    }

    try {
      const filtered = await UserAccess.control(decorations, user, {
        entity: 'station',
        global: true
      });
      res.ok(filtered);
    } catch (e) {
      sails.log.error('Station FindController:: Access Controls Check', e);
      res.serverError(e);
    }
  },

  w3w: async function(req, res) {
    const params = req.params.all();
    const domain = res.locals.domain;
    if (req.method === 'POST') {
      if (!params.lng || !params.lat) {
        return res.badRequest('Lat/lng required');
      }
      const wordup = await Geo.setWhat3Words(
        {
          domain: domain
        },
        params.lat,
        params.lng
      );
      return res.send(wordup);
    }

    const words = params.words;
    const _words = (words || '').split('.');
    if (_.size(_words) !== 3) {
      return res.badRequest({
        error: 'what3words requires 3 words seperated by a .'
      });
    }

    try {
      const geo = await Geo.getWhat3Words(words, domain);
      const send = (geo || {}).geometry;
      res.send(send);
    } catch (e) {
      res.serverError(e);
    }
  },

  convert: function(req, res) {
    const params = req.params.all();

    if (!params.coords && !params.coords.lat && !params.coords.lng) {
      return res.badRequest();
    }

    const latLng = ['lat', 'lng'];
    const props = ['deg', 'min', 'sec'];

    if (_.isString(params.coords)) {
      params.coords = JSON.parse(params.coords);
    }

    /*
     * Geoparse doesn't like strings
     */
    _.each(latLng, key => {
      _.each(props, k => {
        params.coords[key][k] = parseFloat(params.coords[key][k]);
      });
    });

    const output = Geo.convert(
      [params.coords.lat.deg, params.coords.lat.min, params.coords.lat.sec],
      params.coords.lat.card,
      [params.coords.lng.deg, params.coords.lng.min, params.coords.lng.sec],
      params.coords.lng.card
    );

    res.send({
      lat: output[0],
      lng: output[1]
    });
  },

  devices: async function(req, res) {
    const params = req.params.all();
    if (!params.id) {
      return res.badRequest({ error: 'A Station ID is Required' });
    }

    const station = await Station.findOneById(params.id);
    if (!station) {
      return res.badRequest({ error: 'A valid station is required' });
    }

    const devices = await Device.findDevicesForStation(station);

    return res.send(devices);
  },

  excel: function(req, res) {
    const params = req.params.all();
    let _query = {};
    if (params.query) {
      _query = _.clone(params.query);
      delete params.query;
    }
    const query = {
      ...params,
      ..._query
    };

    const language =
      req.session.language || res.locals.siteData.default_language || 'en';

    delete params.limit;
    delete params.skip;

    Jobs.createStationExcel.add({
      socket: sails.sockets.getId(req),
      user: req.user.id,
      query: query,
      language: language,
      config: res.locals.siteData
    });

    res.send({
      message: 'info.PROCESSING_EXCEL_QUERY'
    });
  }
};
