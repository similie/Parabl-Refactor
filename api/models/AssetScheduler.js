/**
 * AssetSchedulers.js
 *
 * @description :: A model definition represents a database table/collection.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */
// @TODO: Refactor to CommonUtils in similie-api-services module
const Utils = require('../services/Utils');

const { TimeUtils } = require('similie-api-services');
const TimePeriod = TimeUtils.constants.ENUMS.timePeriods;
const now_ = TimeUtils.constants.now_;

module.exports = {
  attributes: {
    /*
     * This parameter is the name field
     */
    title: {
      type: 'string'
    },
    /*
     * The type of entity we are adding to
     */
    model: {
      type: 'string',
      in: ['user', 'station', 'node'],
      defaultsTo: 'node'
    },

    /*
     * The integer id value of the the schema type that's been
     * definied above, UserSchema, NodeSchema, StationSchema
     */
    schema: {
      type: 'integer'
    },

    /*
     * The saved event
     */
    verb: {
      type: 'string',
      in: ['on', 'every']
    },

    /*
     * The station id, if there is one
     * where the element has been assinged. My not be required, but
     * will help with query reduction
     */
    station: {
      model: 'station'
    },

    /*
     * The integer id value of the actual model instance that
     * the scheduler is assigned to
     */
    target: {
      type: 'integer'
    },
    /*
     * The job id, that get's started to manage the schedules. We will need a cron job
     * to check this value periodically to make sure it is still active
     */
    job: {
      type: 'integer'
    },
    /*
     * The event timestamp for when it will trigger
     */
    every: {
      type: 'integer'
    },

    /*
     * What job action will it perform
     */
    action: {
      type: 'string',
      in: ['sms', 'wo', 'po', 'iot', 'email', 'node']
    },
    /*
     * Is it still active
     */
    active: {
      defaultsTo: true,
      type: 'boolean'
    },
    until_type: {
      type: 'string',
      in: ['date', 'times', 'forever'],
      defaultsTo: 'date'
    },
    // unix timestamp or count. Anything greater than today is considered a valid timestamp
    until: {
      type: 'integer'
    },
    /*
     * A collection of scheduledevets that have occurred
     */
    events: {
      collection: 'scheduledevents'
    },
    last_triggered_at: {
      type: 'integer'
    },
    triggered_count: {
      type: 'integer',
      defaultsTo: 0
    },
    // anthing else
    meta: {
      type: 'json'
    }
  },

  afterCreate: function(values, next) {
    sails.log.debug('Scheduler.afterCreate::', values);
    const target = values.every * 1000;
    const secondsDelay = TimeUtils.date(now_).difference(target).inSeconds;

    if (values.verb === 'on') {
      sails.log.debug(
        'const myjob = await someAction.add({foo: bar}, {delay: time})'
      );
      Jobs.schedulerInitiations.add({ data: values }, { delay: secondsDelay });
    } else {
      sails.log.debug(
        'const myjob = await someAction.add({foo: bar}, {delay: time}, repeat: {every: 1000, limit: 10})'
      );
      Jobs.schedulerInitiations.add(
        { data: values },
        {
          delay: secondsDelay,
          repeat: {
            every: 1000,
            limit: 10
          }
        }
      );
    }
    next();
  },

  afterUpdate: function(values, next) {
    sails.log.debug('Scheduler.afterUpdate::', values);
    next();
  },

  afterDestory: function(values, next) {
    sails.log.debug('Scheduler.afterDestory::', values);
    next();
  },

  _processors: [
    {
      name: 'schedulerInitiations',
      process: async function(job) {
        sails.log.debug(' :: Starting Scheduler');
        const verb = job.verb;
        if (verb === 'on') {
          sails.log.debug('Scheduler for on');
        } else if (verb === 'every') {
          sails.log.debug('Scheduler for every');
        }
      },

      stats: Utils.stats({
        completed: function(job, result) {
          sails.log.debug(' :: ScheduledEvents from Scheduler');
        },
        failed: function(job, err) {
          sails.log.debug('JOB schedulerInitiations ERROR::', err);
        },
        stalled: function(job) {
          sails.log.debug('STALL', job);
        }
      })
    },
    {
      name: 'schedulerInitiator',
      process: async function(job) {
        sails.log.debug(' ::Starting Scheduler Initiator');
        const mins = 9;
        // [sg] let current = moment().tz(tz);
        const justNow = TimeUtils.date(now_).subtract(mins, TimePeriod.minutes);
        const foundOn = await AssetScheduler.find().where({
          verb: 'on'
        });
        // let foundOn = await Model.queryAsync(queryForOn);
        const schedulerOnPools = foundOn;
        sails.log.debug(':: scheduler on pools', foundOn.length);

        let schedulerPool = null;
        let onDate = null;
        const limit = _.size(schedulerOnPools);
        for (let i = 0; i < limit; i++) {
          schedulerPool = schedulerOnPools[i];
          // [sg] onDate = moment(new Date(schedulerPool.every * 1000)).tz(tz);
          onDate = TimeUtils.date(schedulerPool.every * 1000);
          const find = await ScheduledEvents.find({
            job: job.id
          });
          // The Scheduler doesn't exist
          if (onDate < justNow) {
            await AssetScheduler.destroy({
              id: schedulerPool.id
            });
            await ScheduledEvents.update({ job: job.id }, { complete: true });
            continue;
          }
          // The Scheduler exists
          if (schedulerPool.active && !find) {
            const scheduledEventForOn = await ScheduledEvents.create({
              verb: 'on',
              scheduler: schedulerPool,
              job: job.id,
              complete: false
            });

            const eventsForOn = schedulerPool.events
              ? schedulerPool.events
              : [];
            eventsForOn.push(scheduledEventForOn);
            await schedulerPool.update({
              events: eventsForOn
            });
          }
        }

        // Every Scheduler
        const foundEvery = await AssetScheduler.find().where({
          verb: 'every'
        });
        // let foundEvery = await Model.queryAsync(queryForEvery);
        const schedulerEveryPools = foundEvery;
        sails.log.debug(':: scheduler every pools', foundEvery.length);
        // [sg] inline function 'isEnableTrigger' moved to private functions.

        for (let j = 0; j < _.size(schedulerEveryPools); j++) {
          const everyPool = schedulerEveryPools[j];
          const findEvery = await ScheduledEvents.find({
            job: job.id
          });
          // The Scheduler is expired
          const everyDate = null; // @moses: this was never instantiated. Please review
          if (everyPool.until_type === 'date' && everyDate < justNow) {
            await AssetScheduler.destroy({
              id: everyPool.id
            });
            await ScheduledEvents.update({ job: job.id }, { complete: true });
            continue;
          }
          // The Scheduler isn't expired yet
          if (everyPool.active && !findEvery) {
            const scheduledEventForEvery = await ScheduledEvents.create({
              verb: 'every',
              scheduler: everyPool,
              job: job.id,
              complete: false
            });

            const eventsForEvery = everyPool.events ? everyPool.events : [];
            eventsForEvery.push(scheduledEventForEvery);
            await everyPool.update({ events: eventsForEvery });
          }
        }
      },

      stats: Utils.stats({
        completed: function(job, result) {
          sails.log.debug(' :: ScheduledEvents from Scheduler');
        },
        failed: function(job, err) {
          sails.log.debug('JOB schedulerInitiator ERROR::', err);
        },
        stalled: function(job) {
          sails.log.debug('STALL', job);
        }
      })
    }
  ],

  _timers: [
    // {
    //   interval: Const.timers.FIVE_MINUTE,
    //   name: "scheduler_initiator",
    //   action: function(sails) {
    //     var _this = this;
    //     return {
    //       do: function() {
    //         // add a delay of 10 minutes
    //         // for scheduler to work
    //         // Jobs.schedulerInitiator.add();
    //       }
    //     };
    //   }
    // }
  ]
};

