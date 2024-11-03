/**
 * EarlyWarningController
 *
 * @description :: Server-side logic for managing Earlywarnings
 * @help        :: See http://sailsjs.org/#!/documentation/concepts/Controllers
 */

const {
  EwsActionUtils
} = require('../model-utilities/early-warning/ews/ews-action-utils');
const SailsExtensions = require('../services/SailsExtensions');

module.exports = {
  find: async function(req, res) {
    const ewUtils = new EwsActionUtils();
    try {
      const models = await SailsExtensions.find(req, res);
      await ewUtils.decorateSpecialEvents(models);
      return res.json(models);
    } catch (e) {
      return res.serverError(e);
    }
  },

  findPublic: async function(req, res) {
    const ewUtils = new EwsActionUtils();
    try {
      const params = SailsExtensions.params(req);
      if (!params.public && !params.public_id) {
        return res.badRequest({
          error: 'Public Events Only Through this Route'
        });
      }
      let events;
      let count = 0;
      if (params.tags) {
        const values = await EarlyWarning.queryByTags(req);
        events = values.events;
        count = values.count;
      } else {
        events = await SailsExtensions.find(req, res);
        count = await EarlyWarning.count().where(params);
      }

      await ewUtils.decorateSpecialEvents(events);
      await ewUtils.decorateStationDetails(events);
      return res.json({
        events,
        count
      });
    } catch (e) {
      return res.serverError({ error: e.message });
    }
  },

  publicUrl: async function(req, res) {
    const params = req.params.all();
    const ids = Array.isArray(params.id) ? params.id : [params.id];
    if (!ids.length) {
      return res.send({ error: 'Event IDs Required' });
    }
    const config = res.locals.siteData;
    const ews = await EarlyWarning.find().where({ id: ids });
    const publicIds = ews.map(ew => ew.public_id).filter(ew => !!ew);

    if (!publicIds.length) {
      return res.send({ error: 'No Public IDs Found' });
    }

    const userSchemas = await NodeSchema.find().where({ assign_to_ew: true });
    if (!userSchemas.length) {
      return res.send({ error: 'No User Types Available for Events' });
    }
    const userSchemaIds = userSchemas
      .map(user => User.getId(user))
      .filter(user => !!user);

    res.send({
      registrationUrl: EarlyWarning.buildRegistrationUrl(
        config,
        publicIds,
        userSchemaIds
      )
    });
  }
};
