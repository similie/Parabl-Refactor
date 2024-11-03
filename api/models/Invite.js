/**
 * Invite.js
 *
 * @description :: TODO: You might write a short summary of how this model works and what it represents here.
 * @docs        :: http://sailsjs.org/#!documentation/models
 */

var uuid = require('uuid');

module.exports = {
  attributes: {
    email: {
      type: 'email'
    },

    active: {
      type: 'boolean',
      defaultsTo: true,
      required: true
    },

    token: {
      type: 'string',
      unique: true
    },

    requestor: {
      model: 'user'
    },

    target: {
      type: 'integer'
    },

    target_model: {
      type: 'string',
      maxLength: 30
    },

    meta: {
      type: 'json'
    },

    node: {
      model: 'nodeschema'
    },

    expire: {
      type: 'datetime'
    },

    domain: {
      model: 'domain'
    },

    tags: {
      type: 'array'
    },
    /*
     * Instance method that invalidates the other invites of the same type
     */
    consume: function(cb) {
      this.active = false;
      this.save(err => {
        if (err) {
          sails.log.error(err);
          return cb(err);
        }

        (cb || _.noop)();
      });
    }
  },

  actions: function() {
    return {
      model: {
        invite_data_chemicalobs: '/forms/chemicalobservation',
        invite_data_rainfall: '/forms/rainfall',
        invite_data_flow: '/forms/flow',
        invite_data_groundwater: '/forms/groundwater',
        invite_data_baro: '/forms/barometer',
        invite_data_waterabstration: '/forms/waterabstraction',
        invite_data_water_level: '/forms/waterlevel'
      },
      path: {
        '/login/password': 'password_reset',
        '/reset-password': 'password_reset',
        '/auth/update-password': 'password_reset',
        '/activate-account': 'account_create',
        '/auth/activate-account': 'account_create',
        '/invite': 'contact_invite',
        '/api/v1/tokenizer/node/invite-submit': 'contact_invite',
        '/api/v1/tokenizer/node': 'contact_invite'
      },
      action: {
        PASSWORD_RESET: 'password_reset',
        CREATE_ACCOUNT: 'account_create',
        CONTACT_INVITE: 'contact_invite'
      },
      match: function(path) {
        var match = null;
        _.each(this.path, (p, key) => {
          if (path.indexOf(key) > -1) {
            match = p;
            return match;
          }
        });

        return match;
      }
    };
  },

  consume: function(token, cb) {
    Invite.findOne({ token: token }).exec((err, invite) => {
      if (err) {
        return cb(err);
      }
      if (!invite) {
        return cb('errors.INVALID_TOKEN');
      }

      invite.consume(cb);
    });
  },

  beforeCreate: function(invite, next) {
    /*
     * We will invalidate all other invites. There should only be one
     */

    invite.token = uuid.v4();
    // find all of the invites of the same type
    sails.models['invite'].find(
      {
        node: invite.node,
        target: invite.target,
        target_model: invite.target_model,
        active: true
      },
      (err, others) => {
        if (err || !others.length) {
          return next();
        }

        async.each(
          others,
          (other, cb) => {
            // weird bug where the newly created element
            // is being pulled through waterline
            if (other.token != invite.token) {
              other.consume(_.noop);
            }

            cb();
          },
          next
        );
      }
    );
  }
};
