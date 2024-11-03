/**
 * Messaging.js
 *
 * @description :: TODO: You might write a short summary of how this model works and what it represents here.
 * @docs        :: http://sailsjs.org/documentation/concepts/models-and-orm/models
 */
// @TODO: Refactor to CommonUtils in similie-api-services module
const Utils = require('../services/Utils');

const { TimeUtils, SqlUtils, CommonUtils } = require('similie-api-services');
const now_ = TimeUtils.constants.now_;
const escape = SqlUtils.escapeUtil();

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    message: {
      model: 'message',
      required: true
    },

    original_message: {
      model: 'message'
    },

    from: {
      model: 'user'
      // required: true
    },

    to: {
      model: 'user',
      required: true
    },

    archive: {
      type: 'boolean',
      defaultsTo: false
    },

    read: {
      type: 'boolean',
      defaultsTo: false
    },
    flagged: {
      type: 'boolean',
      defaultsTo: false
    },
    delivered: {
      type: 'boolean',
      defaultsTo: false
    },
    delivery_date: {
      type: 'datetime'
    },

    task: {
      type: 'boolean',
      defaultsTo: false
    },
    toJSON: function() {
      if (!this.delivered) {
        this.delivered = true;
        this.delivery_date = TimeUtils.isoFormattedDate(now_); // [SG]Time.getMoment().format();
        Messaging.update(
          { id: this.id },
          {
            delivery_date: this.delivery_date
          }
        ).exec(err => {
          if (err) {
            sails.log.error(err);
          }
        });
      }

      return this.toObject();
    }
  },
  placeLocals: function(messaging, messageLocals, user) {
    const keys = Message.localKeys();
    const message_keys = keys.message_keys;
    const message_texts = keys.message_texts;
    messaging.meta = messaging.meta || {};
    messaging.meta.original_messages = {};
    for (let i = 0; i < _.size(message_keys); i++) {
      const key = message_keys[i];
      const message = messaging[key];
      const elements = messageLocals(message, user);
      messaging.meta.original_messages[key] = {};
      for (let j = 0; j < _.size(message_texts); j++) {
        const t = message_texts[j];
        if (message && message[t]) {
          messaging.meta.original_messages[key][t] = message[t];
          message[t] = CommonUtils.parseLocals(message[t], elements.locals);
        }
      }
    }
  },
  beforeCreate: function(values, next) {
    values.read = values.read || values.from === values.to;
    next();
  },

  applyReads: function(messages, reads) {
    for (let i = 0; i < _.size(messages); i++) {
      const message = messages[i];
      const id = Message.getId(message);
      if (reads[id]) {
        message.read = reads[id];
      }
    }
  },

  getConversationLayer: function(req) {
    const params = Utils.params(req);
    const entity = Node.parseWhere(params, { name: 'a' }, null, true);
    const query = escape(
      `SELECT "original_message" as "id"
      FROM (SELECT
        mes."original_message" as "original_message",
        mes."to" as "to",
       "m"."task" as "task",
       "m"."subject" as "subject",
       "m"."body" as "body",
			 BOOL_OR(mes."archive") as "archive",
       BOOL_OR(mes."flagged") as "flagged"
       FROM
         "messaging" mes 
         JOIN "message" "m" ON "m"."id" = "mes"."original_message"
       GROUP BY 1,2,3,4,5
       ORDER BY "original_message" DESC
       ) a 
      WHERE %s`,
      entity
    );
    return query;
  },

  getConverstationCount: async function(req) {
    const query = this.getConversationLayer(req);
    const q = escape(`SELECT COUNT(*)::INT FROM (%s) c `, query);
    const results = await Messaging.queryAsync(q);
    const rows = results.rows;
    return { total: rows.pop().count || 0 };
  },

  generateMessageIds: async function(req) {
    const skip = Utils.skip(req);
    const limit = Utils.limit(req);
    let query = this.getConversationLayer(req);

    if (skip) {
      query += escape(' OFFSET %s', skip);
    }
    if (limit) {
      query += escape(' LIMIT %s', limit);
    }
    const results = await Messaging.queryAsync(query);
    const rows = results.rows;
    return _.pluck(rows, 'id');
  },

  getCounts: async function(req) {
    const user = req.user;
    const actionUtil = Utils.actionUtil();
    const parsedParams = actionUtil.parseValues(req); // this has stripped out the where an gives us raw params
    const params = req.params.all();
    const to = parsedParams.to || User.getId(user); /// params.to || (params.where || {}).to || req.user.id;
    const limit = params.limit || 30;
    const offset = (params.skip || 0).toString();
    const where = _.isString(params.where)
      ? JSON.parse(params.where)
      : params.where || {};

    let join = '';
    let orString = '';

    const or = _.clone(where.or);
    if (_.size(or)) {
      // function (where, schema, model, stringOnly) {
      join = `JOIN message MSSG on (MSSG.id = MSG.message)`;
      orString = ` AND (${Node.parseWhere(
        { or: or },
        { name: 'MSSG' },
        null,
        true
      )})`.replaceAll('%', '%%');

      delete where.or;
    }

    let query = `select MSG.id from messaging MSG ${join} where MSG."createdAt" = (select max(MSG1."createdAt") from messaging MSG1 where MSG1."original_message" = MSG."original_message" AND MSG1."original_message" NOTNULL AND MSG1."to" = %s) AND MSG."archive" = false AND MSG."to" = %s ${orString} ORDER BY MSG."createdAt" DESC LIMIT %s OFFSET %s;`;
    if (req.method === 'POST') {
      query = `select COUNT(*) from messaging MSG ${join} where MSG."createdAt" = (select max(MSG1."createdAt") from messaging MSG1 where MSG1."original_message" = MSG."original_message" AND MSG1."original_message" NOTNULL AND MSG1."to" = %s) AND MSG."archive" = false AND MSG."to" = %s ${orString};`;
    }

    const q = escape(query, to, to, limit, offset);
    const results = await Messaging.queryAsync(q);
    const rows = results.rows;
    return { total: rows.pop().count || 0 };
  },

  setDelivery: async function(ids) {
    if (!_.size(ids)) {
      return [];
    }
    const query = escape(
      'UPDATE "messaging" SET "delivered" = true WHERE "id" %s',
      SqlUtils.setInString(ids)
    );

    const results = await Messaging.queryAsync(query);
    return results.rows;
  },

  getReadElements: async function(ids, user) {
    if (!_.size(ids)) {
      return {};
    }
    const query = escape(
      `SELECT bool_and("read") as "read", "original_message" from "messaging" where "original_message" %s ${
        user ? ' AND "to" = %s ' : ''
      } GROUP BY 2 ;`,
      SqlUtils.setInString(ids),
      User.getId(user)
    );

    const results = await Messaging.queryAsync(query);
    const rows = results.rows;
    const reads = {};

    for (let i = 0; i < _.size(rows); i++) {
      const row = rows[i];
      reads[row.original_message] = row.read;
    }

    return reads;
  },

  generateStaleMessage: async function(
    messageId,
    originalMessage,
    from,
    to,
    task
  ) {
    const item = {
      from: from,
      to: to,
      message: messageId,
      original_message: originalMessage,
      read: true,
      delivered: true,
      delivery_date: TimeUtils.isoFormattedDate(now_),
      task: task
    };
    return await Messaging.create(item);
  }
};
