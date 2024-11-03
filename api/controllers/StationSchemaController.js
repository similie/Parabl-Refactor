/**
 * StationSchemaController
 *
 * @description :: Server-side logic for managing Stationschemas
 * @help        :: See http://sailsjs.org/#!/documentation/concepts/Controllers
 */

module.exports = {
  findOne: (req, res) => {
    const user = req.user;
    Utils.findOne(req, res, async station => {
      let filtered = await UserAccess.control(station, user, {
        entity: 'stationschema'
      });
      if (!_.size(filtered)) {
        filtered = (await refine([station], req)).pop();
      }
      res.ok(filtered);
    });
  },
  find: (req, res) => {
    const user = req.user;
    Utils.getParser(req, res, async stations => {
      let filtered = await UserAccess.control(stations, user, {
        entity: 'stationschema'
      });
      if (
        !_.size(filtered) &&
        ((_.isArray(stations) && _.size(stations) === 1) ||
          !_.isArray(stations))
      ) {
        filtered = await refine(stations, req);
      }
      res.ok(filtered);
    });
  }
};

async function refine(refinements, req) {
  const out = [];
  const array = _.isArray(refinements);
  const _refinements = array ? refinements : [refinements];
  const memberships = await Station.getMemberships(req.user);
  const sTypes = {};
  _.each(memberships, m => {
    sTypes[StationSchema.getId(m.station_type)] = true;
  });
  //
  for (let i = 0; i < _.size(_refinements); i++) {
    const refine = _refinements[i];
    if (sTypes[StationSchema.getId(refine)]) {
      const ss = await StationSchema.findOneById(
        StationSchema.getId(refine)
      ).populateAll();
      out.push(ss);
    }
  }
  return array ? out : out.pop();
}
