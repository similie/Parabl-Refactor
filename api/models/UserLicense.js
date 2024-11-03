/**
 * UserLicense.js
 *
 * @description :: A model definition represents a database table/collection.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    user: {
      model: 'user',
      required: true
    },

    document: {
      model: 'documentation',
      required: true
    },

    accepted: {
      type: 'boolean',
      defaultsTo: false
    },

    accepted_on: {
      type: 'datetime'
    }
  },

  userLicenseFindQuery: function(req) {
    const params = req.params.all();
    const id = +params.user;
    const user = req.user;
    const query = {
      user: id
    };

    if (!User.is(user, Roles.USER_ADMIN) || Model.getId(user) === id) {
      query.accepted = false;
    } else if (
      User.is(user, Roles.USER_ADMIN) &&
      typeof params.accepted !== 'undefined'
    ) {
      query.accepted = params.accepted;
    }
    return query;
  },

  acquireDocuments: async function(user, site) {
    const documentation = await Documentation.find()
      .where({
        license: true,
        enabled: true,
        active: true,
        domain: this.getId(site.domain),
        or: [{ role: { '<=': user.role } }, { role: null }]
      })
      .sort({ weight: 'ASC' });
    const documentationIds = documentation.map(doc => this.getId(doc));
    const send = [];
    for (const docId of documentationIds) {
      const userLicenses = await this.findOrCreate({
        user: this.getId(user),
        document: docId
      });
      if (!userLicenses || userLicenses.accepted) {
        continue;
      }
      send.push(userLicenses);
    }
    return send;
  },

  requiresLicense: async function(user, site) {
    if (!user.schema) {
      return site.require_user_license;
    }
    return user.schema.require_user_license;
  },

  verify: async function(user, site) {
    const license = await this.requiresLicense(user, site);
    if (!license) {
      return;
    }
    const licenses = await this.acquireDocuments(user, site);
    if (!licenses.length) {
      return;
    }
    user.__licenses = licenses;
  }
};
