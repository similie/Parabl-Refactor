/**
 * Model.js
 *
 * @description :: TODO: You might write a short summary of how this model works and what it represents here.
 * @docs        :: http://sailsjs.org/documentation/concepts/models-and-orm/models
 */

const { size } = require('lodash');
const plural = require('pluralize');
const { TimeUtils } = require('similie-api-services');
const {
  SQSCommManager
} = require('../model-utilities/external-comms/sqs-comm-manager');
const TimePeriod = TimeUtils.constants.ENUMS.timePeriods;
const tz = TimeUtils.constants.timeZone;
const now_ = TimeUtils.constants.now_;

module.exports = {
  attributes: {
    table: 'string',
    last_purge: 'datetime'
  },

  findModelNameFromReq: function(req) {
    const params = req.params.all();
    return (
      req.headers.model ||
      plural(params.model || '', 1) ||
      plural(params.__model || '', 1) ||
      req.options.model ||
      req.options.controller
    );
  },

  modelStreamListener: function() {
    return async cb => {
      const e = process.env;
      if (
        !e.AWS_QUEUE ||
        (e.NODE_ENV === 'development' && e.TEST_PROCESSOR !== 'fossil')
      ) {
        return cb();
      }

      const handler = async message => {
        if (e.TEST_PROCESSOR === 'fossil') {
          sails.log.debug('RECEIEVED ENTITY', message);
        }

        try {
          const res = JSON.parse(message.Body);
          if (Jobs[res.type]) {
            Jobs[res.type].add(res.results);
          }
        } catch (e) {
          sails.log.error(e);
        }
      };

      try {
        const sqsConmms = new SQSCommManager(true);
        const app = sqsConmms.createConsumer(e.AWS_QUEUE, handler);
        app.on('error', err => {
          sails.log.error(err.message);
        });
        app.on('processing_error', err => {
          sails.log.error(err.message);
        });
        app.on('timeout_error', err => {
          sails.log.error(err.message);
        });
        setTimeout(app.start, this.timeoutVal(1000 * 60 * 3));
      } catch {}

      cb();
    };
  },

  parentalGuidance: async function(model, seeds, parentParam) {
    const garbagePickup = cans => {
      for (let i = 0; i < _ > size(cans); i++) {
        const can = cans[i];
        _.remove(seeds, seed => {
          return seed._id_ === can._id_;
        });
      }
    };

    parentParam = parentParam || 'parent';
    const parentalMap = {};
    // getting top level
    const attr = model._attributes[parentParam];
    const isArray = attr.type === 'array';
    const detainees = [];
    _.each(seeds, s => {
      if (!s[parentParam] || (isArray && !_.size(s[parentParam]))) {
        detainees.push(s);
      }
    });

    garbagePickup(detainees);

    while (_.size(detainees)) {
      const detained = detainees.pop();
      const cuffs = detained._id_;
      const cell = [];
      for (let i = 0; i < _.size(seeds); i++) {
        const s = seeds[i];
        if (
          (isArray && _.contains(s[parentParam], cuffs)) ||
          s[parentParam] === cuffs
        ) {
          cell.push(s);
        }
      }

      garbagePickup(cell);
      detainees.push(...cell);
      delete detained._id_;

      const hasParents =
        (isArray && _.size(detained[parentParam])) ||
        (!isArray && !!detained[parentParam]);
      if (hasParents) {
        if (isArray) {
          const clone = _.clone(detained[parentParam]);
          detained[parentParam] = [];
          _.each(clone, p => {
            const warden = parentalMap[p];
            if (warden) {
              detained[parentParam].push(Model.getId(warden));
            } else {
              // we have no parent built. Edge case, would need to be solve for
              // complext data structures. For now we'll just live without it
            }
          });
        } else {
          const warden = parentalMap[detained[parentParam]];
          detained[parentParam] = Model.getId(warden);
        }
      }

      const unshakled = await model.create(detained);
      parentalMap[cuffs] = Model.getId(unshakled);
    }
  },

  parentTrap: function(req, res, parentParam) {
    const mods = [];
    const pk = 'id';
    return models => {
      _.each(models, m => {
        m._id_ = m[pk];
        delete m[pk];
        delete m.createdAt;
        delete m.updatedAt;
        if (m[parentParam]) {
          if (_.isArray(m[parentParam])) {
            const parents = [];
            _.each(m[parentParam], p => {
              parents.push(Model.getId(p));
            });
            m[parentParam] = parents;
          } else {
            m[parentParam] = Model.getId(m[parentParam]);
          }
        }
        mods.push(m);
      });
      res.send(mods);
    };
  },

  _processors: [
    {
      name: 'queueCleaner',
      process: async function(job) {
        const processors = Jobs._processors;
        // now we add model specific jobs to the processors
        // this is what we'll do when we create npm packaged jobs
        // for now we add it to the models
        _.each(sails.models, mod => {
          if (mod._processors) {
            _.each(mod._processors, process => {
              processors.push(process);
            });
          }
        });
        _.each(processors, process => {
          const name = process.name;
          // Jobs[name].clean(0, "stalled-check");
          Jobs[name].clean(0, 'completed');
          Jobs[name].clean(0, 'failed');
        });
      },
      stats: Utils.stats({
        completed: function(job, result) {
          sails.log.debug('All jobs cleared');
        },
        failed: function(job, err) {
          console.error('JOB queueCleaner ERROR::', err);
          // Utils.sendexcelMessage(err, job.data);
        },
        stalled: function(job) {
          sails.log.debug('JOB queueCleaner STALL::', job);
        }
      })
    },
    {
      name: 'tablePurge',
      process: async function(job) {
        const tables = job.data.tables;
        const days = {
          daily: 1,
          weekly: 7,
          monthly: 30,
          yearly: 365
        };

        const tableCreate = function(table) {
          const tableParts = table.split('.');
          return `CREATE TABLE IF NOT EXISTS "${tableParts[0]}"."${tableParts[1]}_bak" (LIKE "${tableParts[0]}"."${tableParts[1]}" INCLUDING ALL);`;
        };

        const tableCopy = function(table) {
          const tableParts = table.split('.');
          return `INSERT INTO "${tableParts[0]}"."${tableParts[1]}_bak" SELECT * FROM "${tableParts[0]}"."${tableParts[1]}" where "id" > COALESCE((SELECT "id" FROM "${tableParts[0]}"."${tableParts[1]}_bak" ORDER BY "id" DESC LIMIT 1), 0);`;
        };

        const tablePurge = function(table, interval, date) {
          const tableParts = table.split('.');
          const intervalParts = interval.split('.');
          return `DELETE FROM "${tableParts[0]}"."${
            tableParts[1]
          }" WHERE MOD(EXTRACT(minute FROM "${
            intervalParts[0]
          }"::TIMESTAMP WITH TIME ZONE)::INTEGER, ${
            intervalParts[1]
          }) <> ${0} AND  "alarm_states"::TEXT = '{}' AND "${
            intervalParts[0]
          }" < '${TimeUtils.isoFormattedDate(date)}';`;
          /*
            [sg] Replaced below date conversion with ISO formatted date.
            }" < '${SqlUtil.convertToDate(date, true)}';`;
          */
        };

        for (let i = 0; i < _.size(tables); i++) {
          const table = tables[i];
          const time = table.time;
          // [sg]const moment = Time.getMoment();
          // const date = moment.subtract(days[time], "days").format();
          const dt = TimeUtils.date(now_).tz(tz);
          const date = dt.minus(days[time], TimePeriod.days).toISO;
          /*
           * If a purge has occured then do nothing
           */
          const lastPurge = await Model.find({
            limit: 1,
            sort: {
              last_purge: 'DESC'
            }
          }).where({
            table: table.table,
            last_purge: {
              '>=': date
            }
          });

          if (_.size(lastPurge)) {
            continue;
          }

          const createQuery = tableCreate(table.table);
          const copyQuery = tableCopy(table.table);
          const purgeTable = tablePurge(table.table, table.interval, date);

          try {
            await Model.queryAsync(createQuery);
            await Model.queryAsync(copyQuery);
            const deleted = await Model.queryAsync(purgeTable);
            sails.log.debug('tablePurge:: Removed ', deleted.rowCount);
            await Model.create({
              table: table.table,
              last_purge: TimeUtils.isoFormattedDate(now_) // [SG]Time.getMoment().format()
            });
          } catch (e) {
            sails.log.error(e);
          }
        }

        return new Promise(function(resolve, reject) {
          resolve();
        });
      },

      stats: Utils.stats({
        completed: function(job, result) {
          // sails.log.debug('All Surveys managed');
        },
        failed: function(job, err) {
          console.error('JOB tablePurge ERROR::', err);
          // Utils.sendexcelMessage(err, job.data);
        },
        stalled: function(job) {
          sails.log.debug('JOB tablePurge STALL::', job);
        }
      })
    }
  ],

  _timers: [
    {
      interval: Const.timers.DAILY,
      name: 'queue_cleaner',
      action: function(sails) {
        return {
          do: function() {
            Jobs.queueCleaner.add();
          }
        };
      }
    },
    {
      interval: Const.timers.DAILY,
      name: 'table_purge',
      action: function(sails) {
        return {
          do: function() {
            // add a delay of 4 moniutes
            // for midnight to work
            if (process.env.TABLE_PURGE) {
              const tablesSplit = process.env.TABLE_PURGE.split(',');
              const tables = [];
              _.each(tablesSplit, t => {
                const elements = t.split(':');
                if (_.size(elements) === 3) {
                  const table = {
                    table: elements[0],
                    interval: elements[1],
                    time: elements[2]
                  };
                  tables.push(table);
                }
              });
              Jobs.tablePurge.add(
                {
                  tables: tables
                },
                {
                  removeOnComplete: true
                }
              );
            }
          }
        };
      }
    }
  ]
};
