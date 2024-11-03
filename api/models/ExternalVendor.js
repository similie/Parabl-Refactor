/**
 * ExternalVendor.js
 *
 * @description :: A model definition.  Represents a database table/collection/etc.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

module.exports = {
  migrate: process.env.MIGRATION || "safe",
  attributes: {
    company_name: {
      type: "string"
    },

    contact_name: {
      type: "string"
    },

    contact_number: {
      type: "string"
    },

    contact_email: {
      type: "email"
    },
    contact_details: {
      type: "text"
    },
    domain: {
      model: "domain"
    }
  }
};
