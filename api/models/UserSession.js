/**
 * UserSession.js
 *
 * @description :: A model definition represents a database table/collection.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

const { TimeUtils, SqlUtils } = require('similie-api-services');
const BullQueue = require('../services/BullQueue');
const now_ = TimeUtils.constants.now_;

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    user: {
      model: 'user',
      required: true
    },

    session_key: {
      type: 'string',
      unique: true,
      required: true
    },

    session_type: {
      type: 'string',
      maxLength: 8,
      defaultsTo: 'local',
      in: ['api', 'jwt', 'local']
    },

    socket_id: {
      type: 'string'
    },

    last_touched: {
      type: 'datetime'
    }
  },

  _processors: [
    BullQueue.jobTemplate(async job => {
      const data = job.data;
      const user = await User.findOneById(Model.getId(data.user));
      data.user = user;
      const sessionDetails = await Session.getSessionDetails(
        data,
        data.activity
      );
      const session = new Session(sessionDetails, data.ttl);
      await session.findLastSeen();
    }, 'sessionPrune')
  ],

  prune: async function(req) {
    const uID = User.getId(req.user);
    if (!uID) {
      return null;
    }
    const escape = SqlUtils.escapeUtil();
    //  beach sockets older than today
    const query = escape(
      `DELETE FROM "usersession" WHERE "user" = %s and "createdAt" < now() - interval '1 day'`,
      uID
    );
    const results = await UserSession.queryAsync(query);
    return results.rows;
  },

  breakSessions: async function(req) {
    const session_key = this.reqSession(req);
    if (!session_key) {
      return;
    }
    return await UserSession.destroy({ session_key: session_key });
  },

  reqSocket: async function(req) {
    const socket_id = sails.sockets.getId(req);
    if (!socket_id) {
      return null;
    }
    const session_key = this.reqSession(req);
    if (!session_key) {
      return null;
    }
    const uID = User.getId(req.user);
    const session = await UserSession.findOrCreate({
      user: uID,
      session_key: session_key
    }).then(async session => {
      session.socket_id = socket_id;
      session.last_touched = TimeUtils.isoFormattedDate(now_);
      return await UserSession.saveAsync(session);
    });
    return session;
  },

  reqSession: function(req) {
    const key = req.signedCookies[sails.config.session.key];
    return key;
  },

  async findSession(req) {
    const uID = this.getId(req.user);
    const sessions = await this.find()
      .where({ user: uID })
      .sort({ createdAt: 'DESC' })
      .limit(1);
    const [session] = sessions;
    return session || null;
  },

  getSockets: async function(user) {
    const uId = User.getId(user);
    const escape = SqlUtils.escapeUtil();
    const query = `select "socket_id" from "usersession" where "user" = %s 
      AND (now() - interval '1 DAY' ) <= "last_touched" AND "socket_id" IS NOT NULL;`;
    const results = await UserSession.queryAsync(escape(query, uId));
    const result = results.rows;
    return result.map(session => session.socket_id);
  }
};
