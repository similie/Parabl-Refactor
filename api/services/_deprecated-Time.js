const tz = process.env.TIME_ZONE || "Asia/Dili",
  moment = require("moment-timezone");

require("twix");

// /*
//  * Paserse time for the node utils
//  * @todo:: legaccy
//  */
// var parseFn = function(val) {
//   return val === null ? null : moment(val);
// };

// var TIMESTAMPTZ_OID = 1184;
// var TIMESTAMP_OID = 1114;

module.exports = {
  timeCategoryInDays: function(category) {
    const days = {
      years: 365,
      year: 365,
      months: 30,
      month: 30,
      weeks: 7,
      week: 7,
      days: 1,
      day: 1
    };

    return days[category] || 0;
  },

  getMoment: function(date) {
    return moment(date).tz(tz);
  },
  /*
   * defDateFormat
   *
   * Pulls the defult dates based on the time attr
   *
   * @param {Object|String} date - the date object
   * @param {Boolean} time - true if time
   * @return {String} - formatted time
   */
  defDateFormat: function(date, time) {
    var format = "ll";
    if (time) {
      //format = "lll";
      format = "MMM DD, YYYY HH:mm";
    }
    return moment(new Date(date))
      .tz(tz)
      .format(format);
  },

  /*
   * formatDates
   *
   * Takes and array of dates for formatting
   *
   * @param {Array} dateArr - the date array
   * @param {Boolean} time - true if time
   * @return {Array} - formatted time array
   */

  formatDates: function(dateArr, time) {
    var returnArr = [];
    _.each(dateArr, d => {
      var d_ate = moment(new Date(d));
      if (d && d_ate.isValid() && _.size(d.toString()) > 4) {
        returnArr.push(Time.defDateFormat(d, time));
      } else {
        returnArr.push(d);
      }
    });

    return returnArr;
  },

  /*
   * formatTime
   *
   * This function time array to
   *  an object
   *
   * @param {Array} time - thie array of time strings
   * @return {Object} - time array
   */

  formatTime: function(time) {
    var timeFormatted = {};
    _.each(time, (val, key) => {
      var v = val.toString();
      if (_.size(v) <= 1) {
        v = "0" + v;
      }
      timeFormatted[key] = v;
    });
    return timeFormatted;
  },

  /*
   * timeFromSeconds
   *
   * Builds a time object with
   * hour mins and seconds from seconds
   *
   * @param {Integer} seconds - seconds to convert
   * @return {Objext} {time, muinutes, seconds}
   */

  timeFromSeconds: function(seconds) {
    if (!seconds) {
      return {
        hours: 0,
        minutes: 0,
        seconds: 0
      };
    }

    var time = seconds;
    var t = {};
    t.hours = Math.floor(time / 3600);
    time -= t.hours * 3600;
    t.minutes = Math.floor(time / 60);
    time -= t.minutes * 60;
    t.seconds = parseInt(time % 60, 10);

    return t;
  },

  /*
   * secondsToMinutes
   *
   * Converts sends to minutes
   *
   * @param {Integer} seconds - seconds
   * @return {Float} minutes
   */

  secondsToMinutes: function(seconds) {
    var t = {};
    t.minutes = Math.floor(seconds / 60);
    seconds -= t.minutes * 60;
    t.seconds = parseInt(seconds % 60, 10);
    var time = this.formatTime(t);
    return parseFloat(time.minutes + "." + time.seconds, 10);
  },

  /*
   * milisToMins
   *
   * Converts minutes to miliseconds
   *
   * @param {Long} miliSeconds - miliSeconds
   * @return {Float} minutes
   */

  milisToMins: function(miliSeconds) {
    if (!miliSeconds) {
      return 0;
    }
    var seconds = miliSeconds / 1000;
    return this.secondsToMinutes(seconds).toFixed(2);
  },

  /*
   * miliToMinutes
   *
   * Converts minutes to miliseconds. Moment version
   *
   * @param {Long} miliSeconds - miliSeconds
   * @return {Float} minutes
   */

  miliToMinutes: function(miliSeconds) {
    var duration = moment.duration(miliSeconds);
    return moment.utc(duration.asMilliseconds()).format("mm:ss");
  },

  /*
   * miliToMinutes
   *
   * Converts minutes to miliseconds.
   *
   * @param {Integer} minutes - minutes
   * @return {Long} miliSeconds
   */
  minsToMilis: function(mins) {
    return mins * 60 * 1000;
  }
};
