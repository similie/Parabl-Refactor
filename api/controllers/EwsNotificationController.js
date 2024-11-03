/**
 * EwsNotificationController
 *
 * @description :: Server-side actions for handling incoming requests.
 * @help        :: See https://sailsjs.com/docs/concepts/actions
 */

const { Common } = require('../model-utilities/common/common');

module.exports = {
  // Utils function
  paged: async function(user, limit = 10, offset = 0) {
    if (!user) {
      return { error: true, message: 'User id required' };
    }

    try {
      const query = EwsNotification.find().where({ user });

      if (limit) {
        query.limit(limit).skip(offset);
      }

      const data = await query.populateAll();

      return { error: false, data };
    } catch (message) {
      return { error: true, message };
    }
  },
  create: async function(payload) {
    try {
      const { user, eventbroadcast } = payload;

      const userData = await User.findOneById(user);
      const eventbroadcastData = await EventBroadcast.findOneById(
        eventbroadcast
      );

      if (!userData) {
        return { error: true, message: 'User not found' };
      }

      if (!eventbroadcastData) {
        return { error: true, message: 'Event not found' };
      }

      const data = await EwsNotification.create(payload);

      return { error: false, data };
    } catch (message) {
      return { error: true, message };
    }
  },
  delete: async function(payload) {
    try {
      const Notification = await EwsNotification.findOne(payload);

      if (!Notification) return { error: true, message: 'Record not found' };

      const data = Notification.destroy();

      return { error: false, data };
    } catch (message) {
      return { error: true, message };
    }
  },

  // API routes
  /**
   * Mark as read API
   *
   * @param {Object} params
   * example params: { payload: '[{"user":1,"eventbroadcast":1}]' }
   */
  read: async function(req, res) {
    const params = req.params.all();
    const payloads = Common.safeJSONparse(params.payload, []);

    if (!payloads.length) {
      return res.badRequest({
        errors: 'payload is required'
      });
    }

    const response = await Promise.all(
      payloads.map(async payload => await this.create(payload))
    );

    return res.send(response);
  },

  /**
   * Mark as unread API
   *
   * @param {Object} params
   * example params: { payload: '[{"user":1,"eventbroadcast":1}]' }
   */
  unread: async function(req, res) {
    const params = req.params.all();
    const payloads = Common.safeJSONparse(params.payload, []);

    if (!payloads.length) {
      return res.badRequest({
        errors: 'payload is required'
      });
    }

    const response = await Promise.all(
      payloads.map(async payload => await this.delete(payload))
    );

    return res.send(response);
  },

  /**
   * Retrieve read notifications API
   *
   * @param {Number} user
   * @param {Number} limit optional
   * @param {Number} offset optional
   * example params: { user: 1, limit: 10: offset: 10 }
   */
  hasbeenread: async function(req, res) {
    const params = req.params.all();
    const { user, limit, offset } = params;

    const response = await this.paged(user, limit, offset);

    return res.send(response);
  }
};
