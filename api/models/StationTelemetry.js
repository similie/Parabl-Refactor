/**
 * StationTelemetry.js
 *
 * @description :: A model definition represents a database table/collection.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */
// @TODO: Refactor to CommonUtils in similie-api-services module
const Utils = require('../services/Utils');

const { TimeUtils, SqlUtils } = require('similie-api-services');
const Format = TimeUtils.constants.formats;
const tz = TimeUtils.constants.timeZone;
const { Client } = require('@googlemaps/google-maps-services-js');

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    station: {
      required: true,
      model: 'station'
    },

    odometer: {
      type: 'integer',
      defaultsTo: 0,
      min: 0
    },

    humidity: {
      type: 'integer',
      defaultsTo: 0
    },

    temperature: {
      type: 'integer',
      defaultsTo: 0
    },

    fuel: {
      type: 'integer',
      defaultsTo: 0
    },

    alert: {
      type: 'boolean',
      defaultsTo: false
    },

    alert_params: {
      type: 'json'
    },

    geo: {
      type: 'text'
    },

    geo_snapped: {
      type: 'text'
    },

    session: {
      type: 'string'
    },

    start_session: {
      type: 'boolean',
      defaultsTo: false
    },

    end_session: {
      type: 'boolean',
      defaultsTo: false
    },

    type: {
      type: 'string',
      in: ['point', 'polygon', 'polyline'],
      defaultsTo: 'point'
    },

    word_address: {
      type: 'json'
    },

    // {"battery":65,"Lat":-8.572413445,"Lon":125.6151505,"gpsAccuracy":1.385999918,"fixQuality":1,"altitude":69.34200287}
    altitude: {
      type: 'float',
      defaultsTo: 0
    },
    quality: {
      type: 'integer',
      defaultsTo: 0,
      min: 0,
      max: 100
    },
    accuracy: {
      type: 'float',
      defaultsTo: 0
    },

    speed: {
      type: 'float'
    },

    battery: {
      type: 'integer',
      defaultsTo: 0,
      min: 0,
      max: 100
    },

    lifetime_disatance: {
      type: 'integer',
      defaultsTo: 0,
      min: 0
    },

    apply: async function(station, noWords) {
      const st = this.toObject();
      station.geo = st.geo;
      const simple = {
        geo: station.geo
      };
      if (noWords !== Geo.NO_WORDS && !StationTelemetry.DEBUG) {
        const points = await Geo.pullSimpleNode(simple);
        if (points && _.size(points[Geo.getGeoPoint()])) {
          const _point = points[Geo.getGeoPoint()];
          const words = await Geo.setWhat3Words(
            station,
            _point.latitude,
            _point.longitude
          );
          station.word_address = words;
        }
      }
      station.meta = station.meta || {};
      station.meta.ignore_geo_restrictions = true;

      let identity = '';
      if (!st.start_session && st.end_session) {
        identity = 'parked_state';
      } else if (st.start_session && !st.end_session) {
        identity = 'in_route_state';
      }

      if (identity) {
        await Station.setSpecialState(station, identity, true);
        // const variables = await Variable.find().where({
        //   key: 'station_state',
        //   identity: identity
        //   // domain: Domain.getId(station.domain)
        // });

        // if (_.size(variables)) {
        //   const variable = variables.pop();
        //   const category = (variable.meta || {}).category;
        //   const stationURL =
        //     (station.station_type || {}).station_url ||
        //     (
        //       (await StationSchema.findOneById(
        //         StationSchema.getId(station.station_type)
        //       )) || {}
        //     ).station_url;

        //   const catSplit = (category || '').split(',');
        //   if (_.indexOf(catSplit, stationURL) !== -1) {
        //     station.station_state = Variable.getId(variable);
        //   }
        // }
      }

      try {
        await Station.saveAsync(station);
      } catch (e) {
        console.error(e);
      }
      sails.sockets.blast('station-point-alteration', {
        id: Station.getId(station)
      });

      Jobs.checkForTelemetryActions.add(st);
    }
  },
  DEBUG: true,
  OPEN: 1,
  FINISHED: 2,
  checkViolator: function(threshold, value, operator) {
    let violated = false;

    switch (operator) {
      case '>':
        violated = value > threshold;
        break;
      case '<':
        violated = value < threshold;
        break;
      case '<=':
        violated = value <= threshold;
        break;
      case '>=':
        violated = value >= threshold;
        break;
      case 'between':
        violated = value >= threshold.from && value <= threshold.to;
        break;
      case '=':
        violated = threshold === value;
        break;
    }

    if (violated) {
      throw new Error(
        `Telemetry values ${value} violates threshold ${threshold} for ${operator}`
      );
    }
  },

  checkForMaintenance: async function(ta, station, tel, violations) {
    const restrictions = ta.action.maintenance;

    // Headline checks. The implication is that this is checking violations of
    // maintenance protocol. If there is no 'maintenance' key, there cannot be
    // a violation of a maintenance protocol. We exit leaving violations
    // unchanged if the key is not present on the input parameter.
    if (restrictions && Reflect.has(restrictions, 'active')) {
      if (!restrictions.active) return;
    } else return;

    const telemetry = await StationTelemetry.findOneById(
      StationTelemetry.getId(tel)
    );

    const setNow = async () => {
      ta.action.maintenance.last_event = telemetry.lifetime_disatance || 0;
      await TelemetryAction.saveAsync(ta);
    };

    if (!restrictions.last_event) {
      await setNow();
    }
    if (
      telemetry.lifetime_disatance - ta.action.maintenance.last_event >=
      restrictions.value * 1000
    ) {
      await setNow();
      violations.maintenance = {
        value: telemetry.lifetime_disatance,
        threshold: ta.action.maintenance.last_event,
        selector: restrictions.value,
        email: restrictions.email,
        sms: restrictions.sms
      };
    }
  },

  checkDailyRestrictions: function(restrictions, telemetry, violations) {
    if (!restrictions.active) return;

    /**
     * @summary inline function for returning a validator object. Note, mutates
     * the [violations] input paramter.
     * @param dateString {string} A date formatted in DateTime.verboseAmPm
     * @param daySelector {string} A lowercase day of the week e.g. 'monday'
     */
    const setValidator = (dateString, daySelector) => {
      violations.daily_restrict = {
        value: dateString,
        threshold: false,
        selector: daySelector,
        email: restrictions.email,
        sms: restrictions.sms
      };
    };

    /**
     * @description Takes a ':' separated time string, concatenates the two
     * parts and returns an integer representation of the resulting value.
     * @param value {string} A time formatted string e.g. 2:30
     * @returns {integer} A value representing the input time
     */
    const timeStringToInt = value => {
      let result = 0;

      if (value.indexOf(':') < 0) {
        throw new Error(`Telemetry validator expected a time value`);
      }

      const timeParts = (value || '').split(':');
      result = parseInt(`${timeParts[0]}${timeParts[1]}`);

      return result;
    };

    const dt = TimeUtils.date(telemetry.createdAt).tz(tz);
    const day = TimeUtils.keyNameForDayOfWeek(dt.dayOfWeek); // [sg]
    /*
    const moment = Time.getMoment(telemetry.createdAt);
    const dayKeys = [
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday"
    ];
    const dIndex = moment.weekday();
    const day = dayKeys[dIndex];
    */ const values =
      restrictions.days[day];
    if (!values.active) return;

    const dateFmt = dt.toFormat(Format.DateTime.verboseAmPm);
    if (!values.from) return setValidator(dateFmt, day);

    // [sg]const time = `${Utils.placeSecondZero(moment.hour() )}${Utils.placeSecondZero(moment.minute())}`;
    const hr = dt.hour.toString().padStart(2, '0');
    const min = dt.minute.toString().padStart(2, '0');
    const time = `${hr}${min}`; // [sg]

    /*
    const from = values.from;
    const to = values.to;
    const fromSplit = (from || "").split(":");
    const fromTime = parseInt(`${fromSplit[0]}${fromSplit[1]}`);
    const toSpit = (to || "").split(":");
    const toTime = parseInt(`${toSpit[0]}${toSpit[1]}`);
    */ const fromTime = timeStringToInt(
      values.from
    );
    if (time >= fromTime && !values.to) return setValidator(dateFmt, day);

    const toTime = timeStringToInt(values.to);
    if (time >= fromTime && time < toTime) return setValidator(dateFmt, day);
  },

  getAudience: async function(action, station) {
    const domain = Domain.getId(station.domain);
    const audience = action.audience;
    const rAudoence = [];
    const tAudience = [];
    if (_.size(audience.tags)) {
      const aud = await Tag.pullAudience(audience.tags, domain, true);
      if (_.size(aud)) {
        tAudience.push(...aud);
      }
    }

    if (_.size(audience.roles)) {
      tAudience.push(
        ...(await Requisition.pullAudience(station, audience.roles))
      );
    }
    const mergedAudience = User.mergeUserTypes([...tAudience, ...rAudoence]);
    return mergedAudience;
  },

  fallbackTemplates: function(key, hasDriver) {
    const tempates = {};
    const withDriver = hasDriver ? ` and driver "%vehicle_driver%" ` : ' ';
    const fallback = `%name%, vehicle %local_name% with registration "%registration_id%"${withDriver}violated a %action_key% threshold`;

    const fallback_maintenance = `%name%, vehicle %local_name% with registration "%registration_id%"${withDriver}crossed a %action_key% threshold for every %selector%km`;

    const no_boundary = ` with a value of %value%%metric%.`;
    const subject_fallback = `Trip Violation Report`;
    const maint_subject_fallback = `Asset Maintenance Report`;
    const dailyRestricted = ` on date, "%value%"`;
    switch (key) {
      case 'daily_restrict':
        tempates.subject = subject_fallback;
        tempates.body = fallback + dailyRestricted;
        break;
      case 'boundary':
        tempates.subject = subject_fallback;
        tempates.body = fallback_maintenance;
        break;
      case 'maintenance':
        tempates.subject = maint_subject_fallback;
        tempates.body = fallback_maintenance;
        break;
      default:
        tempates.subject = subject_fallback;
        tempates.body = fallback + no_boundary;
    }

    return tempates;
  },

  driverDebug: false,

  setMessageContent: function(params) {
    const metrics = {
      speed: 'km/h',
      temperature: ' degress celcius',
      humidity: '%',
      fuel: '%'
    };

    const action_keys = {
      speed: 'speed',
      temperature: 'temperature',
      humidity: 'humidity',
      boundary: 'boundary',
      maintenance: 'maintenance',
      daily_restrict: 'time restricted'
    };

    const user = params.user;
    const message = params.message;
    const station = params.station;
    const violated = params.violated;
    const driver = params.driver;
    const site = params.site;
    const key = params.key;

    const hasDriver = site.logistics && site.personnel_site && this.driverDebug;

    const fallback = this.fallbackTemplates(key, hasDriver);
    const mess = message.message[user.language] || fallback.body;
    const sub = message.subject[user.language] || fallback.subject;

    const locals = {
      ...station,
      name: user.name,
      vehicle_driver: driver,
      action_key: action_keys[key],
      value: violated.value,
      threshold: violated.threshold,
      selector: violated.selector,
      metric: metrics[key] || '',
      site_name: site.site_name
    };
    const findMessage = Utils.parseLocals(mess, locals);
    const subject = Utils.parseLocals(sub, locals);

    return {
      message: findMessage,
      subject: subject
    };
  },

  pullVaraibles: async function() {
    const identity_value = 'station_telemetry_violated_';
    const variable_name = 'station_telemetry_violation_message';
    const variable_subject = 'station_telemetry_violation_subject';
    const variable_subject_identity = 'station_telemetry_violation_subject';
    const findVars = {
      [variable_name]: [
        `${identity_value}speed`,
        `${identity_value}boundary`,
        `${identity_value}fuel`,
        `${identity_value}temperature`,
        `${identity_value}humidity`
      ]
    };

    const vars = await Variable.find().where({
      or: [
        { key: variable_name, identity: findVars[variable_name] },
        { key: variable_subject, identity: variable_subject_identity }
      ]
    });

    const variables = {};
    _.each(vars, v => {
      if (v.identity === variable_subject_identity) {
        variables[variable_subject_identity] = v.value;
      } else {
        variables[v.identity] = v.value;
      }
    });

    return function(key) {
      const message = (variables[`${identity_value}${key}`] || {}).value || {};
      const subject = variables[variable_subject_identity] || {} || {};
      return {
        message: message,
        subject: subject
      };
    };
  },

  checkBoundaries: async function(boudary, station, telemetry, violations) {
    if (!boudary.active) {
      return;
    }

    const included = await StationBoundary.included(station, telemetry);
    if (!included) {
      violations.boundary = {
        value: '',
        threshold: 'included',
        email: boudary.email,
        sms: boudary.sms
      };
    }

    const excluded = await StationBoundary.excluded(station, telemetry);
    if (!excluded) {
      violations.boundary = violations.boundary || {
        email: boudary.email,
        sms: boudary.sms
      };
      violations.boundary.value = 'excluded';
    }
  },

  checkForTelemetryActions: async function(telemetry) {
    Utils.itsRequired(telemetry)(Utils.setErrorCode(Const.code.BAD_REQUEST));
    const sId = Station.getId(telemetry.station);
    const station =
      _.isObject(telemetry.station) || (await Station.findOneById(sId));
    const ta = await TelemetryAction.findOne({ station: sId });
    if (!ta) {
      return;
    }

    const violations = {};
    _.each(ta.action, (v, key) => {
      if (v.active && telemetry[key] != null && v.value !== null) {
        try {
          this.checkViolator(v.value, telemetry[key], v.selector);
        } catch (e) {
          // sails.log.error(e);
          violations[key] = {
            value: telemetry[key],
            threshold: v.value,
            selector: v.selector,
            email: v.email,
            sms: v.sms
          };
        }
      }
    });

    this.checkDailyRestrictions(
      ta.action.daily_restrict,
      telemetry,
      violations
    );

    await this.checkBoundaries(
      ta.action.boundary,
      station,
      telemetry,
      violations
    );

    await this.checkForMaintenance(ta, station, telemetry, violations);

    if (!_.size(violations)) {
      return;
    }

    await StationTelemetry.update(
      { id: StationTelemetry.getId(telemetry) },
      {
        alert: true,
        alert_params: violations
      }
    );

    const audience = await this.getAudience(ta, station);
    const site = await Site.thisSiteAsync(station.domain);
    const session = telemetry.session;
    const language = site.default_language || Translates.fallbackLanguage;
    const driver = await Station.getDriver(station, language);
    const variables = await this.pullVaraibles();

    for (const key in violations) {
      const violated = violations[key];
      const te = await TelemetryEvent.findOne({
        session: session,
        action: key
      });

      if (te) {
        te.count = te.count || 0;
        // if we are greaterthan or less than increment
        // equal has no condition and will trigger the event
        if (
          !ta.forgiveness ||
          te.count < ta.forgiveness ||
          te.count > ta.forgiveness
        ) {
          te.count++;
          await TelemetryEvent.update(
            { id: TelemetryEvent.getId(te) },
            { count: te.count }
          );
          continue;
        }
      } else if (ta.forgiveness) {
        // create it with a 1 count because we just had our first event
        await TelemetryEvent.create({
          session: session,
          action: key,
          count: 1
        });
        continue;
      }

      const message = variables(key);

      if (violated.email) {
        const emailUsers = Utils.populateNotNullRecods(audience, 'email');
        for (let i = 0; i < _.size(emailUsers); i++) {
          const email = emailUsers[i];
          const sendMessage = this.setMessageContent({
            user: email,
            message: message,
            station: station,
            violated: violated,
            site: site,
            driver: driver,
            key: key
          });
          await Email.sendUserMessages(
            sendMessage.message,
            sendMessage.subject,
            email,
            station.domain
          );
        }
      }

      if (violated.sms) {
        const smsUsers = Utils.populateNotNullRecods(audience, 'phone');
        for (let i = 0; i < _.size(smsUsers); i++) {
          const sms = smsUsers[i];
          const sendMessage = this.setMessageContent({
            user: sms,
            message: message,
            station: station,
            violated: violated,
            site: site,
            driver: driver,
            key: key
          });
          Sms.send(sms.phone, sendMessage.message, null, null, station.domain);
        }
      }
      if (te) {
        await TelemetryEvent.update(
          { id: TelemetryEvent.getId(te) },
          { count: te.count + 1 }
        );
      } else {
        await TelemetryEvent.create({
          session: session,
          action: key,
          count: 1
        });
      }
    }
  },
  _processors: [
    {
      name: 'checkForTelemetryActions',
      process: async function(job) {
        const data = job.data;
        return StationTelemetry.checkForTelemetryActions(data);
      },

      stats: Utils.stats({
        completed: function() {
          // sails.log.debug('All Surveys managed');
        },
        failed: function(job, err) {
          console.error('JOB checkForTelemetryActions ERROR::', err);
          // Utils.sendexcelMessage(err, job.data);
        },
        stalled: function(job) {
          sails.log.debug('JOB checkForTelemetryActions STALL', job);
        }
      })
    },
    {
      name: 'roadSnapTrips',
      process: async function(job) {
        if (!process.env.GOOGLE_MAPS_API_KEY) {
          return;
        }

        const st = job.data;
        const client = new Client({});
        const session = st.session;
        const where = ` WHERE "session" = '${session}' `;

        try {
          const results = await Geo.pullPointsIntoArray(
            'stationtelemetry',
            where
          );

          const geo = results.geo;
          const map = {};
          const send = [];
          _.each(geo, (r, i) => {
            map[i] = r;
            send.push({
              lat: r.lat,
              lng: r.lng
            });
          });

          const snap = await client.snapToRoads({
            params: {
              path: send,
              key: process.env.GOOGLE_MAPS_API_KEY
            }
          });
          const escape = SqlUtils.escapeUtil();
          const snaps = (snap.data || {}).snappedPoints || [];
          for (let i = 0; i < _.size(snaps); i++) {
            const s = snaps[i];
            const index = s.originalIndex;
            const loc = s.location;
            const v = map[index];
            const lat = escape('%s', loc.latitude);
            const lng = escape('%s', loc.longitude);
            const query = escape(
              `UPDATE "stationtelemetry" SET "geo_snapped" = ST_SetSRID(ST_Point( ${lng}, ${lat}), 4326) WHERE id = %s;`,
              v.id
            );
            sails.log.debug(query);
            await Model.queryAsync(query);
          }
        } catch (e) {
          sails.log.error(e);
        }
      },

      stats: Utils.stats({
        completed: function() {
          // sails.log.debug('All Surveys managed');
        },
        failed: function(job, err) {
          console.error('JOB roadSnapTrips ERROR::', err);
          // Utils.sendexcelMessage(err, job.data);
        },
        stalled: function(job) {
          sails.log.debug('JOB roadSnapTrips STALL', job);
        }
      })
    }
  ],

  getLifeTimeDistanceUpdateQuery: function(values) {
    const id = StationTelemetry.getId(values);
    const vehicle = Station.getId(values.station);
    const escape = SqlUtils.escapeUtil();
    const query = escape(
      `UPDATE "stationtelemetry" SET "lifetime_disatance" = "life"."distance"
    FROM (SELECT  ST_Length ( ST_Transform (  ST_MakeLine ( "geo"  ORDER BY "createdAt" ASC, session  ) , 4326 ), TRUE ) as "distance" FROM "stationtelemetry" WHERE "station" = %s) "life"
    WHERE "stationtelemetry"."id" = %s;`,
      vehicle,
      id
    );
    return query;
  },

  afterCreate: async function(values, next) {
    if (!values.lifetime_disatance) {
      await StationTelemetry.queryAsync(
        this.getLifeTimeDistanceUpdateQuery(values)
      );
    }

    if (values.end_session && !Site.isInTestMode()) {
      Jobs.roadSnapTrips.add(values);
    }

    if (values.start_session || values.end_session) {
      const st = await StationTelemetry.findOneById(values.id);
      await Geo.geoBuildPoints([st], 'stationtelemetry');
      if (!Site.isInTestMode()) {
        sails.sockets.blast(
          `stationtelemetry-session-change-${Station.getId(st.station)}`,
          st
        );
      }
    }

    next();
  },

  findOpenSession: function(station) {
    return this.findSession(station, this.OPEN, 1);
  },

  findClosedSessions: function(station, limit, skip, whereString) {
    return this.findSession(station, this.FINISHED, limit, skip, whereString);
  },

  sessionFinder: function(count, station, limit, skip, where) {
    const escape = SqlUtils.escapeUtil();
    const query = `SELECT a."station", a."session" from (

      SELECT COUNT(s."session"), "station", "session", MIN(s."createdAt") as "start_time" from (

      SELECT * FROM "stationtelemetry" where (("start_session" = true and "end_session" = false OR "start_session" = false and "end_session" = true) AND "station" = %s) %s ORDER BY "createdAt" DESC

      ) s GROUP BY s."session", s."station" ORDER BY "start_time" DESC

      ) a WHERE count = %s  %s %s `;

    limit = limit || '';
    where = where || '';
    skip = skip || '';
    const out = escape(
      query,
      Station.getId(station),
      where,
      count,
      limit,
      skip
    );

    return out;
  },

  allSessions: async function(station, limit, count) {
    count = count || this.OPEN;
    const escape = SqlUtils.escapeUtil();
    const query = `
    Select * from "stationtelemetry" st JOIN,

    (${this.sessionFinder(station, count)}) sess

    ON (st."session" = sess."session") ORDER BY st."createdAt" DESC, st."session" %s;

    `;

    return escape(query, Station.getId(station), count, '', limit, '', '');
  },

  findSession: function(station, open, limit, skip, where) {
    open = open || this.OPEN;
    const escape = SqlUtils.escapeUtil();

    let limitAppend = '';

    if (limit) {
      limitAppend = escape('LIMIT %s', limit);
    }

    let skipAppend = '';

    if (skip) {
      skipAppend = escape('OFFSET %s', skip);
    }

    let whereAppend = '';

    if (_.size(where)) {
      const _where = SqlUtils.buildWhereString(where, true);
      whereAppend = `AND (${_where})`;
    }

    const query = this.sessionFinder(
      open,
      station,
      limitAppend,
      skipAppend,
      whereAppend
    );

    return new Promise((resolve, reject) => {
      StationTelemetry.query(query, (err, results) => {
        if (err) {
          return reject(err);
        }
        const rows = results.rows;
        if (open === this.OPEN) {
          return resolve(rows.pop());
        }
        resolve(rows);
      });
    });
  },

  applyStartSession: async function(values) {
    if (!values.start_session) {
      return;
    }
    values.session = await Tracker.findCodeBody('short');
    const lastSession = await StationTelemetry.find()
      .limit(1)
      .sort({ createdAt: 'DESC' });
    const last = lastSession.pop();
    // just in case we dodn't tag it
    if (last && !last.end_session) {
      last.end_session = true;
      const another = await StationTelemetry.find().where({
        session: last.session,
        end_session: true
      });

      if (!_.size(another)) {
        await StationTelemetry.saveAsync(last);
      } else {
        await StationTelemetry.saveAsync(last);
        _.each(another, async other => {
          other.end_session = false;
          await StationTelemetry.saveAsync(other);
        });
      }
    }
  },

  applyAvailableSession: async function(values) {
    const lastEvent = await StationTelemetry.findOpenSession(values.station);
    if (lastEvent) {
      values.start_session = false;
      values.session = lastEvent.session;
    } else {
      values.start_session = true;
      values.session = await Tracker.findCodeBody('short');
    }
  },

  beforeValidate: async function(values, next) {
    if (values.snapped || values.alert) {
      return next();
    }
    if (!values.session) {
      if (values.start_session) {
        await this.applyStartSession(values);
      } else {
        await this.applyAvailableSession(values);
      }
    }
    values.type = values.type || StationTelemetry._attributes.type.defaultsTo; // "point";
    await Geo.setGeoByType(values, values.type, Geo.NO_WORDS);
    next();
  },

  beforeCreate: async function(_, next) {
    next();
  }
};
