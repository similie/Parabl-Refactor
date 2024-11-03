/**
 * OrganizationalCareer.js
 *
 * @description :: A model definition represents a database table/collection.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    organization: {
      model: 'organization',
      required: true,
      unique: true
    },
    career_progression: {
      type: 'array'
    },
    meta: {
      type: 'json'
    }
  },

  getClonedCareers: function(oc) {
    const cP = oc.career_progression;
    const send = [];
    for (let i = 0; i < _.size(cP); i++) {
      const c = cP[i];
      c.id = Tracker.buildRandomId('short');
      send.push({
        ...c
      });
    }

    return send;
  },

  drawSimpleProgression: function(organization) {
    const progressions = organization.career_progression;
    const simple = {};
    let currentProgress = null;
    for (let i = 0; i < _.size(progressions); i++) {
      const progress = progressions[i];
      if (progress.break) {
        currentProgress = progress.id || progress.name;
        simple[currentProgress] = {
          id: progress.id,
          name: progress.name,
          groups: []
        };
      } else {
        simple[currentProgress].groups.push({
          name: progress.name,
          badgeImage: progress.badgeImage
        });
      }
    }
    return simple;
  },

  simplifyProgression: function(organizations, bCache = {}) {
    for (let i = 0; i < _.size(organizations); i++) {
      const org = organizations[i];
      const simple = this.drawSimpleProgression(org);
      org._simple = simple;
      const o = org.organization;
      const badge = bCache[Organization.getId(o)];
      if (badge) {
        org._badge = badge;
      }
    }
  },

  setBadging: async function(career) {
    const cId = OrganizationalCareer.getId(career);
    const oc = await OrganizationalCareer.findOneById(cId);
    const oId = Organization.getId(oc.organization);
    // organization
    if (!oId) {
      return;
    }

    const size = _.size(oc.career_progression);

    await BadgeWeight.destroy({ where: { organization: oId } });
    let j = 0;
    for (let i = 0; i < size; i++) {
      const progress = oc.career_progression[i];
      if (progress.badge) {
        await BadgeWeight.create({
          badge: Badge.getId(progress.badge),
          organization: oId,
          weight: j
        });
        j++;
      }

      if (!Model.getId(progress)) {
        progress.id = Tracker.buildRandomId('short');
      }
    }
  },

  afterCreate: async function(values, next) {
    OrganizationalCareer.setBadging(values);
    next();
  },
  beforeUpdate: async function(values, next) {
    OrganizationalCareer.setBadging(values);
    next();
  }
};
