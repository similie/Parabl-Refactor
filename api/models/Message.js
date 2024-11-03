/**
 * Message.js
 *
 * @description :: TODO: You might write a short summary of how this model works and what it represents here.
 * @docs        :: http://sailsjs.org/documentation/concepts/models-and-orm/models
 */

// @TODO: Refactor to CommonUtils in similie-api-services module
const Utils = require('../services/Utils');

const Q = require('q');
const { TimeUtils, SqlUtils, CommonUtils } = require('similie-api-services');
const Translates = require('../services/Translates');
const now_ = TimeUtils.constants.now_;
const EdjsParser = require('editorjs-parser');
const SailsExtensions = require('../services/SailsExtensions');
const escape = SqlUtils.escapeUtil();

module.exports = {
  attributes: {
    from: {
      model: 'user'
    },
    to: {
      collection: 'user'
    },
    subject: {
      type: 'string'
    },
    body: {
      type: 'text'
    },
    task: {
      type: 'boolean',
      defaultsTo: false
    },
    complete_by: {
      type: 'datetime'
    },
    priority: {
      type: 'string'
    },
    original_message: {
      model: 'message'
    },
    complete: {
      type: 'boolean',
      defaultsTo: false
    },
    completed_by: {
      model: 'user'
    },

    completed_on: {
      type: 'datetime'
    },
    approved: {
      type: 'boolean',
      defaultsTo: false
    },

    send_email: {
      type: 'boolean',
      defaultsTo: false
    },
    // archive: {
    //     type: 'boolean',
    //     defaultsTo: false
    // },
    files: {
      collection: 'sysfile'
    },

    entity: {
      type: 'string',
      in: [
        '',
        'station',
        'node',
        'user',
        'purchaseorder',
        'stocktake',
        'costapproval',
        'workorder'
      ]
    },

    entity_id: {
      type: 'integer'
    },

    entity_context: {
      type: 'integer'
    },

    meta: {
      type: 'json'
    }
  },

  userGroupMessageQuery: function(message) {
    return escape(
      `SELECT
    "u"."id" AS "id",
    "m"."id" AS "messaging_id",
    "u"."avatar" ->> 'thumb' AS "photo",
    "m"."createdAt" AS "date",
    concat (
      "u"."first_name",
      ' ',
      COALESCE ( "u"."middle_name", '' ),
      COALESCE ( "u"."middle_name", ' ' ),
      "u"."last_name" 
    ) as "name"
  FROM
    "messaging" "m"
    JOIN "user" "u" ON ( "u"."id" = "m"."to" ) 
  WHERE
    "m"."message" = %s; `,
      Message.getId(message)
    );
  },

  frontEndMessageModule: function() {
    return 'messaging';
  },

  generateLocals: async function(req, res) {
    const domain = res.locals.domain;
    const user = req.user;
    const language = Translates.getLanguage(req, res);
    const site = await Site.thisSiteAsync(domain);
    return {
      language: language,
      user: user,
      domain: domain,
      config: site
    };
  },

  taskMessage: async function(message, language) {
    const fmt = TimeUtils.constants.formats.Date.full;
    let identifier = `labels.TASKS_DUE`;
    const pastDue =
      message.complete_by &&
      !message.complete &&
      TimeUtils.date(message.complete_by).isBefore(now_);

    const completeBy = message.complete
      ? message.completed_on
        ? TimeUtils.formattedDate(message.completed_on, fmt)
        : null
      : message.complete_by
      ? TimeUtils.formattedDate(message.complete_by, fmt)
      : null;
    if (message.complete) {
      identifier = 'labels.TASKS_COMPLETE';
    } else if (pastDue) {
      identifier = 'labels.TASKS_OVERDUE';
    }
    if (message.approved) {
      identifier = 'labels.TASKS_APPROVED';
    }

    const vars = await Variable.find().where({
      key: Translates.translateIdentity,
      identity: identifier
    });

    const dateString = ` ${completeBy || ''}`;
    const lang = language || Translates.fallbackLanguage;
    if (!_.size(vars)) {
      return `Task Date${dateString}`;
    } else {
      const v = vars.pop();
      return `${v.value[lang]}${dateString}`;
    }
  },

  canApprove: async function(message, context) {
    if (!message.task || !message.complete || message.approved) {
      return false;
    }

    const from = User.getId(message.from);
    const uid = User.getId(context.user);
    return from === uid;
  },

  buildMessageHeader: async function(message, context) {
    const uGroupQuery = this.userGroupMessageQuery(message);
    const results = await Message.queryAsync(uGroupQuery);
    const users = results.rows;
    const fmt = TimeUtils.constants.formats.Date.full;
    const senderId = Message.getId(message.from);
    const userHold = [];

    const send = {
      id: await Tracker.buildRandomId('short'),
      type: this.frontEndMessageModule(),
      data: {
        canApprove: this.canApprove(message, context),
        taskMessage: await this.taskMessage(message, context.language),
        pastDue:
          message.complete_by &&
          !message.complete &&
          TimeUtils.date(message.complete_by).isBefore(now_),
        approved: message.approved,
        complete: message.complete,
        task: message.task,
        recipients: [],
        subject: message.subject,
        date: TimeUtils.formattedDate(message.createdAt, fmt),
        message: Message.getId(message)
      }
    };

    for (let i = 0; i < _.size(users); i++) {
      const user = users[i];
      const uId = Message.getId(user);
      userHold.push(uId);
      if (uId === senderId) {
        send.data.name = user.name;
        send.data.photo = user.photo;
      } else {
        send.data.recipients.push({
          name: user.name,
          photo: user.photo
        });
      }
    }

    send.data.users = userHold;

    return send;
  },

  buildMessageSignature: async function(message) {
    const user = await User.findOneById(User.getId(message.from));
    const fmt = TimeUtils.constants.formats.Date.full;
    return {
      id: await Tracker.buildRandomId('short'),
      type: this.frontEndMessageModule(),
      data: {
        signature: true,
        name: User.fullName(user),
        photo: (user.avatar || {}).thumb,
        date: TimeUtils.formattedDate(message.createdAt, fmt)
      }
    };
  },

  getBuildBasicElement: async function(text) {
    return {
      id: await Tracker.buildRandomId('short'),
      type: 'paragraph',
      data: {
        text: text
      }
    };
  },

  getDelimeter: async function() {
    return {
      data: {
        delimeter: true
      },
      id: await Tracker.buildRandomId('short'),
      type: this.frontEndMessageModule()
    };
  },

  isParseableForSpecials: function(block, locals) {
    let items;
    switch (block.type) {
      case 'checklist':
        // parse the special;
        items = (block.data || {}).items;
        for (let i = 0; i < _.size(items); i++) {
          const item = items[i] || {};
          item.text = CommonUtils.parseLocals(item.text, locals);
        }
        break;
      default:
        if ((block.data || {}).text) {
          block.data.text = CommonUtils.parseLocals(
            (block.data || {}).text,
            locals
          );
        }
    }
    return {
      ...block
    };
  },

  buildMessages: async function(body, locals) {
    const messages = [];
    try {
      const messageObjects = JSON.parse(body);
      const blocks = (messageObjects || {}).blocks || [];
      for (let i = 0; i < _.size(blocks); i++) {
        const block = this.isParseableForSpecials(blocks[i], locals);
        messages.push(block);
      }
    } catch (e) {
      sails.log.error(e);
      messages.push(await this.getBuildBasicElement(body));
    }
    return messages;
  },

  buildMessageContent: async function(messages, localContext) {
    const content = [];

    for (let i = 0; i < _.size(messages); i++) {
      const mId = messages[i];
      const message = await Message.findOneById(mId);
      const header = await this.buildMessageHeader(message, localContext);
      header.data.files = [];
      const hasFiles = {};
      content.push(header);
      const conversations = await Message.find()
        .where({
          original_message: mId
        })
        .sort({ createdAt: 'DESC' })
        .populateAll();
      for (let j = 0; j < _.size(conversations); j++) {
        const convo = conversations[j];
        const localFunc = await this.messageLocals(
          convo.from,
          localContext.config
        );
        const locals = localFunc(convo, localContext.user, true);
        const bodyElements = await this.buildMessages(convo.body, locals);
        content.push(...bodyElements);
        const signature = await this.buildMessageSignature(convo);
        content.push(signature);
        if (_.size(convo.files)) {
          const files = _.map(convo.files, f => SysFile.getId(f));
          for (let i = 0; i < _.size(files); i++) {
            const file = files[i];
            if (!hasFiles[file]) {
              header.data.files.push(file);
              hasFiles[file] = true;
            }
          }
        }
      }
      if (i < _.size(messages) - 1) {
        content.push(await this.getDelimeter());
      }
    }

    return {
      messages: { blocks: content }
    };
  },

  getEntityIdQuery: function(params) {
    let entity = '';
    if (_.size(params)) {
      entity = Node.parseWhere(params, { name: 'message' }, null, true);
      entity += ' AND ';
    }
    entity += '"original_message" = "id"';
    return entity;
  },

  getMessageIds: async function(params) {
    const query = this.getEntityIdQuery(params);
    const select = escape(
      `SELECT "id" FROM "message" WHERE %s ORDER BY "createdAt" DESC`,
      query
    );
    const results = await Model.queryAsync(select);
    const ids = _.pluck(results.rows, 'id');
    return ids;
  },

  seakAutoGeneratedMessage: async function(messages, domain) {
    const sUser = await User.similieUser(domain);
    for (let i = 0; i < _.size(messages); i++) {
      const message = messages[i];
      if (Message.getId(message) && !message.from) {
        message.from = _.clone(sUser);
      }
    }
  },

  get: async function(req, res) {
    const user = req.user;
    let messages = await new Promise(resolve => {
      Utils.getParser(req, res, resolve);
    });
    const config = await Site.thisSiteAsync(res.locals.domain);
    const one = !_.isArray(messages);
    if (one) {
      messages = [messages];
    }

    for (let i = 0; i < _.size(messages); i++) {
      const message = messages[i];
      const from = message.from;
      const messageLocals = await Message.messageLocals(from, config);
      const recipients = message.to;
      for (let j = 0; j < _.size(recipients); j++) {
        const recipient = recipients[j];
        if (User.getId(recipient) !== User.getId(user)) {
          continue;
        }
        const elements = messageLocals(message, recipient);
        Message.placeLocals(message, elements);
      }
    }

    res.send(one ? messages[0] : messages);
  },

  localKeys: function() {
    return _.clone({
      message_texts: ['subject', 'body'],
      message_keys: ['original_message', 'message']
    });
  },

  placeLocals: function(message, elements) {
    const keys = this.localKeys();
    const message_texts = keys.message_texts;
    const message_keys = keys.message_keys;
    message.meta = message.meta || {};
    message.meta.original_messages = {};
    _.each(message_texts, t => {
      message.meta.original_messages[t] = message[t];
      message[t] = CommonUtils.parseLocals(message[t], elements.locals);
    });
    _.each(message_keys, key => {
      if (_.isObject(message_keys[key])) {
        _.each(message_texts, t => {
          message[key][t] = CommonUtils.parseLocals(
            message[key][t],
            elements.locals
          );
        });
      }
    });
  },

  blastReply: async function(message, req, res) {
    const params = req.params.all();
    const localContext = await Message.generateLocals(req, res);
    const localFunc = await this.messageLocals(
      message.from,
      localContext.config
    );
    const content = [];
    const locals = localFunc(message, localContext.user, true);
    // this is an array
    const bodyElements = await this.buildMessages(message.body, locals);
    content.push(...bodyElements);
    const signature = await this.buildMessageSignature(message);
    content.push(signature);
    const send = {
      message: message,
      contents: content,
      original_message: Message.getId(params.message)
    };
    sails.sockets.blast(this.constants().QUICK_REPLY_SOCKET, send, req);
    return send;
  },

  constants: function() {
    return {
      QUICK_REPLY_SOCKET: 'quick_message_reply'
    };
  },

  parseAllBodyContent: function(models, paramname = 'body') {
    for (let i = 0; i < _.size(models); i++) {
      models[i][paramname] = this.parseMessageBody(models[i][paramname]);
    }
  },

  parseMessageBody: function(body) {
    try {
      const change = JSON.parse(body);
      const parser = new EdjsParser();
      const markup = parser.parse(change);
      return markup;
    } catch (e) {
      return body;
    }
  },

  messageLocals: async function(from, _config) {
    const config =
      _config || (await Site.thisSiteAsync((from || {}).last_domain));
    return function(message, to, noBodyParser) {
      const name = User.fullName(to);
      const body = (message || {}).body;
      const locals = {
        full_name: name,
        NAME: name,
        sender_name: User.fullName(from),
        body: noBodyParser ? body : Message.parseMessageBody(body),
        subject: (message || {}).subject,
        host: Utils.pullHost(config),
        site_name: config.site_name,
        ...to.toObject()
      };
      return _.clone({
        locals: locals,
        config: config,
        name: name
      });
    };
  },

  completeTask: function(mId, next) {
    return next();
  },

  fillMessage: async function(message) {
    const mId = Message.getId(message);
    if (!mId) {
      return message;
    }

    return await Message.findOneById(mId).populateAll();
  },

  setMessaging: async function(messaging) {
    const mess = await Messaging.create(messaging);
    for (let i = 0; i < _.size(mess); i++) {
      const m = mess[i];
      const message = await Messaging.findOneById(m.id).populateAll();
      const user = message.to;
      if (user && user.online) {
        const from = message.from;
        const messageLocals = await Message.messageLocals(from);
        Messaging.placeLocals(message, messageLocals, user);
        await user.socketMessage(
          `${Const.sockets.NEW_MESSAGE}-${User.getId(user)}`,
          message
        );
      }
    }
  },

  clone: function(
    message,
    {
      from,
      users,
      email,
      entity,
      entity_id,
      entity_context,
      complete,
      body,
      approved,
      files
    }
  ) {
    const clone = {
      ...message
    };
    delete clone.to;
    delete clone.files;

    delete clone.id;
    delete clone.createdAt;
    delete clone.updatedAt;
    clone.from = User.getId(from);
    clone.body = body;
    clone.to = [];
    let contains = false;
    for (let i = 0; i < _.size(users); i++) {
      const to = User.getId(users[i]);
      clone.to.push(to);
      if (!contains && to === clone.from) {
        contains = true;
      }
    }

    if (!contains) {
      clone.to.push(clone.from);
    }

    clone.email = email || false;
    clone.entity = entity;
    clone.entity_id = entity_id;
    clone.entity_context = entity_context;
    clone.complete = complete || clone.complete;
    clone.approved = approved || clone.approved;
    clone.completed_by = User.getId(from);
    if (_.size(files)) {
      clone.files = _.map(files, f => SysFile.getId(f));
    }
    return clone;
  },

  conversationFiles: async function(req) {
    const params = Utils.params(req);
    const selectIds = escape(
      `Select "id" FROM "message" where "original_message" = %s`,
      Message.getId(params)
    );
    const results = await Message.queryAsync(selectIds);
    const ids = _.pluck(results.rows, 'id');
    const elements = Message.getFileCollection();
    const select = escape(
      `SELECT %s FROM %s WHERE %s %s`,
      elements.collection_row,
      elements.table,
      elements.model_row,
      SqlUtils.setInString(ids)
    );

    const selectResults = await Message.queryAsync(select);
    return _.pluck(selectResults.rows, elements.collection_row);
  },

  beforeCreate: async function(values, next) {
    next();
  },

  getTaskQuery: function(req) {
    const params = req.params.all();
    if (_.isString(params.where)) {
      params.where = JSON.parse(params.where);
    }
    const user = this.getUser(req);
    const audience = params.join
      ? escape(
          `("m"."from" = %s OR "mes"."to" = %s)`,
          Model.getId(user),
          Model.getId(user)
        )
      : escape(
          `${
            params.invert
              ? '"m"."from" = %s AND "mes"."to" <> "m"."from"'
              : '"mes"."to" = %s AND "mes"."to" <> "m"."from"'
          }`,
          Model.getId(user)
        );
    const select = escape(
      `SELECT DISTINCT "m"."id" 
      FROM "message" "m" 
      JOIN "messaging" "mes" ON ("mes"."message" = "m"."id")
      WHERE "mes"."archive" IS FALSE 
        AND "m"."original_message" = "m"."id" 
        AND "m"."task" IS TRUE 
        AND "m"."approved" ${params.where.approved ? 'IS TRUE' : 'IS FALSE'} 
        AND %s `,
      audience
    );

    return select;
  },

  getTaskIds: async function(req) {
    try {
      const query = this.getTaskQuery(req);
      const results = await Model.queryAsync(query);
      return _.pluck(results.rows, 'id');
    } catch (e) {
      sails.log.error(e);
      return [];
    }
  },

  getTasks: async function(req) {
    const ids = await this.getTaskIds(req);
    const taskMessages = await Message.find()
      .where({ id: ids })
      .populateAll()
      .sort({ createdAt: 'DESC' })
      .skip(Utils.skip(req))
      .limit(Utils.limit(req));
    return taskMessages;
  },

  getAllMessageIds: async function(originaMessage) {
    const select = escape(
      `SELECT "id", "from" FROM "message" WHERE "original_message" = %s`,
      Model.getId(originaMessage)
    );
    const results = await Message.queryAsync(select);
    return results.rows;
  },

  getInsertQueryForToMessages: function(messageId, to) {
    const collectionDetails = this.getToCollection();
    return escape(
      `INSERT INTO "public"."%s" ("%s", "%s") VALUES (%s, %s)`,
      collectionDetails.table,
      collectionDetails.model_row,
      collectionDetails.collection_row,
      messageId,
      to
    );
  },

  getFileCollection: function() {
    const collection = Utils.populateCollections(
      { files: true },
      this._attributes
    );
    const collectionRow = collection.pop();
    const collectionDetails = Utils.queryCollection(collectionRow, 'message');
    return collectionDetails;
  },

  getToCollection: function() {
    const collection = Utils.populateCollections(
      { to: true },
      this._attributes
    );
    const collectionRow = collection.pop();
    const collectionDetails = Utils.queryCollection(collectionRow, 'message');
    return collectionDetails;
  },

  markComplete: async function(message, { complete, from, approved }) {
    if (!complete && !approved) {
      return;
    }
    if (!message.complete) {
      message.complete = complete || message.complete;
      message.completed_on = TimeUtils.isoFormattedDate(now_);
      message.completed_by = from;
    }

    if (message.complete && !message.approved) {
      message.approved = approved || message.approved;
      // message.approved_on = TimeUtils.isoFormattedDate(now_);
      message.approved_by = from;
    }
    return await Message.saveAsync(message);
  },

  getUser: function(req) {
    const params = req.params.all();
    const user = params.user || req.user || { id: -1 };
    return Message.getId(user);
  },

  applySilentConversation: async function(messageClone) {
    const collectionDetails = this.getToCollection();
    const originalMessage = Model.getId(messageClone.original_message);
    const query = escape(
      'SELECT * FROM "%s" WHERE "%s" = %s AND "%s" = %s',
      collectionDetails.table,
      collectionDetails.model_row,
      originalMessage,
      collectionDetails.collection_row,
      messageClone.from
    );

    const results = await Message.queryAsync(query);
    const items = results.rows;
    const _message = await Message.create(messageClone); // { id: -1000, from: 1 }; //

    // this person is always a part of our conversation
    if (_.size(items)) {
      return _message;
    }
    // const query = this.getEntityIdQuery)_'
    const messages = await this.getAllMessageIds(messageClone.original_message);

    for (let i = 0; i < _.size(messages); i++) {
      const message = messages[i];
      const messageId = message.id;
      const from = message.from;
      if (messageId === Message.getId(_message)) {
        continue;
      }

      const query = this.getInsertQueryForToMessages(
        messageId,
        messageClone.from
      );
      await Message.queryAsync(query);
      await Messaging.generateStaleMessage(
        messageId,
        originalMessage,
        from,
        messageClone.from,
        messageClone.task
      );
    }
    return _message;
  },

  afterCreate: async function(values, next) {
    if (!values.id) {
      return next();
    }
    if (_.size((values.meta || {}).message_tags)) {
      const collection = [
        {
          model: 'user',
          key: 'tags',
          collection: 'tag',
          ids: values.meta.message_tags
        }
      ];
      const taggedIds = await SailsExtensions.queryCollections(collection);
      if (_.size(taggedIds)) {
        const to = [...taggedIds.user];
        const message = await Message.findOneById(values.id);
        _.each(to, t => message.to.add(t));
        delete message.meta.message_tags;
        await Message.saveAsync(message);
      }
    }

    const message = await Message.findOneById(values.id).populateAll();
    if (!_.size(message.to)) {
      return next();
    }
    const userCache = {};
    _.each(message.to, to => {
      userCache[to.id] = to;
    });
    const messaging = [];

    let from;
    if (values.from) {
      from = await User.findOneById(User.getId(values.from));
    }
    for (let i = 0; i < _.size(message.to); i++) {
      const to = message.to[i];
      const uId = Message.getId(to);

      if (!from) {
        from = await User.similieUser(to.last_domain);
      }
      const messageLocals = await Message.messageLocals(from);
      const elements = messageLocals(message, to);
      const locals = elements.locals;

      const hold = {
        message: Message.getId(message),
        to: uId,
        from: User.getId(from),
        task: message.task
      };

      hold.original_message =
        Message.getId(message.original_message) || message.id;

      messaging.push(hold);
      if (message.send_email && to.id !== from.id) {
        const config = elements.config;
        const name = elements.name;
        Jobs.sendEmail.add({
          to: {
            address: to.email,
            name: name
          },
          attachments: message.files,
          subject: message.subject,
          locals: locals,
          language: to.preferred_language || config.default_language,
          template: 'message',
          variables: Email.variables.message.key,
          tags: ['user message']
        });
      }
    }

    /*
     * We need to work with the original message and make sure that we are processing this for appropriate threading
     */

    if (message.original_message && message.original_message.task) {
      const oMessage = await Message.findOneById(
        message.original_message.id
      ).populateAll();

      if (message.complete) {
        oMessage.complete = true;
        oMessage.completed_on = TimeUtils.isoFormattedDate(now_);
        await Message.saveAsync(oMessage);
      }
      if (message.approved) {
        oMessage.approved = true;
        await Message.saveAsync(oMessage);
      }

      _.each(oMessage.to, async u => {
        if (
          u &&
          u.online &&
          !userCache[u.id]
          //  !_.contains(userIds, u.id)
        ) {
          await u.socketMessage(Const.sockets.NEW_TASK_UPDATE, oMessage);
        }
      });

      await Message.setMessaging(messaging);
      /*
       * If we don't have the original message, set it as it's self.
       * this means that the
       */
    } else if (!message.original_message) {
      message.original_message = message.id;
      await Message.saveAsync(message);
      await Message.setMessaging(messaging);
    } else {
      await Message.setMessaging(messaging);
    }

    return next();
  },

  reports: function(dependents) {
    const reporting = { identifier: 'message' };
    const user = dependents.user;
    const domain = dependents.domain;
    const isDomainAdmin = User.is(user, Roles.DOMAIN_ADMIN) && !domain;
    return Q.fcall(() => {
      const deferred = Q.defer();

      let q = `SELECT 
        count(*), 
        count(*) filter (where read) as read, 
        count(*) filter (where delivered) as delivered 
      FROM messaging AS model `;

      if (!isDomainAdmin) {
        q += `RIGHT JOIN (
            SELECT 
              id, 
              last_domain, 
              role from "user"
            ) AS u ON (u.id = model.from)
          WHERE ${SqlUtils.formatDomainQuery(domain, 'last_domain')}
          AND role < ${Roles.DOMAIN_ADMIN}`;
      }

      q += ';';

      sails.models.user.query(
        escape(q),
        (err, result) => {
          if (err) {
            throw new Error(err);
          }

          reporting.counts = result.rows;

          deferred.resolve(reporting);
        },
        deferred.reject
      );
      return deferred.promise;
      // SELECT count(*) as total_users, count(n
    })
      .then(() => {
        let q = `SELECT 
        count(*) AS task_count,
        count(*) FILTER (where approved) AS approved,
        count(*) FILTER (where complete) AS complete, 
        "m"."from" AS user, 
        u.first_name, 
        u.last_name, 
        u.email, 
        u.username, 
        u.avatar::jsonb `;

        if (!isDomainAdmin) {
          q += `, u.last_domain`;
        }

        q += ` FROM message AS m 
        JOIN "user" u ON (u.id = m.from) 
        WHERE 
          m.original_message IN (
            SELECT distinct(original_message) AS id 
            FROM messaging 
            WHERE task = TRUE
          ) `;

        if (!isDomainAdmin) {
          q += ` 
          AND ${SqlUtils.formatDomainQuery(domain, 'last_domain')} 
          AND role < ${Roles.DOMAIN_ADMIN}
        `;
          q += ' group by 4,5,6,7,8,9,10 ORDER BY approved DESC;';
        } else {
          q += ' group by 4,5,6,7,8,9 ORDER BY approved DESC;';
        }

        const deferred = Q.defer();

        sails.models.user.query(
          escape(q),
          (err, result) => {
            if (err) {
              throw new Error(err);
            }

            reporting.assigned = result.rows;
            deferred.resolve(reporting);
          },
          deferred.reject
        );

        return deferred.promise;
      })
      .then(() => {
        let q = `SELECT 
        count(*) AS task_count,
        count(*) FILTER (where approved) AS approved,
        count(*) FILTER (where complete) AS complete,
        "m"."completed_by" AS user,
        u.first_name,
        u.last_name,
        u.email,
        u.username,
        u.avatar::jsonb`;

        if (!isDomainAdmin) {
          q += `, u.last_domain`;
        }

        q += ` FROM message AS m 
        JOIN "user" u ON (u.id = m.from) 
        WHERE m.original_message IN (
          SELECT distinct(original_message) AS id 
          FROM messaging 
          WHERE task = TRUE
        ) `;

        if (!isDomainAdmin) {
          q += `
          AND ${SqlUtils.formatDomainQuery(domain, 'last_domain')} 
          AND role < ${Roles.DOMAIN_ADMIN}
        `;
          q += ' GROUP BY 4,5,6,7,8,9,10 ORDER BY approved DESC;';
        } else {
          q += ' GROUP BY 4,5,6,7,8,9 ORDER BY approved DESC;';
        }

        const deferred = Q.defer();
        sails.models.user.query(
          escape(q),
          (err, result) => {
            if (err) {
              sails.log.error(err);
              return deferred.reject(err);
            }

            reporting.approved = result.rows;
            deferred.resolve(reporting);
          },
          deferred.reject
        );

        return deferred.promise;
      });
  }
};
