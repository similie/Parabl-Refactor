/**
 * BatchReport.js
 *
 * @description :: A model definition represents a database table/collection.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

const { Common } = require('../model-utilities/common/common');
const BullQueue = require('../services/BullQueue');
const SystemTimers = require('../services/SystemTimers');

const timerJobName = 'batchReportSchedule';
const batchActionProcessor = 'batchActionProcessor';
const { TimeUtils, CommonUtils } = require('similie-api-services');

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    name: 'string',
    description: 'string',
    body: 'text',

    category: {
      model: 'variable'
    },

    interval: {
      type: 'integer'
    },

    interval_type: {
      type: 'string',
      in: ['minute', 'hour', 'daily', 'weekly', 'monthly']
    },

    audience: {
      collection: 'user',
      through: 'batch_audience'
    },

    audience_tags: {
      collection: 'tag',
      through: 'batch_a_tag'
    },

    organizations: {
      collection: 'organization',
      through: 'batch_org'
    },

    roles: {
      type: 'array'
    },

    actions: {
      type: 'json'
    },

    tags: {
      collection: 'tag',
      through: 'batch_tag'
    },

    admin_audience: {
      type: 'boolean'
    },

    domain: {
      model: 'domain'
    },

    interval_job: {
      type: 'string'
    },

    task_time: {
      type: 'integer',
      defaultsTo: 0,
      min: 0,
      max: 23
    },

    last_triggered: {
      type: 'datetime'
    },

    active: {
      type: 'boolean'
    },

    empty_action: {
      type: 'string',
      in: ['fail', 'proceed'],
      defaultsTo: 'fail'
    },

    meta: {
      type: 'json'
    }
  },
  CRON_INDEX: {
    MINUTE: 0,
    HOUR: 1,
    DAY: 2,
    MONTH: 3,
    YEAR: 4
  },
  timerJobName: timerJobName,
  queue: new BullQueue(),
  emptyActions: {
    FAIL: 'fail',
    PROCEED: 'proceed'
  },
  contentCases: {
    EVENTS: 'events'
  },
  defaultContentCase: 'events',

  contentCase: async function(batch) {
    let category = batch.category;
    if (!category) {
      return this.defaultContentCase;
    }
    if (Number.isInteger(category)) {
      category = (await Variable.findOneById(batch.category)) || {};
    }
    const identity = category.identity || '';
    if (identity.includes(this.contentCases.EVENTS)) {
      return this.contentCases.EVENTS;
    }
    return this.defaultContentCase;
  },

  batchContentModels: async function(batch) {
    const contentCase = await this.contentCase(batch);
    let contentModels = [];
    switch (contentCase) {
      case this.contentCases.EVENTS:
        contentModels = await EventBatchList.batchContent(batch);
    }
    return contentModels;
  },

  failOnEmpty: function(batch, content = []) {
    return (
      !content.length &&
      (!batch.empty_action || batch.empty_action === this.emptyActions.FAIL)
    );
  },

  applyContentForMembers: async function(
    batch = {},
    member = {},
    modelContent = [],
    config = {}
  ) {
    const contentCase = await this.contentCase(batch);
    switch (contentCase) {
      case this.contentCases.EVENTS:
        return EventBatchList.applyContentForMembers(
          batch,
          member,
          modelContent,
          config
        );
    }
  },

  setContentModels: async function(contentModels, member, contentCase) {
    const modelContent = [];
    for (const model of contentModels) {
      let content = '';
      switch (contentCase) {
        case this.contentCases.EVENTS:
          content = EventBatchList.batchContentDetails(model, member);
      }
      model.__content = content;
      modelContent.push(model);
    }
    return modelContent;
  },

  membershipCycle: async function(
    batch,
    contentModels = [],
    member = {},
    contentCase,
    config = {}
  ) {
    // we do duplicated work to catch the details for the user
    const modelContent = await this.setContentModels(
      contentModels,
      member,
      contentCase
    );
    return this.applyContentForMembers(batch, member, modelContent, config);
  },

  generateContent: async function(
    batch,
    contentModels = [],
    audience = [],
    config = {}
  ) {
    const contentCase = await this.contentCase(batch);
    const sendCase = {};
    for (const member of audience) {
      const mId = this.getId(member);
      sendCase[mId] = await this.membershipCycle(
        batch,
        contentModels,
        member,
        contentCase,
        config
      );
    }
    return sendCase;
  },

  wrapContentResults: function(
    batch,
    content = [],
    contentDetails,
    members,
    config
  ) {
    return {
      content,
      batch,
      contentDetails,
      members,
      config
    };
  },

  batchProcessor: async function(batch) {
    if (!batch) {
      return false;
    }

    if (!Site.isInTestMode(batch) && !this.ballparkTime(batch)) {
      return false;
    }
    const content = await this.batchContentModels(batch);
    if (this.failOnEmpty(batch, content)) {
      return false;
    }
    const batchAudience = await this.pullAudience(batch);
    if (!batchAudience.length) {
      return false;
    }
    const config = await Site.thisSiteAsync(batch.domain);
    const contentDetails = await this.generateContent(
      batch,
      content,
      batchAudience,
      config
    );
    return this.wrapContentResults(
      batch,
      content,
      contentDetails,
      batchAudience,
      config
    );
  },

  pullFullBatch: function(batch = {}) {
    if (this.getId(batch) === -1) {
      return { ...batch, id: 1 }; // for testing
    }

    if (batch.category && !Number.isInteger(batch.category)) {
      return batch;
    }
    if (!this.getId(batch)) {
      return null;
    }
    return this.findOneById(this.getId(batch)).populateAll();
  },

  pullAudience: async function(batch = {}) {
    const batchReport = await this.pullFullBatch(batch);
    const tAudience = await Tag.pullAudience(
      batchReport.audience_tags,
      batchReport.domain
    );
    const collectedAudience = [...batchReport.audience];
    if (batchReport.admin_audience) {
      const dAdminAudience = await MailingAdmin.domainAdmins(
        batchReport.domain
      );
      collectedAudience.push(...dAdminAudience);
    }
    if (batchReport.roles && batchReport.roles.length) {
      const rAudience = await Domain.populateMembersOnRoles(
        batchReport.domain,
        batchReport.roles
      );
      collectedAudience.push(...rAudience);
    }
    if (batchReport.organizations && batchReport.organizations.length) {
      const oAudience = await Organization.findUsers(batchReport.organizations);
      collectedAudience.push(...oAudience);
    }
    const audience = await User.applyUserKeys(
      collectedAudience,
      batchReport.domain
    );
    const mergedAudience = User.mergeUserTypes([...tAudience, ...audience]);
    return mergedAudience;
  },

  finalizeJob: async function(result) {
    const contentCase = await this.contentCase(result.batch);
    switch (contentCase) {
      case this.contentCases.EVENTS:
        return EventBatchList.finalizeContent(result);
    }
  },

  getResultLength: function(result) {
    const length =
      result == null || result === false
        ? 0
        : Array.isArray(result.content)
        ? result.content.length
        : 0;
    return length;
  },

  emailLocals: function(contentResults, member) {
    const config = contentResults.config || {};
    const locals = {
      SITE: config.site_name,
      site_name: config.site_name,
      host: CommonUtils.pullHost(config)
    };
    const content = contentResults.contentDetails[this.getId(member)];
    const name = contentResults.batch.name || 'Batch Report Event';
    locals.NAME = member.name;
    locals.EMAIL = member.email;
    locals.PHONE = member.phone;
    locals.body = content.body;
    locals.header = content.heading;
    locals.calloutContent = name;
    return locals;
  },

  emailContentValues: function(contentResults, member) {
    const config = contentResults.config || {};
    const content = contentResults.contentDetails[this.getId(member)];
    return {
      to: {
        address: member.email,
        name: member.name
      },
      subject: content.subject || '',
      locals: this.emailLocals(contentResults, member),
      default_language: member.language || config.default_language || 'en',
      template: 'batch',
      variables: Email.variables.ews.key,
      tags: ['early warning batch alert', 'parabl', 'events']
    };
  },

  batchActionProcessor: async function(contentResults = {}) {
    const members = contentResults.members;
    for (const member of members) {
      if (!Common.validEmail(member.email)) {
        continue;
      }
      if (!contentResults.contentDetails[this.getId(member)]) {
        continue;
      }
      await Jobs.sendEmail.add(this.emailContentValues(contentResults, member));
    }
  },

  _processors: [
    BullQueue.jobTemplate(
      async job => {
        const data = job.data;
        await BatchReport.finalizeJob(data);
        return BatchReport.batchActionProcessor(data);
      },
      batchActionProcessor,
      {
        failed: async (err, job) => {
          sails.log.error('BATCH_ACTION_PROCESSOR::ERROR::', err);
          await BatchManager.fail(job, err.message);
        }
      }
    ),
    BullQueue.jobTemplate(
      async job => {
        await BatchManager.start(job);
        const data = job.data;
        const batch = await BatchReport.findOneById(data.id).populateAll();
        return BatchReport.batchProcessor(batch);
      },
      timerJobName,
      {
        completed: async (job, result) => {
          await BatchReport.applyTriggerTime(job.data);
          await BatchManager.complete(job, BatchReport.getResultLength(result));
          if (!result) {
            return;
          }
          await Jobs.batchActionProcessor.add(result);
        },
        failed: async (err, job) => {
          sails.log.error('BATCH_PROCESSING::ERROR::', err);
          await BatchReport.applyTriggerTime(job.data);
          await BatchManager.fail(job, err.message);
        }
      }
    )
  ],

  timeAggregate: function() {
    const minute = 60;
    const hour = minute * 60;
    const daily = hour * 24;
    const weekly = daily * 7;
    const monthly = daily * 30;
    return {
      minute,
      hour,
      daily,
      weekly,
      monthly
    };
  },

  applyTriggerTime: async function(batch) {
    batch.last_triggered = Common.timeIsNow();
    await this.update(
      { id: batch.id },
      { last_triggered: batch.last_triggered }
    );
    return false;
  },

  batchTimeDelta: function(batch) {
    const now = Common.timeIsNow();
    const lastTriggered = TimeUtils.date(batch.last_triggered);
    const dateDifference = TimeUtils.date(now).difference(lastTriggered);
    const seconds = dateDifference.inSeconds;
    return seconds;
  },
  /*
   * we do this to prevent the startup time
   */
  ballparkTime: function(batch) {
    const last_triggered = batch.last_triggered;
    if (!last_triggered) {
      return false;
    }
    // nn
    const delayOffset = 5;
    const tAgg = this.timeAggregate();
    const seconds = this.batchTimeDelta(batch);
    const interval = batch.interval || 1;
    const intervalType = batch.interval_type;
    if (tAgg[intervalType]) {
      return seconds <= interval * tAgg[intervalType] + delayOffset;
    }
    return true;
  },

  parseCronInterval: function(cron, interval = 1) {
    const cronParts = cron.split(' ');
    const cronJoin = [];
    for (const part of cronParts) {
      if (part.startsWith('*/')) {
        cronJoin.push(`*/${interval}`);
      } else if (!Number.isNaN(+part)) {
        cronJoin.push('0');
      } else {
        cronJoin.push(part);
      }
    }
    return cronJoin.join(' ');
  },

  getCronInterval: function(interval = 1, type = 'minute') {
    const safeInterval = interval < 1 ? 1 : interval;
    switch (type) {
      case 'weekly':
        return safeInterval * 7;
      default:
        return safeInterval;
    }
  },

  getSchedule: function(values = {}) {
    const schedule = SystemTimers.schedule;
    const interval = values.interval_type;
    const cron = schedule[interval];
    const cronSchedule = this.parseCronInterval(
      cron,
      this.getCronInterval(values.interval, interval)
    );
    return cronSchedule;
  },

  appendCron: function(increment = 0, value = 0, cron) {
    const cronParts = cron.split(' ');
    cronParts[increment] = value;
    return cronParts.join(' ');
  },

  refineTaskTime: function(values = {}) {
    const cron = this.getSchedule(values);
    const taskTime = values.task_time;
    if (!taskTime || taskTime < 0) {
      return cron;
    }
    switch (values.interval_type) {
      case 'hour':
        return this.appendCron(this.CRON_INDEX.MINUTE, taskTime, cron);
      case 'daily':
        return this.appendCron(this.CRON_INDEX.HOUR, taskTime, cron);
      case 'weekly':
        // we do hour given the weekly is a multiple of 7 days
        return this.appendCron(this.CRON_INDEX.HOUR, taskTime, cron);
      case 'monthly':
        return this.appendCron(this.CRON_INDEX.DAY, taskTime, cron);
      default:
        return cron;
    }
  },

  cronValue(value = '') {
    if (value === '*') {
      return 1;
    }
    const newValue = +value;
    if (Number.isNaN(newValue)) {
      return 1;
    }
    return newValue;
  },

  jobOptions: function(values = {}) {
    const jobId = Tracker.buildRandomId('uuid');
    const cron = this.refineTaskTime(values);
    const options = {
      jobId: jobId,
      repeat: { cron: cron }
    };
    return options;
  },

  async applyJob(values = {}) {
    if (Site.isInTestMode()) {
      return Tracker.buildRandomId('uuid');
    }
    const options = this.jobOptions(values);
    const job = await Jobs[this.timerJobName].add(
      {
        name: `Batch Report ${values.name}`,
        id: this.getId(values)
      },
      options
    );
    return job;
  },

  extractId: function(job = {}) {
    const opts = job.opts || {};
    const repeat = opts.repeat || {};
    return repeat.jobId || job.id;
  },

  startBatch: async function(values = {}) {
    const job = await this.applyJob(values);
    values.interval_job = this.extractId(job);
    await this.update(
      { id: this.getId(values) },
      { interval_job: values.interval_job, active: true }
    );
  },

  pruneJobs: async function(batches = []) {
    const ids = Common.buildBasicItemCacheFor(batches, 'interval_job');
    const removed = await BullQueue.prune(this.timerJobName, ids);
    if (!removed.length) {
      return;
    }
    sails.log.debug(`CLEANED ${removed.length} BatchReport jobs`);
  },

  stopBatch: async function(batch = {}) {
    const iJob = batch.interval_job;
    const inSession = await BullQueue.findRepeatableJobs(
      this.timerJobName,
      iJob
    );
    if (!inSession) {
      return false;
    }
    BullQueue.killJob(inSession, this.timerJobName);
    batch.interval_job = null;
    return this.update(
      { id: this.getId(batch) },
      { interval_job: batch.interval_job, active: false }
    );
  },

  batchApplicator: async function(batch) {
    const iJob = batch.interval_job;
    if (!iJob) {
      return this.startBatch(batch);
    }
    const inSession = await BullQueue.findRepeatableJobs(
      this.timerJobName,
      iJob
    );
    if (inSession) {
      return;
    }
    await this.startBatch(batch);
  },

  allActiveBatches: function() {
    return this.find().where({ active: true });
  },

  bootstrap: async function(cb) {
    if (Site.isInTestMode()) {
      return cb();
    }

    try {
      const batches = await this.fallActiveBatches();
      for (const batch of batches) {
        await this.batchApplicator(batch);
      }
      await this.pruneJobs(batches);
    } catch (e) {
      return cb(e);
    }
    cb();
  },

  afterCreate: async function(values, next) {
    await this.startBatch(values);
    next();
  },

  intervalDiffers: function(check = {}, against = {}) {
    return (
      check.interval !== against.interval ||
      check.interval_type !== against.interval_type ||
      check.task_time !== against.task_time
    );
  },

  checkTimeChange: async function(values = {}) {
    const batch = await this.findOneById(this.getId(values));
    if (!this.intervalDiffers(batch, values)) {
      return;
    }
    await this.stopBatch(batch);
    await this.startBatch(values);
  },

  checkActive: async function(values = {}) {
    if (typeof values.active === 'undefined') {
      return;
    }
    const batch = await this.findOneById(this.getId(values));
    if (batch.active === values.active) {
      return;
    }
    if (values.active) {
      await this.startBatch(batch);
    } else {
      await this.stopBatch(batch);
    }
  },

  beforeUpdate: async function(values, next) {
    if (!this.getId(values)) {
      return next();
    }

    if (
      typeof values.interval === 'undefined' &&
      typeof values.interval_type === 'undefined'
    ) {
      return next();
    }
    await this.checkTimeChange(values);
    await this.checkActive(values);
    next();
  },

  afterDestroy: async function(values, next) {
    await this.stopBatch(values);
    next();
  }
};
