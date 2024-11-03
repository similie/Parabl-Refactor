/**
 * EventRegistrationController
 *
 * @description :: Server-side actions for handling incoming requests.
 * @help        :: See https://sailsjs.com/docs/concepts/actions
 */

const { Common } = require('../model-utilities/common/common');
const {
  EwsActionUtils
} = require('../model-utilities/early-warning/ews/ews-action-utils');

module.exports = {
  verify: async function(req, res) {
    if (EventRegistration.matchedRegistration(req)) {
      return res.badRequest({ error: 'Account already verified' });
    }

    const params = req.params.all();
    if (!params.id) {
      return res.badRequest({ error: 'A user ID is required' });
    }
    if (req.method === 'POST') {
      return EventRegistration.verificationRequest(req, res);
    }

    if (req.method !== 'GET') {
      return res.notFound({ error: 'This path is invalid' });
    }

    const user = await User.findOneById(params.id).populate('schema');
    if (!user) {
      return res.notFound({ error: 'This account is not valid' });
    }

    if (!user.schema || !user.schema.assign_to_ew) {
      return res.badRequest({ error: 'User type is not valid' });
    }

    const credentialObj = {
      verify: 'email',
      user: params.id,
      preferred_language: user.preferred_language,
      domain: user.last_domain
    };

    if (user.email) {
      credentialObj.target = user.email;
    } else if (user.phone) {
      credentialObj.verify = 'sms';
      credentialObj.target = user.phone;
    } else {
      return res.badRequest({ error: 'User verification failed' });
    }
    const created = await CredentialsVerification.create(credentialObj);
    res.send(created.toJSON());
  },

  updateSubscriptions: async function(req, res) {
    if (req.method === 'DELETE') {
      return EventRegistration.removalRequest(req, res);
    }

    if (req.method !== 'PUT') {
      return res.notFound();
    }
    const params = req.params.all();
    if (!params.id) {
      return res.badRequest({ error: 'A user ID is required' });
    }

    try {
      EventRegistration.checkValidEntry(req);
    } catch (e) {
      return res.forbidden({
        error: e.message
      });
    }

    const subscriptions = params.subscriptions || [];
    // first set all as disabled
    for (const subscribe of subscriptions) {
      if (subscribe.id) {
        await EventRegistration.update(
          { id: subscribe.id },
          { active: subscribe.active, meta: subscribe.meta }
        );
      } else {
        const created = await EventRegistration.create({
          user: params.id,
          ...subscribe
        });
        subscribe.id = Model.getId(created);
      }
    }

    res.send({ id: params.id, subscriptions });
  },

  subscriptions: async function(req, res) {
    const params = req.params.all();
    if (!params.id) {
      return res.badRequest({ error: 'A user ID is required' });
    }

    try {
      EventRegistration.checkValidEntry(req);
    } catch (e) {
      return res.forbidden({
        error: e.message
      });
    }

    const user = await User.findOneById(params.id);
    if (!user) {
      return res.badRequest({ error: 'User not found' });
    }
    const subscriptions = await EventRegistration.find()
      .where({
        user: params.id,
        active: true
      })
      .sort({ createdAt: 'ASC' });

    const eventIds = Common.returnItemIdsOnParam(subscriptions, 'event');
    const events = await EarlyWarning.find()
      .where({ id: eventIds })
      .populate('tags')
      .populate('node');
    const ewUtils = new EwsActionUtils();
    await ewUtils.decorateSpecialEvents(events);
    await ewUtils.decorateStationDetails(events);

    res.json({  
      user: user.safeUser(),
      subscriptions,
      events
    });
  },

  register: async function(req, res) {
    const params = req.params.all();
    const continueExec = await Tracker.publicPostControllerProtect(req, res);
    if (!continueExec) {
      return;
    }
    if (!params.user || !params.user.schema) {
      return res.badRequest({ error: 'Request Invalid' });
    }

    try {
      const siteContent = params.siteContent || {};
      params.user.user_access_disabled = !params.user.email;
      const user = await User.createWithDomain(params.user, siteContent.domain);
      const id = User.getId(user);
      const subscriptions = params.subscriptions || [];
      if (!Array.isArray(subscriptions)) {
        return res.send({ id });
      }
      const subscribed = [];
      for (let i = 0; i < subscriptions.length; i++) {
        const subscription = subscriptions[i];
        const saved = await EventRegistration.create({
          user: id,
          ...subscription
        });
        subscribed.push(saved.id);
      }
      await EventRegistration.confirm(user);
      req.session.eventRegistered = user;
      return res.send({ id, subscribed });
    } catch (e) {
      return res.serverError({ error: e.message });
    }
  }
};
