/**
 * OrganizationController
 *
 * @description :: Server-side actions for handling incoming requests.
 * @help        :: See https://sailsjs.com/docs/concepts/actions
 */

module.exports = {
  getCareers: async function(req, res) {
    const params = req.params.all();
    if (!params.id) {
      return res.badRequest({ error: 'An Organization ID is required' });
    }

    const org = await Organization.findOneById(params.id).populate('careers');
    if (!org) {
      return res.badRequest({
        error: 'An Organization with this ID cannot be found'
      });
    }
    const vIds = _.pluck(org.careers, 'id');
    if (!_.size(vIds)) {
      return res.send(vIds);
    }

    const variables = await Variable.find()
      .where({
        id: vIds
      })
      .sort({ order: 'ASC' });

    return res.send(variables);
  },
  cast: async function(req, res) {
    const params = req.params.all();
    if (!params.id) {
      return res.badRequest({
        error: 'ID Required'
      });
    }

    const station = await Station.findOneById(params.id);
    if (!station) {
      return res.badRequest({
        error: 'A valid station is Required'
      });
    }
    let org;
    if (req.method === 'POST' || req.method === 'PUT') {
      const found = await Organization.findOrCreate({
        connected_station: params.id
      });
      if (!found || !_.size(found)) {
        return res.serverError({
          error: 'Item not resolved'
        });
      }
      const _f = _.isArray(found) ? found.pop() : found;
      org = await Organization.update(
        {
          id: _f.id
        },
        await Organization.stationOrgClone(station)
      );
    } else {
      org = await Organization.update(
        { connected_station: params.id },
        { active: false }
      );
    }
    res.send(org);
  }
};
