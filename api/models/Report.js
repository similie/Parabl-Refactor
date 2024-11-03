/**
 * Report.js
 *
 * @description :: TODO: You might write a short summary of how this model works and what it represents here.
 * @docs        :: http://sailsjs.org/documentation/concepts/models-and-orm/models
 */
const Q = require('q');
const a_sync = require('async');
const _lo = require('lodash');
const escape = require('pg-escape');

const { TimeUtils, CommonUtils } = require('similie-api-services');
const tz = TimeUtils.constants.timeZone;
const TimePeriod = TimeUtils.constants.ENUMS.timePeriods;
const toDecimalTime = TimeUtils.constants.formats.Time.MinsSecs.asDecimal;
/**
 * used in ->getConditions->getInject to set a zero value for: min, sum & avg.
 * and as a filter in the subsequent table select using 'coalesce(f, 0) > 0'
 * Set this param to false to not use floor conditions in those sql statements.
 * @todo - add to configurable options for this query.
 */
const useMinFloorValue = true;

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
  combinelike: function(type) {
    const like = {
      decimal: 'numbers',
      integer: 'numbers',
      variables: 'variables',
      json: 'json',
      disaggregator: 'json'
    };

    return like[type];
  },

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
  setAggregates: function(report, attr, action, hold, send) {
    const type = report.type;
    send.data = send.data || {};
    const like = (Report.combinelike[action] || _.noop)(type);
    send.data[like] = [];
    const agregate = report.agregate;
    switch (agregate) {
      case 'value':
        send.data[like].push(hold[attr]);
        break;
      case 'count':
    }
  },

  /**
   * @description Combines like attributes for reporting
   * used for reporting
   *
   * @param {Object} type - the params obj
   */
  buildReport: function(report) {
    return function(rows) {
      const hold = {};
      const send = {};
      _.each(Report.getReportParams(report), function(param) {
        hold[param] = _.pluck(rows, param);
      });

      const action = ((report || {}).report || {}).action;

      _.each(report.report.links, function(r, attr) {
        Report.setAggregates(r, attr, action, hold, send);
      });

      return hold;
    };
  },

  /**
   * @description Used to pull the reporting for the report type
   * @param {Object} report - the report
   * @returns {Array}
   */
  getReportParams: function(report) {
    const params = []; // ['id', 'updatedAt', 'createdAt'];

    _.each(report.report.links, function(r, key) {
      params.push(key);
    });

    return params;
  },

  /*
   * querySet
   *
   * entry to reporting once node has created the where query
   *
   * @param {Object} params - the report details
   * @param {String} schema - the node type
   * @param {String} query - the knex query object
   */

  querySet: function(params, schema, query, language) {
    const deferred = Q.defer();
    const conditions = Report.getConditions(params, schema, query, language);
    conditions(function(err, elements) {
      if (err) {
        deferred.reject(err);
      }

      deferred.resolve(elements);
    });
    return deferred.promise;
  },

  beforeCreate: async function(values, next) {
    if (!values.defaultReport) {
      return next();
    }
    const defaultReports = await Report.find().where({
      user: values.user,
      node: values.node,
      defaultReport: true
    });

    for (let i = 0; i < defaultReports.length; i++) {
      const report = defaultReports[i];
      report.defaultReport = false;
      await Report.saveAsync(report);
    }
    next();
  },

  getConditions: function(params, schema, query, language) {
    const elements = {};
    const knex = sails.models.knex;

    const getJson = function(agregate) {
      return function(param, cb) {
        elements[param] = {};
        elements[param].data = [];
        elements[param].labels = [];
        elements[param].agregate = agregate;

        const s = _.where(schema.schema, { name: param });

        if (!_.size(s)) {
          elements.injected = false;
          return cb();
        }

        const sData = s[0];
        const sParam = sData.select_options;
        if (!_.size(sParam)) {
          elements.injected = false;
          return cb();
        }

        let q;
        if (sData.type === 'disaggregator') {
          q = escape(
            'json_data.key as key, sum(value::numeric)::INT As j_data_val',
            param,
            param,
            sData.label
          );
          query.joinRaw(
            knex.raw(escape(',jsonb_each_text("%s") As json_data', param))
          );
          // query.where(knex.raw(escape('value = \'true\'')))
        } else {
          q = escape(
            'json_data.key as key, count(*)::INT As j_data_count',
            param,
            param,
            sData.label
          );
          query.joinRaw(
            knex.raw(escape(',jsonb_each_text("%s") As json_data', param))
          );
          query.where(knex.raw(escape("value = 'true'")));
        }

        query.groupByRaw(knex.raw(escape('%s', 1)));
        // query.debug();
        query.select(knex.raw(q)).then(function(rows) {
          let total = 0;
          const simplify = {};
          _.each(rows, function(r) {
            total += r.j_data_count || r.j_data_val || 0;
            simplify[r.key] = simplify[r.key] || 0;
            simplify[r.key] += r.j_data_count || r.j_data_val || 0;
          });
          if (sData.type === 'disaggregator') {
            const unknown = {
              select_text: { en: 'Unknown' },
              name: '__unknown__'
            };
            sParam.push(unknown);
          }
          _.each(sParam, function(s) {
            const name = s.name;
            const label = s.select_text;
            const hold = {};
            const tf = simplify[name];
            if (tf != null) {
              elements[param].labels.push(label);
              // var cFalse = tf[false] || 0;
              // hold.count = tf[true] || 0;
              hold.count = tf || 0;
              // ((multiple) ? counts.total : rows.length) || 1; //counts.total || 1;//cFalse + cTrue;
              hold.percent = Math.round((hold.count / total) * 100, 2); // Math.round((hold.count / total) * 100);
              elements[param].data.push(hold[agregate]);
            }
          });
          cb();
        });
      };
    };

    const agregateSpecial = function(type) {
      const specials = {
        duration: function(data) {
          return TimeUtils.minutesFromMilliseconds(data, toDecimalTime);
        }
      };

      const noop = function(data) {
        return Utils.fixValue(data);
      };

      return specials[type] || noop;
    };

    const getInject = function() {
      return function(cb, col, params) {
        if (!params) {
          elements.injected = false;
          return cb();
        }

        col = col || {};

        const seletedParam = _.clone(params || schema.schema);
        const GRAPH_CEILING = 500;
        const injected = {
          data: [],
          labels: [],
          series: [],
          agregates: {}
        };
        const targets = [];
        const selectedCol = col.name || 'updatedAt';
        const selectedLabel = col.label || 'labels.RECENTLY_UPDATED';
        const row_query = `ROW_NUMBER ( ) OVER (ORDER BY "${selectedCol}" ASC ) AS "__row__"`;
        const sLabels = {
          sum: 'labels.SUM',
          avg: 'labels.AVERAGE',
          min: 'labels.MIN',
          max: 'labels.MAX'
        };
        const filteredOutcomes = ['labels.SUM', 'labels.AVERAGE'];
        const maxDraw = 31;
        let time = false;
        let has_time = true;
        const paramSize = _.size(params);
        let selectedLabelCol = selectedLabel.replaceAll('.', '$^$');
        const colType = col.type;
        const preconvert = function(rows, targets) {
          _.each(targets, function(t) {
            const type = t.type;
            switch (type) {
              case 'money':
                const preserve = _.cloneDeep(rows);
                const groups = _lo.groupBy(rows, 'currency');
                rows.length = 0;
                const keys = _.sortBy(_.keys(groups));
                injected.labels = _.unique(injected.labels);
                let altered_labels;
                if (_.contains(injected.labels[0], 'labels.')) {
                  altered_labels = [];
                  _.each(injected.labels, function(l) {
                    altered_labels.push(Const.months.byLabel(l));
                  });
                } else {
                  altered_labels = _.clone(injected.labels);
                }

                _.each(keys, function(key) {
                  const g = groups[key];
                  const hold = [];
                  _.each(altered_labels, function(label) {
                    const q = {};
                    q[selectedLabelCol] = label;
                    const found = [];
                    let stashed = false;
                    // local constiables for the each(g) iterator
                    let isSameDay = false;
                    let rowLabel = false;
                    let stringLabel = false;
                    _.each(g, function(r) {
                      stringLabel = _.isString(label);
                      rowLabel = r[selectedLabelCol];
                      isSameDay = TimeUtils.date(rowLabel)
                        .hasSame(TimePeriod.days)
                        .as(label);

                      if ((stringLabel && isSameDay) || rowLabel == label) {
                        found.push(r);
                      } else if (!stashed) {
                        // we are going to make a null candidate
                        // so we can fill empty cols
                        stashed = true;

                        _.each(_.keys(r), function(k) {
                          if (k != selectedLabelCol && k == t.label) {
                            q[k] = 0;
                          } else {
                            q[k] = r[key] || 0;
                          }
                        });
                      }
                    });

                    if (_.size(found)) {
                      _.each(found, function(f) {
                        hold.push(f);
                      });
                    } else {
                      hold.push(q);
                    }
                  });
                  rows.push(hold);
                });
                rows.push(preserve);
                break;
            }
          });
        };
        const specialSeries = function(series, rows, targets) {
          _.each(targets, function(t) {
            const type = t.type;

            switch (type) {
              case 'money':
                // const groups = _lo.groupBy(rows, "currency");
                // const keys_ = _.sortBy(_.keys(groups));
                const seriesHold = _.clone(series);
                series.length = 0;
                const keys = [];
                for (let i = 0; i < _.size(rows) - 1; i++) {
                  const r = rows[i];
                  const first = '';
                  _.each(r, function(look) {
                    if (look.currency) {
                      first = look.currency;
                      return;
                    }
                  });

                  keys.push(first);
                }
                _.each(seriesHold, function(s) {
                  if (_.contains(s, t.label)) {
                    _.each(keys, function(key) {
                      const splice = '(' + key + ') ' + s;
                      series.push(splice);
                    });
                  } else {
                    series.push(s);
                  }
                });
                break;
            }
          });
        };
        const specialConversions = function(row, type) {
          switch (type) {
            case 'duration':
              _.each(row, function(val, i) {
                row[i] = TimeUtils.minutesFromMilliseconds(val, toDecimalTime);
              });
              break;
            default:
              _.each(row, function(val, i) {
                row[i] = Utils.fixValue(val);
              });
          }
        };
        const seriesLabels = function(filler, targets, settlements) {
          const consolidateRows = function(rows, target, on) {
            const copy = []; // /_.clone(rows);
            const label = target.label;
            const groups = _lo.groupBy(rows, on);

            _.each(groups, function(grp, key) {
              const stuff = {};
              stuff[on] = key;
              stuff[label] = 0;
              _.each(grp, function(g) {
                if (_.isNumber(g[label])) {
                  stuff[label] += g[label];
                }
              });
              copy.push(stuff);
            });

            return copy;
          };

          const getValues = function(data, rows, label, type, specials) {
            const check = rows[0];
            if (_.isArray(check)) {
              const safe = rows[rows.length - 1];

              switch (type) {
                case 'money':
                  _.each(rows, function(row, i) {
                    if (_.isArray(row) && i < rows.length - 1) {
                      const r = _.pluck(row, label);
                      specialConversions(r, type);
                      data.push(r);
                    }
                  });

                  break;

                default:
                  if (!specials) {
                    const values = _.pluck(safe, label);
                    specialConversions(values, type);
                    data.push(values);
                  } else if (specials) {
                    specialConversions(specials, type);
                    data.push(specials);
                  }
              }
            } else if (!specials) {
              const values = _.pluck(rows, label);
              specialConversions(values, type);
              data.push(values);
            } else if (specials) {
              specialConversions(specials, type);
              data.push(specials);
            }
          };

          const searchStretch = function(sample, rows, month) {
            const find = {};
            find[selectedLabelCol] = month;
            sample = sample || [];
            // let's search our rows
            _.each(rows, function(row, index) {
              // if we are working with the array element, then we need
              // to process the array
              if (_.isArray(row)) {
                // because we stuff the original rows at the end
                if (index < _.size(rows) - 1) {
                  // we iterate the row,
                  _.each(row, function(r) {
                    if (find[selectedLabelCol] == r[selectedLabelCol]) {
                      sample.push(r);
                    }
                  });
                }
              } else {
                // we save when we find
                if (find[selectedLabelCol] == row[selectedLabelCol]) {
                  sample.push(row);
                }
              }
            });
          };

          const def = function() {
            return function(rows) {
              const data = [];
              const series = [];
              preconvert(rows, targets);

              const eccentric = _.isArray(rows[0]);

              _.each(targets, function(t) {
                if (eccentric) {
                  const label = t.label;
                  series.push(label);
                  const labelValues = _.unique(injected.labels);
                  const hold = [];
                  _.each(labelValues, function(lv) {
                    const sample = [];
                    let search;
                    if (t.type == 'money') {
                      search = rows;
                    } else {
                      search = consolidateRows(
                        rows[rows.length - 1],
                        t,
                        selectedLabelCol
                      );
                    }

                    searchStretch(sample, search, lv);
                    if (_.size(sample)) {
                      _.each(sample, function(s) {
                        const data = s[label] || 0;
                        hold.push(data);
                      });
                    } else {
                      hold.push(null);
                    }
                  });

                  getValues(data, rows, label, t.type, hold);
                } else {
                  _.each(filteredOutcomes, function(val) {
                    const label = val + t.q_label;
                    series.push(label);
                    getValues(data, rows, label, t.type);
                  });
                }
              });

              specialSeries(series, rows, targets);

              return {
                data: data,
                series: series
              };
            };
          };

          const take = {
            day: {
              labels: function(labels) {
                const start = _.min(_.pluck(settlements, 'min_date'));
                // var start_day = parseInt(labels[0]);
                const dates = [start];
                const limit = _.size(labels);
                const startDate = TimeUtils.date(start);
                for (let i = 1; i < limit; i++) {
                  const next_dayInt = parseInt(labels[i]); // - start_day;
                  const dt = startDate.set(TimePeriod.days, next_dayInt);
                  dates.push(dt.toISO);
                }
                return TimeUtils.reportFormattedDateArray(dates, false);
              },
              fill: def()
            },
            week: {
              labels: function(labels) {
                const start = _.min(_.pluck(settlements, 'min_date'));
                const start_week = parseInt(labels[0]);
                const dates = [start];
                const limit = _.size(labels);
                const dt = TimeUtils.date(start);
                let next_weekInt, next_week;
                for (let i = 1; i < limit; i++) {
                  next_weekInt = parseInt(labels[i]) - start_week;
                  next_week = dt.plus(next_weekInt, TimePeriod.weeks).toISO;
                  dates.push(next_week);
                }
                return TimeUtils.reportFormattedDateArray(dates, false);
              },
              fill: def()
            },
            variable: {
              labels: (ids, varCache) => {
                const labels = [];

                _.each(ids, id => {
                  const value = ((varCache[id] || {}).value || {})[
                    language || 'en'
                  ];
                  const label = CommonUtils.truncateText(value, 30);
                  labels.push(label);
                });
                _.remove(labels, r => r == null);
                return labels;
              },
              fill: rows => {
                const data = [];
                const series = [];
                if (_.size(targets) === 1) {
                  const t = targets[0];
                  series.push(t.label);
                  data.push(..._.pluck(rows, t.label));
                } else {
                  _.each(targets, t => {
                    series.push(t.label);
                    data.push(_.pluck(rows, t.label));
                  });
                }
                return {
                  data: data,
                  series: series
                };
              }
            },
            month: {
              labels: function() {
                const dates_min = _.min(_.pluck(settlements, 'min_date'));
                let month = TimeUtils.monthOfDate(dates_min);
                const hold = [];

                _.times(12, function() {
                  hold.push(Const.months.byInteger(month));
                  month = month == 12 ? 1 : ++month;
                });

                return hold;
              },
              fill: function(rows) {
                const data = [];
                const series = [];
                preconvert(rows, targets);
                const eccentric = _.isArray(rows[0]);

                const dates_min = _.min(_.pluck(settlements, 'min_date'));

                let month = TimeUtils.monthOfDate(dates_min);

                _.each(targets, function(t) {
                  if (eccentric) {
                    const label = t.label;
                    series.push(label);
                    const hold = [];

                    _.times(12, function() {
                      const sample = [];
                      // index + 1 to represent month starting at 1
                      let search;
                      // var month  =  (i + 1);
                      if (t.type === 'money') {
                        search = rows;
                      } else {
                        search = consolidateRows(
                          rows[rows.length - 1],
                          t,
                          selectedLabelCol
                        );
                      }

                      searchStretch(sample, search, month);
                      if (_.size(sample)) {
                        // hold.push(sample.pop());
                        _.each(sample, function(s) {
                          const data = s[label] || 0;
                          hold.push(data);
                        });
                      } else {
                        hold.push(null);
                      }

                      month = month == 12 ? 1 : ++month;
                    });

                    getValues(data, rows, label, t.type, hold);
                  } else {
                    _.each(filteredOutcomes, function(val) {
                      const label = val + t.q_label;
                      series.push(label);
                      const hold = [];
                      _.times(12, function() {
                        const sample = [];
                        searchStretch(sample, rows, month);
                        if (_.size(sample)) {
                          _.each(sample, function(s) {
                            const data = s[label] || 0;
                            hold.push(data);
                          });
                        } else {
                          hold.push(null);
                        }

                        if (month == 12) {
                          month = 1;
                        } else {
                          month++;
                        }
                      });

                      getValues(data, rows, label, t.type, hold);
                    });
                  }
                });

                specialSeries(series, rows, targets);

                return {
                  data: data,
                  series: series
                };
              }
            },
            year: {
              labels: function(labels) {
                return labels;
              },
              fill: def()
            }
          };

          return (
            take[filler] || {
              labels: function(labels) {
                // [SG]return Time.formatDates(labels, time);
                return TimeUtils.reportFormattedDateArray(labels, time);
              },
              fill: function(rows) {
                const data = [];
                const series = [];

                preconvert(rows, targets);

                _.each(targets, function(t) {
                  const label = t.label;
                  series.push(label);
                  getValues(data, rows, label, t.type);
                });

                specialSeries(series, rows, targets);

                return {
                  data: data,
                  series: series
                };
              }
            }
          );
        };

        const dataExtraction = query.clone();
        const split = selectedCol.split('.');
        let addSplit;
        const max = parseInt(process.env.GRAPH_CEILING || GRAPH_CEILING);
        const divisor = count => {
          return Math.ceil(count / max);
        };

        let extractedColName = '"' + split[0] + '"';
        // we want to be able to search an n number object
        for (let i = 1; i < _.size(split); i++) {
          extractedColName += "->>'" + split[i] + "'";
        }

        let q;
        switch (colType) {
          case 'date':
            q =
              "MIN((%s)::TIMESTAMP WITH TIME ZONE AT TIME ZONE '%s') as min_date, MAX((%s)::TIMESTAMP WITH TIME ZONE AT TIME ZONE '%s') as max_date, count(*) as total";
            break;
          case 'variable':
            q = 'count(*) as total';
        }

        _.each(seletedParam, function(s) {
          let l = '_' + (s.label || '').toUpperCase();
          let name = '"' + s.name + '"';
          // here we select for the special cases
          if (s.type === 'duration') {
            has_time = true;
            l += ' (MINS)';
            name = '(' + name + '->>' + "'duration')::NUMERIC";
            query.where(knex.raw(escape('%s > 0', name)));
          } else if (s.type === 'calculator') {
            name = '(' + name + '->>' + "'val')::NUMERIC";
          } else if (s.type === 'money') {
            const holdName = name;
            name = '(' + name + '->>' + "'value')::NUMERIC";
            const selector = escape("(%s->>'currency')::TEXT", holdName);
            query.select(knex.raw(selector + ' AS "currency"'));
            query.groupByRaw(1);
            query.orderBy('currency');
            addSplit = {
              name: 'currency',
              selector: selector,
              as: l
            };
            has_time = false;
          }

          if (useMinFloorValue === true) {
            /** Generic CASE statement to insert into subsequent statements */
            const caseSql = escape(
              'CASE WHEN %s < 0 THEN 0 ELSE %s END',
              name,
              name
            );

            q += escape(
              `, ROUND(AVG(${caseSql})::NUMERIC, 2)::NUMERIC as "%s"` +
                `, SUM(${caseSql})::NUMERIC as "%s"` +
                `, MIN(${caseSql})::NUMERIC as "%s"` +
                `, MAX(%s)::NUMERIC as "%s"`,
              sLabels.avg + l,
              sLabels.sum + l,
              sLabels.min + l,
              name,
              sLabels.max + l
            );
            query.where(knex.raw(escape('COALESCE(%s, 0) > 0', name)));
          } else {
            // continue with the previous processor
            q += escape(
              ', ROUND(AVG(%s)::NUMERIC, 2)::NUMERIC as "%s", SUM(%s)::NUMERIC as "%s", MIN(%s)::NUMERIC as "%s", MAX(%s)::NUMERIC as "%s"',
              name,
              sLabels.avg + l,
              name,
              sLabels.sum + l,
              name,
              sLabels.min + l,
              name,
              sLabels.max + l
            );
            query.where(knex.raw(escape('%s IS NOT NULL', name)));
          }

          const target = {
            name: s.name,
            q_label: l,
            c_name: name,
            type: s.type,
            label: s.label
          };

          if (_.size(addSplit)) {
            target.split = addSplit;
          }

          targets.push(target);
        });
        query.select(
          knex.raw(escape(q, extractedColName, tz, extractedColName, tz))
        );
        // query.debug();
        query
          .then(function(rows) {
            _.each(rows, function(row) {
              _.each(targets, function(t) {
                const agr = agregateSpecial(t.type);
                let label = t.label;

                if (_.size(t.split)) {
                  label = '(' + row[t.split.name] + ') ' + t.label;
                  // t.label = label;
                  injected.agregates[label] = injected.agregates[label] || [];
                  injected.agregates[label].push({
                    sum: agr(row[sLabels.sum + t.q_label]),
                    avg: agr(row[sLabels.avg + t.q_label]),
                    min: agr(row[sLabels.min + t.q_label]),
                    max: agr(row[sLabels.max + t.q_label])
                  });
                } else if (!injected.agregates[label]) {
                  injected.agregates[label] = [];
                  const sum = Utils.fixValue(
                    _.sum(_.pluck(rows, sLabels.sum + t.q_label)),
                    Const.DONT_ROUND
                  );
                  const avg = Utils.fixValue(
                    _.sum(_.pluck(rows, sLabels.avg + t.q_label)) /
                      (_.size(rows) || 1),
                    Const.DONT_ROUND
                  );
                  const min = _.min(_.pluck(rows, sLabels.min + t.q_label));
                  const max = _.max(_.pluck(rows, sLabels.max + t.q_label));
                  injected.agregates[label].push({
                    sum: agr(sum),
                    avg: agr(avg),
                    min: agr(min),
                    max: agr(max)
                  });
                }
              });
            });

            return rows;
          })
          .then(async function(settlements) {
            const total = parseInt((settlements[0] || {}).total || 0);
            const divisorCount = divisor(total);
            if (colType === 'variable') {
              const variables = await Variable.find({
                key: col.name
              });

              const varCache = {};
              _.each(variables, v => {
                varCache[v.id] = v;
              });
              let q = escape('"%s" as variable', selectedCol);
              _.each(targets, function(t) {
                q += escape(
                  ', COALESCE(SUM("%s"), 0 ) AS "%s"',
                  t.name,
                  t.label
                );
              });

              dataExtraction.select(knex.raw(q));
              dataExtraction.groupBy(selectedCol);
              dataExtraction.orderBy('variable');
              dataExtraction.where(
                knex.raw(escape('(%s) IS NOT NULL', selectedCol))
              );
              dataExtraction.then(async rows => {
                const transform = seriesLabels(
                  'variable',
                  targets,
                  settlements
                );
                injected.labels = transform.labels(
                  _.pluck(rows, 'variable'),
                  varCache
                );
                const parts = transform.fill(rows);
                injected.data = parts.data;
                injected.series = parts.series;
                elements.injected = injected;
                return cb();
              });
            } else {
              const dates_min = _.min(_.pluck(settlements, 'min_date'));
              const dates_max = _.max(_.pluck(settlements, 'max_date'));
              const counts = _.sum(_.pluck(settlements, 'total'));

              if (!counts) {
                elements.injected = injected;
                return cb();
              }

              const days = Math.abs(
                TimeUtils.date(dates_min).difference(dates_max).inDays
              );
              const count = counts;
              const paramCounts = count * paramSize;

              let q = '';
              const timeParm = extractedColName;
              let momentFunc = '';
              const hasTime = () => {
                if (has_time || (has_time == null && col.time)) {
                  time = true;
                }
              };
              // // we need a sample funcion
              if (paramCounts > maxDraw) {
                hasTime();
              } else if (paramCounts <= maxDraw) {
                // maintain status quo
                hasTime();
                selectedLabelCol += '_TOTAL';
              } else if (days > 1 && days < 7) {
                momentFunc = 'day';
                selectedLabelCol += '_DAY';
              } else if (days >= 7 && days < 29) {
                momentFunc = 'week';
                selectedLabelCol += '_WEEK';
              } else if (days >= 29 && days <= 365) {
                momentFunc = 'month';
                selectedLabelCol += '_MONTH';
              } else if (days > 365) {
                momentFunc = 'year';
                selectedLabelCol += '_YEAR';
              } else if (_.isNaN(days)) {
                hasTime();
              }

              if (momentFunc) {
                q += escape(
                  'EXTRACT(%s FROM ((%s)::TIMESTAMP WITH TIME ZONE AT TIME ZONE \'%s\')::DATE ) AS "%s"',
                  momentFunc,
                  timeParm,
                  tz,
                  selectedLabelCol
                );
                dataExtraction.groupByRaw(escape('%s', timeParm));
              } else {
                q += escape('%s AS "%s"', timeParm, selectedLabelCol);
              }

              const SETTLEMENT_SIZE = 1;
              if (_.size(settlements) > SETTLEMENT_SIZE) {
                _.each(targets, function(t) {
                  if (_.size(t.split)) {
                    q += escape(', %s AS "%s"', t.split.selector, t.split.name);
                    query.orderBy(t.split.name);
                    dataExtraction.groupByRaw(escape('"%s"', t.split.name));
                    if (!momentFunc) {
                      dataExtraction.groupByRaw(
                        escape('"%s"', selectedLabelCol)
                      );
                    }
                  }
                });
                // for now until I can test more
              }
              // this is likely to cause problems
              q += `, ${row_query}`;

              dataExtraction.orderBy(selectedLabelCol);
              dataExtraction.select(knex.raw(q));
              dataExtraction.where(
                knex.raw(escape('(%s) IS NOT NULL', timeParm))
              );

              _.each(targets, function(t) {
                let tq = '';
                if (momentFunc && _.size(settlements) <= 1) {
                  // [sg] TODO: refactor this averaging string to a function, also used elsewhere.
                  tq = escape(
                    'ROUND(AVG(%s)::NUMERIC, 2) as "%s", SUM(%s) as "%s", MIN(%s) as "%s", MAX(%s) as "%s"',
                    t.c_name,
                    sLabels.avg + t.q_label,
                    t.c_name,
                    sLabels.sum + t.q_label,
                    t.c_name,
                    sLabels.min + t.q_label,
                    t.c_name,
                    sLabels.max + t.q_label
                  );
                } else {
                  if (_.size(settlements) > SETTLEMENT_SIZE) {
                    tq = escape('SUM(%s) AS "%s"', t.c_name, t.label);
                  } else {
                    tq = escape('%s AS "%s"', t.c_name, t.label);
                  }
                }

                if (_.size(t.split)) {
                  tq += escape(`, %s AS  %s`, t.split.selector, t.split.name);
                }
                // here we can define specials
                if (t.type === 'duration') {
                  dataExtraction.where(knex.raw(escape('%s > 0', t.c_name)));
                }
                // [sg] I want to add 'field'>0 if we have useMinFloor = true
                // going to add when _.size(settlements) === SETTLEMENT_SIZE
                // since this is where I know the fields are added to 'select'
                if (
                  useMinFloorValue &&
                  _.size(settlements) === SETTLEMENT_SIZE /* needed?? */
                ) {
                  dataExtraction.andWhere(
                    knex.raw(escape('coalesce(%s, 0) > 0', t.c_name))
                  );
                }

                dataExtraction.select(knex.raw(tq));
              });

              const _q_ = `SELECT r.* FROM (${dataExtraction.toString()}) r WHERE r."__row__" % ${divisorCount} = 0 ;`;
              // dataExtraction.debug(true);
              // dataExtraction.then(function(rows) {
              Model.queryAsync(_q_).then(function(res) {
                const rows = res.rows;
                const transform = seriesLabels(
                  momentFunc,
                  targets,
                  settlements
                );
                injected.labels = transform.labels(
                  _.pluck(rows, selectedLabelCol)
                );
                const parts = transform.fill(rows);
                injected.data = parts.data;
                injected.series = parts.series;
                elements.injected = injected;

                cb();
              });
            }
          });
      };
    };

    const conditions = {
      inject: getInject(),
      realtime: function() {
        return function(cb) {
          cb();
        };
      },
      spanlike: function(cb) {
        const presents = params.presents;
        const bows = presents.bows;
        let p = [];
        let span = {};

        _.each(bows.links, function(link) {
          p = _lo.unionBy(p, [link], 'name');
        });
        /*
         * This should be updated for more than one if needed
         */

        _.each(bows.over, function(link) {
          span = link;
        });

        if (!_.size(p) || !_.size(span)) {
          elements.injected = false;
          return cb();
        }

        const inject = getInject();
        inject(cb, span, p);
      },

      combinelike: {
        json: {
          percent: getJson('percent'),
          count: getJson('count')
        },
        disaggregator: {
          percent: getJson('percent'),
          count: getJson('count')
        },

        variable: {
          count: function(param, cb) {
            query.groupBy(param);
            elements[param] = {};
            elements[param].data = [];
            elements[param].labels = [];
            elements[param].agregate = 'count';
            const countName = 'count_' + param;
            query.count(param + ' as ' + countName);
            query.where(knex.raw(escape('"%s" IS NOT NULL', param)));
            query.select(param).then(function(rows) {
              const ids = _.pluck(rows, param);
              Variable.find({ id: ids, key: param })
                .sort({ order: 'ASC' })
                .exec(function(err, variables) {
                  if (err) {
                    return cb(err);
                  }

                  _.each(sortByVariable(rows, variables, param), function(el) {
                    const varId = el[param];
                    if (varId) {
                      const variable = _.where(variables, { id: varId });
                      elements[param].labels.push(
                        ((variable || [])[0] || {}).identity || param
                      );
                      elements[param].data.push(el[countName]);
                    }
                  });

                  cb();
                });
            });
          },
          percent: function(param, cb) {
            query.groupBy(param);
            elements[param] = {};
            elements[param].data = [];
            elements[param].labels = [];
            elements[param].agregate = 'percent';

            const countName = 'percent_' + param;
            query.count(param + ' as ' + countName);
            query.where(knex.raw(escape('"%s" IS NOT NULL', param)));
            query
              .select(param)
              .then(function(rows) {
                const sum = _.sum(_.pluck(rows, countName)) || 1;
                const ids = _.pluck(rows, param);

                Variable.find({ id: ids, key: param })
                  .sort({ order: 'ASC' })
                  .exec(function(err, variables) {
                    if (err) {
                      return cb(err);
                    }
                    _.each(sortByVariable(rows, variables, param), function(
                      el
                    ) {
                      const varId = el[param];
                      if (varId) {
                        const variable = _.where(variables, { id: varId });

                        const label =
                          ((variable || [])[0] || {}).identity || param;
                        elements[param].labels.push(label);

                        try {
                          elements[param].data.push(
                            (el[countName] / sum) * 100
                          ); // Math.round((el[countName] / sum) * 100));
                        } catch (e) {
                          sails.log.error(e);
                        }
                      }
                    });

                    cb();
                  });
              })
              .catch(Utils.errorLog(cb));
          }
        }
      }
    };

    return function(cb) {
      const presents = params.presents;
      const bows = presents.bows;
      const action = bows.action;
      const condition = conditions[action];

      if (!condition) {
        return cb('error.NO_VALID_CONDITION');
      }

      if (_.isFunction(condition)) {
        return condition(function(err) {
          cb(err, elements);
        });
      }

      a_sync.forEachOf(
        bows.links,
        function(link, attr, cb) {
          if (!_.size(link)) {
            return cb();
          }
          const l = link || {};
          (
            ((condition || {})[l.type] || {})[l.agregate] ||
            function(attr, cb) {
              cb();
            }
          )(attr, function(err) {
            cb(err, elements);
          });
        },
        function(err) {
          if (err) {
            return cb(err);
          }
          cb(null, elements);
        }
      );
    };
  }
};

function sortByVariable(rows, variables, idName) {
  const filtered = [];
  idName = idName || 'id';
  _.each(variables, function(vari) {
    const q = {};
    q[idName] = vari.id;
    const row = _.where(rows, q);
    if (_.size(row)) {
      filtered.push(row.pop());
    }
  });

  return filtered;
}
