/**
 * ReporttController
 *
 * @description :: Server-side logic for managing reportts
 * @help        :: See http://sailsjs.org/#!/documentation/concepts/Controllers
 */
const { TimeUtils } = require('similie-api-services');
const {
  StationReports
} = require('../model-utilities/station/station-reports');

module.exports = {
  deliver: function(req, res) {
    // [sg]var start_time = moment();
    const timer = new TimeUtils.PerformanceTimer(5);
    const language =
      req.session.language ||
      res.locals.siteData.default_language ||
      Translates.fallbackLanguage;
    let params = req.params.all();
    if (!params.query || !params.presents) {
      return res.badRequest('errors.QUERY_REQUIRES_ALL_PARMS');
    }

    if (_.isString(params)) {
      params = JSON.parse(params);
    }

    if (_.isString(params.presents)) {
      params.presents = JSON.parse(params.presents);
    }

    if (_.isString(params.query)) {
      params.query = JSON.parse(params.query);
    }

    const node = params.presents.node;
    const site = res.locals.siteData;

    NodeSchema.findOneById(node)
      .then(schema => {
        if (!schema || !_.size(schema)) {
          throw new Error('errors.INVALID_REPORT');
        }
        return schema;
      })
      .then(Node.nodeReports(params, site, language))
      // .then(Node.nodeReports(params))
      .then(rows => {
        // [sg] var end_time = moment();
        // [sg] var duration = moment.duration(end_time - start_time).asMilliseconds();
        const duration = timer.stop().milliseconds;
        sails.log.debug('REPORT DURATION', duration);
        // BASE TIME 53, 35, 25, 26 ms
        // 1063 Bar graph span over years 81 ms
        // 84624 Bar graph span over years 4240 ms
        // COST OF TOP AGGREGATES 326, 332
        res.send(rows);
      })
      .catch(why => {
        res.serverError(why.message);
      });

    // return res.send(params);
  },

  render: function(req, res) {
    const params = req.params.all();

    if (!params.id) {
      return res.badRequest('errors.QUERY_ID_REQUIRED');
    }

    /*
     * @TODO:: Put everything into sql queries. For now we
     * are to do things problematically
     */

    // Jobs.generateReport.add({
    //   user: req.user,
    //   report: params
    // });

    Node.report(req, res);
  },

  site: async function(req, res) {
    const params = req.params.all();
    // if we want a specific report
    let searchModels = {};
    try {
      searchModels = await StationReports.getModelsFromParams(params);
    } catch (e) {
      sails.log.error('ReportController.site::ERR', e);
      return res.badRequest({ error: e.message });
    }

    const dependents = {
      domain: res.locals.domain || null,
      user: req.user
    };

    const schemaTables = await StationReports.getTableReportValues(
      res.locals.domain
    );
    dependents.tables = schemaTables.tables;
    dependents.schema = schemaTables.schema;
    const send = [];
    for (const modelName in searchModels) {
      const model = searchModels[modelName];
      if (!_.isFunction(model.reports)) {
        continue;
      }
      try {
        const report = await model.reports(dependents);
        send.push(report);
      } catch (e) {
        sails.log.error('ReportController.site::ERR', e);
        continue;
      }
    }
    res.send(send);
  }
};
