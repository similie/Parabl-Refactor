/**
 * EWS.js
 *
 * @description :: TODO: You might write a short summary of how this model works and what it represents here.
 * @docs        :: http://sailsjs.org/documentation/concepts/models-and-orm/models
 */

const { TimeUtils, CommonUtils } = require('similie-api-services');
const {
  DeviceActions
} = require('../model-utilities/early-warning/devices/deviceactions');
const {
  EwsActionUtils
} = require('../model-utilities/early-warning/ews/ews-action-utils');
const SailsExtensions = require('../services/SailsExtensions');
const {
  EarlyWarningSubscription
} = require('../model-utilities/early-warning/early-warning-subscriptions');
const TimePeriod = TimeUtils.constants.ENUMS.timePeriods;
const now_ = TimeUtils.constants.now_;
const delayTime =
  process.env.NODE_ENV === 'test' ? TimePeriod.seconds : TimePeriod.minutes;

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    early_warning: {
      type: 'integer'
    },

    event_category: {
      type: 'string',
      in: ['earlywarning', 'eventcluster'],
      defaultsTo: 'earlywarning'
    },

    device: {
      model: 'device'
    },

    target: {
      type: 'integer'
    },

    triggered_time: {
      type: 'datetime'
    },

    triggered_count: {
      type: 'integer',
      defaultsTo: 0
    },

    actions: {
      type: 'array'
      // in: ['sms', 'email', 'delete', 'copy', 'move']
    },

    domain: {
      type: 'integer'
    },

    expired: {
      type: 'boolean',
      defaultsTo: false
    },

    trigger_values: {
      type: 'json'
    },

    perform: {
      type: 'boolean',
      defaultsTo: false
    },

    burned: {
      type: 'boolean',
      defaultsTo: false
    }
  },

  readyEvent: function(values) {
    return !values.expired && values.perform;
  },

  processAction: function(ews) {
    if (!this.readyEvent(ews)) {
      return;
    }
    const params = { ews: ews };
    return EWS.ewsActions(params);
  },

  afterUpdate: async function(values, next) {
    await this.processAction(values);
    next();
  },

  beforeCreate: async function(values, next) {
    await EWS.update(
      {
        early_warning: values.early_warning,
        event_category: values.event_category,
        target: values.target,
        domain: values.domain,
        device: values.device
      },
      {
        expired: true
      }
    );
    next();
  },

  /**
   * @name setTriggerTime
   * @description ensures our trigger time has been set
   * @param {ews} ews
   * @param {earlywarning} earlywarning
   */
  setTriggerTime(ews, earlywarning) {
    ews.triggered_time = TimeUtils.isoFormattedDate(now_);
    earlywarning.last_triggered = ews.triggered_time;
  },

  setEarlywarningTriggers: function(earlywarning, target) {
    const eUtils = new EwsActionUtils();
    const schema = earlywarning.node;
    const params = earlywarning.parameters;
    return eUtils.fetchEarlyWarningTriggers(schema, target, params);
  },

  testTriggers: async function(earlywarning, ews, station) {
    const eUtils = new EwsActionUtils();
    if (
      ews.event_category === EwsActionUtils.EWEventCategory.EventCluster ||
      !eUtils.isActionableStation(station)
    ) {
      return;
    }
    const triggers = await this.setEarlywarningTriggers(
      earlywarning,
      ews.target
    );
    if (triggers) ews.trigger_values = triggers;
  },

  jobRunner: function(name, ...params) {
    if (Site.isInTestMode()) {
      return;
    }
    Jobs[name].add(...params);
  },

  jobSwitchActions: function(earlywarning, ews, station, data) {
    const eUtils = new EwsActionUtils();
    return async (key, action) => {
      switch (key) {
        case 'no_action':
          break;
        case 'sms':
          await eUtils.addJobsForAudience(
            'phone',
            action,
            earlywarning,
            ews,
            station
          );
          break;
        case 'email':
          await eUtils.addJobsForAudience(
            'email',
            action,
            earlywarning,
            ews,
            station
          );
          break;
        case 'machine':
          this.jobRunner('ewsMachines', { context: data, ew: earlywarning });
          break;
        case 'machine_break':
          this.jobRunner('ewsMachinesUntil', {
            context: data,
            ew: earlywarning
          });
          break;
        case 'node':
          this.jobRunner('ewsNodes', {
            context: data,
            ew: earlywarning
          });
          break;
        case 'wo':
          this.jobRunner('ewsWorkOrder', {
            data,
            ew: earlywarning
          });
          break;
        case 'po':
          this.jobRunner('ewsPurchaseOrder', {
            data,
            ew: earlywarning
          });
          break;
        case 'report':
          await EventBatchList.addToEventBatchList(earlywarning, ews);
          break;
        default:
      }
    };
  },

  applyActions: async function(earlywarning, ews, station, data) {
    const actions = earlywarning.actions;
    const switchActions = this.jobSwitchActions(
      earlywarning,
      ews,
      station,
      data
    );
    for (const key in actions) {
      const action = actions[key];
      if (!_.size(action) || !action.active) {
        continue;
      }
      await switchActions(key, action);
    }
    try {
      const ewSubscriptions = new EarlyWarningSubscription(earlywarning, ews);
      ewSubscriptions.station = station;
      await ewSubscriptions.process();
    } catch (e) {
      sails.log.error('EWS.applyActions.subscriptions', e.message);
    }
  },

  sendEventBroadcast: function(earlywarning, ews) {
    if (earlywarning.automatic || earlywarning.passive) {
      return;
    }
    const dId = Domain.getId(earlywarning.domain) || 'default';
    sails.sockets.blast(`early-warning-event-detection-${dId}`, {
      ews: ews,
      ew: earlywarning
    });
  },

  saveEwChanges: async function(
    earlywarning,
    category = EwsActionUtils.EWEventCategory.EarlyWarning
  ) {
    await sails.models[category].saveAsync(earlywarning);
  },

  completeEws: async function(ews) {
    ews.expired = true;
    await EWS.saveAsync(new EWS._model(ews));
  },

  ewsActions: async function(data) {
    if (!(data && data.ews)) return;
    const eUtils = new EwsActionUtils();
    const ews = data.ews;
    const ew = await eUtils.fetchEarlyWarningCategoryModel(ews);
    if (!ew) return;
    const station = await eUtils.fetchStationFromEarlyWarningCategoryModel(ew);
    if (!station) return;

    await this.testTriggers(ew, ews, station);
    this.setTriggerTime(ews, ew);
    await this.saveEwChanges(ew, ews.event_category);
    await this.completeEws(ews);

    if (eUtils.isActionableStation(ew.station)) {
      ew.station = await Station.findOneById(Station.getId(ew.station));
    }

    if (!Site.isInTestMode()) {
      this.sendEventBroadcast(ew, ews);
    }

    await this.applyActions(ew, ews, station, data);
  },

  /**
   * @name isAfter
   * @description checks to see if the event is within the timout threshold
   * @param {earlywarning} earlywarning
   * @returns {boolean}
   */
  isAfter: function(earlywarning) {
    /**
     * @summary [sg] Note.
     * TimeUtils doesn't have a granularity function for 'isAfter' so the
     * calculations below are done manually by converting to seconds and
     * comparing the two values: 'now' and 'last_triggered'. If there is
     * a further need for granularity in isAfter or isBefore, refactor this
     * code backout into TimeUtils and add the relevant tests with the moment
     * implementation as the expected result.
     *
     * const thresholdTime = moment().tz(tz).subtract(timeout, delayTime);
     * const isAfter = moment(ew.last_triggered).tz(tz).isAfter(thresholdTime, "second");
     */
    let threshold = 0;
    let triggered = 0;
    const timeout = earlywarning.timeout || 0;
    threshold = TimeUtils.date(now_).minus(timeout, delayTime).toMillis;
    threshold = Math.trunc(threshold / 1e3); // convert to base seconds
    triggered = TimeUtils.date(earlywarning.last_triggered).toMillis;
    triggered = Math.trunc(triggered / 1e3); // convert to base seconds
    const isAfter = threshold - triggered < 0;
    return isAfter;
  },

  eventProcessor: async function(data) {
    const earlyWarnings = data.ews || [];
    const node = _.isArray(data.node) ? data.node[0] : data.node;
    const domain = data.domain;
    const category =
      data.category || EwsActionUtils.EWEventCategory.EarlyWarning;
    const clusters = [];
    const limit = earlyWarnings.length;
    const eUtils = new EwsActionUtils();

    for (let i = 0; i < limit; i++) {
      const earlyWarning = earlyWarnings[i];
      const isAfter = this.isAfter(earlyWarning);
      if (earlyWarning.timeout && earlyWarning.last_triggered && isAfter)
        continue;

      const forgiveness = earlyWarning.forgive_count || 0;
      const ews = await eUtils.findOrCreateEWSModel(
        earlyWarning,
        category,
        delayTime,
        domain
      );
      ews.target = this.getId(node);
      ews.triggered_count++;
      if (ews.triggered_count > forgiveness) {
        ews.perform = true;
        clusters.push({ ...ews });
      }
      await this.saveAsync(ews);
      await EventBroadcast.generate(ews, earlyWarning, node);
    }
    return clusters;
  },

  setLocals: function(data) {
    const ewUtils = new EwsActionUtils();
    const ew = data.ew;
    const config = data.config;
    const params = ew.parameters;
    const ew_values = data.node;
    const locals = {
      STATION: ewUtils.getStationName(data),
      SITE: config.site_name,
      EVENT_NAME: ew.name,
      // for compatibility @deprecated
      site_name: config.site_name,
      host: CommonUtils.pullHost(config)
    };

    ewUtils.pullThresholdValues(params, locals);
    ewUtils.pullSchemaValues(ew_values, locals);
    ewUtils.pullSpecialValues(data, locals);
    return locals;
  },

  _processors: [
    {
      name: 'ewsWorkOrder',
      process: function(_job, cb) {
        sails.log.debug('THIS IS THE WORK ORDER JOB');
        cb();
      },

      stats: SailsExtensions.stats({
        completed: function() {
          // noop
        },
        failed: function(_job, err) {
          console.error('EWS WORK ORDER ERROR::', err);
        }
      })
    },

    {
      name: 'ewsPurchaseOrder',
      process: function(_job, cb) {
        // ToDo: Job for PurchaseOrder
        sails.log.debug('THIS IS THE PURCHASE ORDER JOB');
        cb();
      },

      stats: SailsExtensions.stats({
        completed: function() {
          // noop
        },
        failed: function(_job, err) {
          console.error('EWS PURCHASE ORDER ERROR::', err);
        }
      })
    },

    {
      name: 'ewsNodes',
      process: function(job, cb) {
        const data = job.data;
        const actions = _.clone(((data.ew || {}).actions || {}).node);
        const _schema = data.ew.node;
        const schema = NodeSchema.findOneById(NodeSchema.getId(_schema));
        const context = data.context.ews;
        const original_id = context.target;

        const copy_node = function(go) {
          Node.findOneById(original_id, schema)
            .then(function(node) {
              if (!node || !_.size(node)) {
                go('errors.NO_NODE_FOUND');
              }

              return node;
            })
            .then(function(node) {
              const clone = _.clone(node);
              const o_id = _.isObject(node.observer)
                ? node.observer.id
                : node.observer;
              delete clone.id;
              delete clone.createdAt;
              delete clone.updatedAt;

              async.forEach(
                actions.targets,
                function(target, next) {
                  const c = _.clone(clone);
                  const t_id = _.isObject(target) ? target.id : target;
                  c.station = t_id;
                  c.observer = o_id;
                  c.scannable_id = Node.createToken();
                  Node.save(c, schema)
                    .then(SailsExtensions.passiveCallback(next))
                    .catch(SailsExtensions.errorLog(next));
                },
                go
              );
            });
        };

        if (!actions) {
          return cb();
        }

        switch (actions.do) {
          case 'move':
            copy_node(function(err) {
              if (err) return SailsExtensions.errorLog(cb)(err);
              Node.destroy({ id: original_id }, schema)
                .then(SailsExtensions.passiveCallback(cb))
                .catch(SailsExtensions.errorLog(cb));
            });
            break;
          case 'copy':
            copy_node(cb);
            break;
          case 'delete':
            Node.destroy({ id: original_id }, schema)
              .then(SailsExtensions.passiveCallback(cb))
              .catch(SailsExtensions.errorLog(cb));
            break;
          case 'create':
            // @TODO
            break;
          case 'alter':
            // @TODO
            break;
          default:
            return cb();
        }
      },

      stats: SailsExtensions.stats({
        completed: function() {
          // noop
        },
        failed: function(job, err) {
          console.error('EWS MACHINE UNTIL::', err);
        }
      })
    },

    {
      name: 'ewsMachinesUntil',
      process: async function(job) {
        const data = job.data;
        const id = EarlyWarning.getId(data.ew);
        const ew = await EarlyWarning.findOneById(id);
        if (!ew) {
          return ew;
        }

        const da = await Device.doAction(ew, true, data.context.ews.domain);
        if (!da) {
          throw new Error('Device Action Not Generated');
        }
        const destroyed = await EarlyWarning.destroy({
          id: id
        });
        return destroyed;
      },

      stats: SailsExtensions.stats({
        completed: function() {
          // noop
        },
        failed: function(_job, err) {
          console.error('EWS MACHINE UNTIL::', err);
        }
      })
    },

    {
      name: 'ewsMachinesTimeout',
      process: async function(job) {
        const data = job.data;
        const id = EarlyWarning.getId(data);
        try {
          const ew = await EarlyWarning.findOneById(id);
          if (!ew) {
            return null;
          }
          const da = await Device.doAction(ew, true, data.domain);
          if (!da) {
            return null;
          }

          await EarlyWarning.destroy({
            id: id
          });

          return da;
        } catch (e) {
          sails.log.error(e);
          return null;
        }
      },
      stats: SailsExtensions.stats({
        completed: function() {
          // noop
        },
        failed: function(_job, err) {
          console.error('EWS MACINE ERROR::', err);
        }
      })
    },

    {
      name: 'ewsMachines',
      process: async function(job) {
        const data = job.data;
        const aEw = EarlyWarning.cloneForAuto(data.ew);
        const actions = DeviceActions.getMachineActions(data.ew);
        const domain = data.context.ews.domain;
        const da = await Device.doAction(data.ew, false, domain);
        if (!da) {
          return null;
        }
        const ew = await EarlyWarning.create(aEw);
        if (actions.timeout && ew) {
          Jobs.ewsMachinesTimeout.add(
            {
              id: EarlyWarning.getId(ew),
              domain: Domain.getId(domain)
            },
            { delay: actions.timeout * 1000 }
          );
        }
        return da;
      },

      stats: SailsExtensions.stats({
        completed: function() {
          // noop
        },
        failed: function(_job, err) {
          console.error('EWS MACHINE ERROR::', err);
        }
      })
    },

    {
      name: 'ewsEMAIL',
      process: async function(job) {
        const data = job.data;
        const audience = data.audience || [];
        const ew = data.ew;
        const config = data.config;
        const defaultEMAIL =
          '%NAME%, %SITE% has detected that a warning has been triggered at "%STATION%"';
        const message = ew.actions.email || {};
        const l = EWS.setLocals(data);
        for (let i = 0; i < audience.length; i++) {
          const member = audience[i];
          const _loc = {
            ...l
          };
          _loc.NAME = member.name;
          _loc.EMAIL = member.email;
          _loc.PHONE = member.phone;
          _loc.body = message[member.language] || message.en || defaultEMAIL;
          Jobs.sendEmail.add({
            to: {
              address: _.clone(member.email),
              name: _.clone(member.name)
            },
            subject: message.subject || '',
            locals: _loc,
            default_language:
              member.language || config.default_language || 'en',
            template: 'ews',
            variables: Email.variables.ews.key,
            tags: ['early warning alert', 'parabl', 'events']
          });
        }
      },

      stats: SailsExtensions.stats({
        completed: function() {
          // noop
        },
        failed: function(_job, err) {
          console.error('EWS SMS ERROR::', err);
        }
      })
    },

    {
      name: 'ewsPHONE',
      process: async function(job) {
        const data = job.data;
        const audience = data.audience || [];
        const ew = data.ew;
        const defaultSMS =
          '%NAME%, %SITE% has detected that a warning has been triggered at %STATION%';
        const message = ew.actions.sms;
        const l = EWS.setLocals(data);
        const sendValues = [];
        for (let i = 0; i < audience.length; i++) {
          const member = audience[i];
          const _loc = {
            ...l
          };
          _loc.NAME = member.name;
          _loc.EMAIL = member.email;
          _loc.PHONE = member.phone;
          const messageText =
            message[member.language] || message.en || defaultSMS;
          const formattedMessage = CommonUtils.parseLocals(messageText, _loc);
          try {
            const sent = await Sms.send(
              member.phone,
              formattedMessage,
              ew.node,
              ew.device
            );
            const value = Array.isArray(sent) ? sent : [sent];
            sendValues.push(...value);
          } catch (e) {
            sails.log.error('ewsPHONE ERROR::', e.message);
          }
        }
        return sendValues;
      },

      stats: SailsExtensions.stats({
        completed: function(_job, results) {
          return Sms.sendValidation(results);
        },
        failed: function(_job, err) {
          console.error('EWS SMS ERROR::', err);
        }
      })
    },

    {
      name: 'ewsActions',
      process: async function(job) {
        const data = job.data;
        return await EWS.ewsActions(data);
      },

      stats: SailsExtensions.stats({
        completed: function() {
          // noop
        },
        failed: function(_job, err) {
          console.error('EWS ACTION ERROR:::', err);
        }
      })
    },

    {
      name: 'processEarlyWarnings',
      process: async function(job) {
        return await EWS.eventProcessor(job.data);
      },

      stats: SailsExtensions.stats({
        completed: function() {
          // noop
        },
        failed: function(_job, err) {
          console.error('PROCESS EARLY WARNING ERROR::', err);
        }
      })
    }
  ]
};
