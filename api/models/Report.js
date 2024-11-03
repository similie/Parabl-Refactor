/**
 * Report.js
 *
 * @description :: TODO: You might write a short summary of how this model works and what it represents here.
 * @docs        :: http://sailsjs.org/documentation/concepts/models-and-orm/models
 */

const { _combinelike, _setAggregates, _buildReport, _getReportParams, _querySet, _beforeCreate, _getConditions} = require('../model-utilities/reports/report-utilities');

module.exports = {
  attributes: {
    name: {
      type: 'string',
      required: true
    },

    user: {
      model: 'user'
    },

    node: {
      model: 'nodeschema',
      required: true
    },

    global: {
      type: 'boolean',
      defaultsTo: false
    },

    defaultReport: {
      type: 'boolean',
      defaultsTo: false
    },

    report: {
      type: 'json',
      required: true
    },

    domain: {
      model: 'domain'
    },

    meta: {
      type: 'json'
    },

    tags: {
      collection: 'tag'
    }
  },

  over: {
    duration: 'comparative',
    decimal: 'comparative',
    integer: 'comparative',
    variable: 'self',
    json: 'self'
  },

  /**
   * @description Combines like attributes for reporting used for reporting
   * @param {string} type - the type pulling
   * @returns {string}
   */
  combinelike: _combinelike,

  /**
   * @description Aggregates params based on their type
   *
   * @param {Object} report - the report
   * @param {String} attr - the attribute name
   * @param {String} action - the action to take
   * @param {Object} type - the holding obj to copy
   * @param {Object} send - the object to push to
   * @returns {void} Mutates the [send] parameter.
   */
  setAggregates: _setAggregates,

  /**
   * @description Combines like attributes for reporting
   * used for reporting
   *
   * @param {Object} type - the params obj
   */
  buildReport: _buildReport,

  /**
   * @description Used to pull the reporting for the report type
   * @param {Object} report - the report
   * @returns {Array}
   */
  getReportParams: _getReportParams,

  /**
   * querySet
   * 
   * @description entry to reporting once node has created the where query
   *
   * @param {Object} params - the report details
   * @param {String} schema - the node type
   * @param {String} query - the knex query object
   */
  querySet: _querySet,

  beforeCreate: _beforeCreate,

  getConditions: _getConditions
};
