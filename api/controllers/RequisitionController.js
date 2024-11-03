/**
 * RequisitionController
 *
 * @description :: Server-side actions for handling incoming requests.
 * @help        :: See https://sailsjs.com/docs/concepts/actions
 */
const { SqlUtils } = require('similie-api-services');
const { Common } = require('../model-utilities/common/common');

module.exports = {
  people: async function(req, res) {
    // const params = req.params.all();
    const params = Utils.params(req);
    const skip = Utils.skip(req);
    const limit = Utils.limit(req);
    const sort = Utils.sort(req);
    if (!params.station) {
      return res.badRequest({ error: 'Station ID required' });
    }
    const userAlias = 'u';
    const appendage = `^${userAlias}^`;
    const search = User.textSearchQuery(params.search, appendage);
    const userSearchText = SqlUtils.generateOrQueryString(search.or);
    const properJoin = Common.splitSqlJoinString(
      appendage,
      userSearchText,
      userAlias
    );
    let formalizedQuery = await Requisition.getStationPeopleSearchQuery(
      params,
      properJoin
    );

    if (_.size(sort)) {
      formalizedQuery += SqlUtils.buildSort(sort);
    }

    if (limit) {
      formalizedQuery += ` LIMIT ${limit}`;
    }

    if (skip) {
      formalizedQuery += ` OFFSET ${skip}`;
    }

    try {
      const results = await Requisition.queryAsync(formalizedQuery);
      res.send(results.rows);
    } catch (e) {
      sails.log.error('RequisitionController.people::error', e);
      res.serverError({ error: e.message });
    }
  },

  checkout: function(req, res) {
    Requisition.checkout(req, res);
  },
  personnel: function(req, res) {
    Requisition.findQualifiedPersonnel(req, res);
  },

  membership: async function(req, res) {
    const params = req.params.all();
    if (!params.station) {
      return res.badRequest({ error: 'errors.STATION_ID_REQUIRED' });
    }

    const station = await Station.findOneById(Station.getId(params.station));
    if (!station) {
      return res.badRequest({ error: 'errors.INVALID_STATION' });
    }

    if (!station.members_only) {
      return res.send([]);
    }

    const inOrg = await Station.stationHasOrganizationalUser(station, req.user);
    if (inOrg) {
      return res.send([
        {
          role: inOrg
        }
      ]);
    }

    const user = User.getId(req.user);
    const reqs = await Requisition.findOne({
      user: user,
      station: Station.getId(station),
      archived: false
    });

    if (_.size(reqs)) {
      return res.send([reqs]);
    }

    const primary = await Requisition.findOne({
      user: user,
      primary: true,
      archived: false
    });

    if (!_.size(primary)) {
      return res.send([]);
    }
    const children = await Station.children(Station.getId(primary.station));
    let member = false;
    for (let i = 0; i < _.size(children); i++) {
      const child = children[i];
      if (child.id === Station.getId(station)) {
        member = true;
        break;
      }
    }

    if (member) {
      return res.send([primary]);
    }

    res.send([]);
  }
};
