/**
 * StationBadgeController
 *
 * @description :: Server-side actions for handling incoming requests.
 * @help        :: See https://sailsjs.com/docs/concepts/actions
 */

module.exports = {
  find: async function(req, res) {
    const actionUtil = Utils.actionUtil();
    if (actionUtil.parsePk(req)) {
      return Utils.findOne(req, res, record => {
        res.ok(record);
      });
    }

    const values = actionUtil.parseValues(req);
    const sort = actionUtil.parseSort(req);
    const limit = actionUtil.parseLimit(req);

    if (values.where && values.where.station) {
      const sId = values.where.station;
      const parents = await Station.ancestors(sId);
      const ids = _.pluck(_.where(parents, { level: 2 }), 'id');
      if (_.size(ids)) {
        delete values.where.station;
        const or = [{ station: sId }, { station: ids, cascade: true }];
        values.where.or = values.where.or || [];
        values.where.or.push(...or);
      }
    }
    try {
      const badges = await StationBadge.find()
        .where(values)
        .limit(limit)
        .sort(sort)
        .populateAll();
      res.send(badges);
    } catch (e) {
      console.error(e);
      res.send({ error: 'An Unknown Error Occured' });
    }
  }
};
