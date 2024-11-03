/**
 * UserSurvey.js
 *
 * @description :: TODO: You might write a short summary of how this model works and what it represents here.
 * @docs        :: http://sailsjs.org/documentation/concepts/models-and-orm/models
 */

module.exports = {
  attributes: {
    user: {
      model: 'surveyuser'
    },

    node: {
      model: 'nodeschema'
    },

    station: {
      model: 'station'
    },

    survey: {
      type: 'integer'
    }
  }
};
