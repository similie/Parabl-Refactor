/**
 * Tag.js
 *
 * @description :: TODO: You might write a short summary of how this model works and what it represents here.
 * @docs        :: http://sailsjs.org/documentation/concepts/models-and-orm/models
 */

const SailsExtensions = require('../services/SailsExtensions');

module.exports = {
  attributes: {
    name: {
      type: 'string',
      unique: true,
      required: true
    },

    tag_category: {
      model: 'variable'
    },

    body: {
      type: 'text'
    },

    domain: {
      model: 'domain'
    },

    meta: {
      type: 'json'
    }
  },

  filteredUsers: function(users = []) {
    return (user, type) => {
      return !_.size(
        _.where(users, {
          email: user.email,
          phone: user.phone,
          type: type
        })
      );
    };
  },

  pullAudience: async function(audience = [], domain) {
    if (!audience.length) {
      return [];
    }

    const collection = [
      {
        model: 'user',
        key: 'tags',
        collection: 'tag',
        ids: audience.map(a => this.getId(a))
      }
    ];

    const language = await Site.siteLanguage(domain);
    const tagedIDs = await SailsExtensions.queryCollections(collection);
    const results = [];
    const users = [];
    for (const key in tagedIDs) {
      const ids = tagedIDs[key];
      const model = sails.models[key];
      const found = await model.find({
        id: ids
      });
      results.push({
        results: found,
        type: key
      });
    }

    const filterFunc = this.filteredUsers(users);
    for (let i = 0; i < _.size(results); i++) {
      const result = results[i];
      const type = result.type;
      for (let j = 0; j < _.size(result.results); j++) {
        const _user = result.results[j];
        const user = User.userKey(_user, language, type);
        if (filterFunc(user, type)) {
          users.push(user);
        }
      }
    }
    return users;
  },

  beforeCreate: trim(),

  beforeUpdate: trim()
};

function trim() {
  return function(values, next) {
    values.name = values.name.trim();
    Variable.pullImports(values, next);
  };
}
