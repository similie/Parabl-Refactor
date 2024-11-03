/**
 * JobDescription.js
 *
 * @description :: A model definition represents a database table/collection.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    jobtemplate: {
      required: true,
      model: 'jobtemplate'
    },
    title: {
      type: 'string'
    },
    description: {
      type: 'text'
    },
    overrides: {
      type: 'json'
    }
  },
  beforeCreate: async function(values, next) {
    const template = values.jobtemplate;
    if (!template) {
      return next('Job Template Required');
    }
    // jobtemplate
    const _template = await JobTemplate.findOneById(template);
    // this will allow us to override these paraemeters
    values.title = _template.title;
    values.description = _template.description;
    next();
  }
};
