/**
 * CareerTrack.js
 *
 * @description :: TODO: You might write a short summary of how this model works and what it represents here.
 * @docs        :: http://sailsjs.org/documentation/concepts/models-and-orm/models
 */

const { SqlUtils } = require('similie-api-services');

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    organization: {
      type: 'integer',
      required: true
    },
    career: {
      type: 'integer',
      required: true
    },
    jobtemplate: {
      type: 'integer',
      required: true
    },
    progression_id: {
      type: 'string'
    },
    weight: {
      type: 'integer',
      min: 0
    }
  },

  getOrgIdsOnTemplate: async function(jobtemplate) {
    const escape = SqlUtils.escapeUtil();
    const tId = JobTemplate.getId(jobtemplate);
    if (!tId) {
      return [];
    }
    const query = escape(
      `SELECT "organization" FROM "careertrack" WHERE "jobtemplate" = %s`,
      tId
    );
    const results = await CareerTrack.queryAsync(query);
    return _.map(results.rows, r => r.organization);
  }
};
