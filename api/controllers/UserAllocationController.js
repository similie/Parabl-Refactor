/**
 * UserAllocationController
 *
 * @description :: Server-side actions for handling incoming requests.
 * @help        :: See https://sailsjs.com/docs/concepts/actions
 */

const { SqlUtils } = require('similie-api-services');

module.exports = {
  members: async function(req, res) {
    try {
      const results = await UserAllocation.getItemUsers(req);
      return res.send(results);
    } catch (e) {
      res.badRequest({ error: e.message });
    }
  },

  report: async function(req, res) {
    const errors = UserAllocation.errorMessages();
    const params = req.params.all();

    if (!params.id) {
      return res.badRequest({
        error: errors.STATION_REQUIRED_FOR_REPORT
      });
    }
    const children = await Station.children(params.id);
    const stations = _.pluck(children, 'id');
    const uElements = await UserAllocation.usersfromStations(stations);
    const users = uElements.users;
    const stationDetails = {
      items: [],
      stations: {}
    };
    let allItems;
    try {
      allItems = await UserAllocation.userAllocationReportGenerator(
        users,
        stations,
        null,
        params
      );
    } catch (e) {
      return res.serverError({ error: e });
    }
    const ss = {};

    for (let i = 0; i < _.size(children); i++) {
      const child = children[i];
      stationDetails.stations[child.id] = {
        allocations: null,
        station: child
      };

      const stationArr = [child.id];

      if (!ss[child.station_type]) {
        const sSchema = await StationSchema.findOneById(
          StationSchema.getId(child.station_type)
        );
        ss[child.station_type] = sSchema;
      }
      stationDetails.stations[child.id].schema = ss[child.station_type];
      const uElements = await UserAllocation.usersfromStations(stationArr);
      const users = uElements.users;
      try {
        const allocations = await UserAllocation.userAllocationReportGenerator(
          users,
          stationArr,
          allItems,
          params
        );
        stationDetails.stations[child.id].allocations = allocations;
        if (!_.size(users)) {
          stationDetails.stations[child.id].allocations.stagnate = true;
          UserAllocation.mergeDetails(allItems, allocations);
        }
      } catch (e) {
        return res.serverError({ error: e });
      }
    }

    UserAllocation.bindUserCountsToStation(
      stationDetails.stations,
      uElements.requisitions
    );

    stationDetails.items = UserAllocation.setItemArray(allItems);
    res.send(stationDetails);
  },

  common: async function(req, res) {
    const params = Utils.params(req);
    const errors = UserAllocation.errorMessages();

    if (!params.user_schema) {
      return res.badRequest({ error: errors.USERSCHEMA_ID_NOT_FOUND });
    }
    const common = await UserAllocation.common(req, res.locals.siteData);
    res.send(common);
  },

  serials: async function(req, res) {
    const params = Utils.params(req);

    if (!params.inventory) {
      return res.badRequest();
    }
    if (!params.item) {
      return res.badRequest();
    }
    const schema = await NodeSchema.findOneById(params.inventory);
    const serialParams = UserAllocation.validSerialParams(schema);
    if (!_.size(serialParams)) {
      return res.send(serialParams);
    }
    const language = req.user.language(res.locals.siteData);
    const values = await UserAllocation.nodeThroughParams(
      serialParams,
      params.item,
      schema,
      language
    );
    res.send(values);
  },

  find: async function(req, res) {
    const params = req.params.all();
    if (params.bypass) {
      Utils.deleteFromRequest('bypass', req);
      return Utils.getParser(req, res, models => {
        res.send(models);
      });
    }

    const whereObject = Utils.parseQueryParameters(req);
    const sql = SqlUtils.setQueryString(whereObject);
    const allocator = UserAllocation.allocationQueryGen();
    const query = `${allocator} ${UserAllocation.checkForId(req, sql)}`;
    const results = await UserAllocation.queryAsync(query);
    const rows = results.rows;
    const decorations = await UserAllocation.setNodes(rows);
    if (params.id && !_.isArray(params.id)) {
      return res.send(decorations.pop());
    }
    res.send(decorations);
  }
};
