const cron = require('node-cron');
const { TimeUtils } = require('similie-api-services');
const now_ = TimeUtils.constants.now_;
const tz = TimeUtils.constants.timeZone;
/*
 * Our timers allow us to build an api for timed functions
 */
module.exports = class SystemTimers {
  static timerTemplate(action, name, interval = Const.timers.THIRTY_MINUTE) {
    return {
      interval: interval,
      name: name,
      action: function(sails) {
        return {
          do: function() {
            return action(sails);
          }
        };
      }
    };
  }

  get models() {
    return sails.models;
  }

  comparator(interval, span) {
    const dateNow = TimeUtils.date(now_).tz(tz);
    const now = new Date(dateNow.toISO);
    let compare = -1;
    switch (interval) {
      case 'monthly':
        compare = now.getMonth() + 1;
        break;
      case 'weekly':
        // There is no weekly option. Not going to create a protype since it is never used
        break;
      case 'daily':
        // Monday is 0
        compare = now.getUTCDate();
        break;
      case 'hour':
        compare = now.getHours();
        break;
      case 'minute':
        compare = now.getMinutes();
        break;
    }
    return compare % span === 0;
  }

  intervalSplit(timer, value) {
    const split = timer.interval.split(' ');
    const interval = split[1] || '';
    if (split.length !== 2 || interval.trim() !== value) {
      return false;
    }
    const span = parseInt(split[0]);
    if (isNaN(span)) {
      return false;
    }
    return {
      span,
      interval
    };
  }

  buildCustom(timer = {}, value) {
    const intervalSpan = this.intervalSplit(timer, value);
    if (!intervalSpan) {
      return intervalSpan;
    }
    return this.comparator(intervalSpan.interval, intervalSpan.span);
  }

  async applyRunners(runners = []) {
    for (const run of runners) {
      if (!run) {
        continue;
      }
      await run.action(sails).do();
    }
  }

  buildRunners(value) {
    const run = [];
    for (const key in this.models) {
      const model = this.models[key];
      if (!model._timers) {
        continue;
      }
      for (const timer of model._timers) {
        if (timer.interval === value) {
          run.push(timer);
        } else if (this.buildCustom(timer, value)) {
          run.push(timer);
        }
      }
    }
    return run;
  }

  runner(value) {
    return () => {
      const runners = this.buildRunners(value);
      this.applyRunners(runners);
    };
  }

  static get scheduleArray() {
    return [
      { cron: '*/1 * * * *', value: 'minute' },
      { cron: '0 */1 * * *', value: 'hour' },
      { cron: '1 0 */1 * *', value: 'daily' },
      { cron: '2 0 */7 * *', value: 'weekly' },
      { cron: '3 0 * */1 *', value: 'monthly' }
    ];
  }

  static get schedule() {
    const schedule = {};
    for (const val of SystemTimers.scheduleArray) {
      schedule[val.value] = val.cron;
    }
    return schedule;
  }

  static setSchedule() {
    if (!Site.isProcessMaster()) {
      return;
    }
    const schedules = SystemTimers.scheduleArray;
    const systemTimers = new SystemTimers();
    for (const schedule of schedules) {
      cron.schedule(
        schedule.cron,
        systemTimers.runner(schedule.value).bind(systemTimers)
      );
    }
  }
};
