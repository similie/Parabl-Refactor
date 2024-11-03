/**
 * MailingAdmin.js
 *
 * @description :: A model definition represents a database table/collection.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    user: {
      model: 'user'
    },
    domain: {
      model: 'domain'
    }
  },

  domainAdmins: async function(domain = null) {
    const admins = await this.find()
      .where({ domain: this.getId(domain) })
      .populate('user');
    return admins.map(a => a.user);
  }
};
