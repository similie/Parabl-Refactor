/**
 * Contact.js
 *
 * @description :: TODO: You might write a short summary of how this model works and what it represents here.
 * @docs        :: http://sailsjs.org/#!documentation/models
 */

const { TimeUtils } = require('similie-api-services');
const TimePeriod = TimeUtils.constants.ENUMS.timePeriods;
const tz = TimeUtils.constants.timeZone;

const getPrimary = function(contact, object) {
  object = object || 'email';

  const resources = contact[object];

  if (!resources || !resources.length) {
    return null;
  }
  let primary = null;
  _.each(resources, resource => {
    if (resource.primary) {
      primary = resource;
    }
  });

  // if we don't have a primary
  // take the first
  if (!primary) {
    primary = resources[0];
  }

  return primary.resource;
};

module.exports = {
  attributes: {
    first_name: 'string',

    last_name: 'string',

    other_name: 'string',

    title: 'string',

    organization: 'string',

    notes: 'text',

    requestor: {
      model: 'user'
    },

    email: 'array',

    phone: 'array',

    contact_type: {
      model: 'variable'
    },

    preferred_language: {
      type: 'string',
      maxLength: 4
    },

    domain: {
      model: 'domain'
    },

    tags: {
      collection: 'tag'
    },

    primary_district: {
      type: 'string'
    },

    getPrimary: function(contact, type) {
      return getPrimary(this, type);
    },

    sendDataInviteEmail: function(params, cb) {
      const contact = this.toObject();
      const email = getPrimary(contact);

      if (!email) {
        return cb('errors.NO_VALID_EMAIL');
      }

      const expire = 7;
      Invite.create({
        email: email,
        requestor: params.requestor,
        target: params.contact.id,
        target_model: Invite.actions().action.CONTACT_INVITE,
        node: params.schema.id,
        expire: TimeUtils.date('')
          .plus(expire, TimePeriod.days)
          .tz(tz).toISO,
        /* [sg] moment().add(expire, 'days').format(), */

        meta: {
          tags: ['data invite'],
          station: params.station.id
        }
      }).exec((err, invite) => {
        params.invite = invite;

        const name = User.fullName(contact);
        const host = Contact.inviteURL(params.config, invite);

        Jobs.sendEmail.add({
          to: {
            address: email,
            name: name
          },
          locals: {
            station: params.station.local_name,
            // invite: params.invite,
            node: params.schema.name,
            // contact: params.contact,
            inviteURL: host,
            name: name,
            site_name: params.config.site_name,
            days: expire + ' days',
            host: Utils.pullHost(params.config)
          },
          default_language:
            contact.preferred_language || params.config.default_language,
          template: 'data',
          variables: Email.variables.data.key || 'contact_invite_email', //params.variables,
          tags: ['data invite', 'invite created']
        });

        cb(err);
      });
    }
  },

  hasPeople: true,
  getPrimary: getPrimary,

  inviteURL: function(config, invite) {
    const host = Utils.pullHost(config);
    return host + '/invite?token=' + (invite || {}).token;
  },
  beforeCreate: function(values, next) {
    this.removeEmpty(values);
    next();
  },
  beforeUpdate: function(values, next) {
    this.removeEmpty(values, true);
    next();
  },

  removeEmpty: function(values, skip) {
    if (!values.email && !skip) {
      values.email = [];
    }

    if (!values.phone && !skip) {
      values.phone = [];
    }

    for (let i = 0; i < (values.email || []).length; i++) {
      if (!values.email[i].resource) {
        values.email.splice(i, 1);
      }
    }

    for (let i = 0; i < (values.phone || []).length; i++) {
      if (!values.phone[i].resource) {
        values.phone.splice(i, 1);
      }
    }

    if (values.email && values.email.length === 1) {
      values.email[0].primary = true;
    }
  }
};
