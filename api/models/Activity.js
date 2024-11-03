/**
 * Activity.js
 *
 * @description :: TODO: You might write a short summary of how this model works and what it represents here.
 * @docs        :: http://sailsjs.org/#!documentation/models
 */

module.exports = {
  attributes: {
    title: 'string',

    body: 'text',

    activity_type: {
      model: 'variable'
    },

    station: {
      model: 'station'
    },

    user: {
      model: 'user'
    }
  },

  activityVariables: function(action) {
    return new Promise((resolve, reject) => {
      Variable.pullType(
        {
          key: 'station_activity',
          identity: action
        },
        (err, values) => {
          if (err) {
            return reject(err);
          }
          return resolve(values);
        }
      );
    });
  },

  buildBody: function(station) {
    let body = '';
    if (!station.meta || !station.meta.update) {
      return body;
    }
    _.each(station.meta.update, val => {
      body += val.key + '\n';
    });
    return body;
  },

  /*
   * function to create an activity object
   */
  createActivity: async function(station, action, user, cb) {
    if (!station) {
      return (cb || _.noop)();
    }

    let variable = null;
    try {
      variable = await this.activityVariables(action);
    } catch {}

    try {
      const created = await this.create({
        activity_type: this.getId(variable),
        station: station.id,
        user: (user || {}).id || (station.meta || {}).user,
        title: '',
        body: this.buildBody(station)
      });
      (cb || _.noop)(null, created);
      return created;
    } catch (e) {
      return (cb || _.noop)(e);
    }
  }
};
