/**
 * PeopleController
 *
 * @description :: Server-side actions for handling incoming requests.
 * @help        :: See https://sailsjs.com/docs/concepts/actions
 */

const { SqlUtils } = require('similie-api-services');

// const countPeople = async (query, model) => {
//   const count = await (model.count || _.noop)(query);
//   return count || 0;
// };

module.exports = {
  find: async function(req, res) {
    const actionUtil = Utils.actionUtil();
    const params = actionUtil.parseCriteria(req);
    if (!_.size(params.schema)) {
      return res.send({
        __count__: 0
      });
    }
    const sort = actionUtil.parseSort(req);
    const skip = actionUtil.parseSkip(req);
    const limit = actionUtil.parseLimit(req);
    const schemaString = User.buildPeopleQuery(params);
    const whereString = ` ${schemaString ? 'WHERE' + schemaString : ''} `;
    const sortString = SqlUtils.buildSort(sort);
    const countString = `SELECT count("id") as "count" FROM "user" ${whereString} `;
    let queryString = `SELECT "id", "schema" FROM "user" ${whereString} ${sortString}`;

    if (skip) {
      queryString += ` OFFSET ${skip} `;
    }

    if (limit) {
      queryString += ` LIMIT ${limit}`;
    }

    const uCount = await User.queryAsync(countString);
    const count = (uCount.rows.pop() || {}).count || 0;

    const userIDs = await User.queryAsync(queryString);
    const ids = _.pluck(userIDs.rows, 'id');
    const users = await User.find()
      .where({ id: ids })
      .populateAll();
    const send = {
      __count__: count
    };
    _.each(users, async u => {
      const name = await User.getPeopleSchemaName(u);
      if (!send[name]) {
        send[name] = [];
      }
      send[name].push(u);
    });
    res.send(send);
  }
};