/** @summary Private functions */

/**
 * @description Removed from [initiators] above, no evidence it was ever called
 * but refactored and preserved here for future reference.
 * @param {*} triggered_at
 * @param {*} now
 * @param {*} scheduler
 * @returns
 */
const isEnableTrigger = function(triggered_at, now, scheduler) {
  if (!triggered_at) return true;

  const rightNow = TimeUtils.date(now);
  const lastTriggered = TimeUtils.date(scheduler.last_triggered_at * 1000);
  const dateDifference = rightNow.difference(lastTriggered);
  let diff = 0;

  let limit = 60 * 24 * 365;
  if (scheduler.every >= limit) {
    diff = dateDifference.inYears + 1;
    return diff >= Math.floor(scheduler.every / limit);
  }

  limit = 60 * 24 * 30;
  if (scheduler.every >= limit) {
    diff = dateDifference.inMonths + 1;
    return diff >= Math.floor(scheduler.every / limit);
  }

  limit = 60 * 24;
  if (scheduler.every >= limit) {
    diff = dateDifference.inDays + 1;
    return diff >= Math.floor(scheduler.every / limit);
  }

  limit = 60;
  if (scheduler.every >= limit) {
    diff = dateDifference.inHours + 1;
    return diff >= Math.floor(scheduler.every / limit);
  }

  if (scheduler.every >= 1) {
    diff = dateDifference.inMinutes + 1;
    return diff >= scheduler.every;
  }

  return false;
};
