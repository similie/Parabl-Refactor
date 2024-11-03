/**
 * UserBadge.js
 *
 * @description :: A model definition.  Represents a database table/collection/etc.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

module.exports = {
  migrate: process.env.MIGRATION || "safe",
  attributes: {
    badge: {
      model: "badge"
    },

    user: {
      model: "user"
    },

    assigned_by: {
      model: "user"
    },

    memo: {
      type: "text"
    },

    files: {
      collection: "sysfile",
      defaultsTo: false
    },

    demoted: {
      type: "boolean"
    },

    demoted_by: {
      model: "user"
    },

    demotion_memo: {
      type: "text"
    },

    date_assigned: {
      type: "datetime"
    },

    date_demoted: {
      type: "datetime"
    },

    demotion_files: {
      collection: "sysfile"
    },

    meta: {
      type: "json"
    }
  }
};
