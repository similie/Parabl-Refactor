/**
 * UserActivity.js
 *
 * @description :: TODO: You might write a short summary of how this model works and what it represents here.
 * @docs        :: http://sailsjs.org/documentation/concepts/models-and-orm/models
 */

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  // autoPK: false,
  attributes: {
    user: {
      model: 'user'
    },

    ip: {
      type: 'string'
    },

    method: {
      type: 'string',
      in: ['GET', 'POST', 'PUT', 'PATCH', 'HEAD', 'DELETE']
    },

    path: {
      type: 'string'
    },

    event: {
      type: 'string',
      required: true,
      in: [
        'user_local_login',
        'user_local_logout',
        'user_api_login',
        'user_api_logout',
        'api_access',
        'exp_session',
        'client_page_explored',
        'user_account_created',
        'user_account_activated'
      ]
    },

    resolution: {
      type: 'string',
      in: [
        'user_local_login',
        'user_local_logout',
        'user_api_login',
        'user_api_logout',
        'api_access',
        'exp_session',
        'client_page_explored',
        'user_account_created',
        'user_account_activated'
      ]
    },

    meta: {
      type: 'json'
    },

    useragent: {
      type: 'string'
    }
  },
  // mocking the req.params.all()
  // function for requestless posts
  all: function(id) {
    return {
      params: {
        all: function() {
          return { id: id };
        }
      }
    };
  },

  set: function(event, params, req, cb) {
    if (!event) {
      return (cb || _.noop)('error.EVENT_REQUIRED');
    }

    if (!req || !req.user) {
      return (cb || _.noop)('error.REQUEST_USER_OBJECT_REQUIRED');
    }

    const merge = _.merge(
      {
        event: event,
        user: req.user.id,
        method: req.method,
        path: req.path,
        ip: req.ip,
        meta: {}
      },
      params
    );

    if (((req.params || {}).all || _.noop)().id) {
      merge.meta.model_id = ((req.params || {}).all || _.noop)().id;
    }

    UserActivity.create(merge).exec((err, activity) => {
      (cb || _.noop)(err, activity);
    });
  },

  USER_LOCAL_LOGIN: 'user_local_login',
  USER_LOCAL_LOGOUT: 'user_local_logout',
  USER_API_LOGIN: 'user_api_login',
  USER_API_LOGOUT: 'user_api_logout',
  API_ACCESS: 'api_access',
  EXPIRED_SESSION: 'exp_session',
  CLIENT_PAGE_EXPLORED: 'client_page_explored',
  USER_ACCOUNT_CREATED: 'user_account_created',
  USER_ACCOUNT_ACTIVATED: 'user_account_activated'
};
