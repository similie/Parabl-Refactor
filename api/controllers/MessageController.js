/**
 * MessageController
 *
 * @description :: Server-side logic for managing Messages
 * @help        :: See http://sailsjs.org/#!/documentation/concepts/Controllers
 */
module.exports = {
  findOne: function(req, res) {
    Message.get(req, res);
  },
  find: function(req, res) {
    Message.get(req, res);
  },

  quickReply: async function(req, res) {
    const params = req.params.all();
    if (!params.message) {
      return res.badRequest({ error: 'Message ID required' });
    }
    const message = await Message.findOneById(Message.getId(params.message));
    const clone = Message.clone(message, params);
    await Message.markComplete(message, params);
    const createdMessage = await Message.applySilentConversation(clone);
    const content = await Message.blastReply(createdMessage, req, res);
    res.send(content);
  },

  archive: async function(req, res) {
    const params = Utils.params(req);
    if (!Message.getId(params)) {
      return res.badRequest('errors.INVALID_MESSAGE');
    }
    const user = Message.getUser(req);
    if (user === -1) {
      return res.badRequest('errors.INVALID_USER');
    }

    try {
      const message = await Message.findOneById(Message.getId(params));
      await Messaging.update(
        {
          to: user,
          message: Message.getId(message)
        },
        { archive: params.archive }
      );
      return res.send(message);
    } catch (e) {
      sails.log.error('MessageController::archive', e);
      return res.serverError(e);
    }
  },

  conversationFiles: async function(req, res) {
    const files = await Message.conversationFiles(req);
    return res.send(files);
  },

  pullMessages: async function(req, res) {
    const limit = Utils.limit(req);
    const skip = Utils.skip(req);
    const where = Utils.params(req);
    const payload = {
      skip: skip,
      limit: limit,
      files: []
    };

    const search = {
      limit: limit,
      skip: skip,
      where: {
        ...where
      }
    };
    const messageIds = await Message.getMessageIds(search.where);
    payload.count = _.size(messageIds);
    if (!payload.count) {
      return res.send({
        ...payload
      });
    }
    const localContext = await Message.generateLocals(req, res);
    const content = await Message.buildMessageContent(messageIds, localContext);
    res.send({
      ...payload,
      ...content
    });
  },

  getReads: async function(req, res) {
    const params = Utils.params(req);
    if (!params.id) {
      return res.badRequest({ error: 'Message ID required' });
    }
    const reads = await Messaging.getReadElements([params.id], req.user);
    return res.send(reads);
  },

  entityCount: async function(req, res) {
    const params = req.params.all();
    const messageIds = await Message.getMessageIds(params);
    let counts = 0;
    if (_.size(messageIds)) {
      const count = await Message.count({ original_message: messageIds });
      // we do 2 because messaging aways sends one to the from and to the to
      counts = count;
    }
    return res.send({ total: counts });
  },

  count: function(req, res) {
    const params = req.params.all();
    const user = params.user || (req.user || { id: -1 }).id;

    if (user === -1) {
      return res.badRequest('errors.INVALID_USER');
    }

    let archive = params.archive || false;

    if (params.where && _.isString(params.where)) {
      params.where = JSON.parse(params.where);
      archive = params.where.archive || archive;
      delete params.where.archive;
    } else if (params.where) {
      archive = (params.where || {}).archive || archive;
      delete params.where.archive;
    }

    const query = {
      to: user,
      archive: archive
    };

    let m;

    if (params.where) {
      m = Messaging.find(query);
    } else {
      m = Messaging.count(query);
    }
    m.exec((err, count) => {
      if (err) {
        return res.serverError(err);
      }

      if (params.where) {
        params.where.id = _.pluck(count, 'message');

        const m = Message.count(params.where);
        m.exec((err, count) => {
          if (err) {
            return res.serverError(err);
          }
          res.send({ total: count });
        });
      } else {
        res.send({ total: count });
      }
    });
  },

  to: async function(req, res) {
    const messages = await Message.getTasks(req);
    res.send(messages);
  }
};
