/**
 * EventBatchList.js
 *
 * @description :: A model definition represents a database table/collection.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

const { CommonUtils, TimeUtils } = require('similie-api-services');
const { Common } = require('../model-utilities/common/common');
module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    event: {
      model: 'earlywarning'
    },
    ews: {
      model: 'ews'
    },
    batch: {
      model: 'batchreport'
    },
    content: {
      type: 'json'
    },
    triggered: {
      type: 'boolean',
      defaultsTo: false
    },
    triggered_on: {
      type: 'datetime'
    }
  },

  addToEventBatchList: async function(event, ews) {
    const actions = event.actions || {};
    const report = actions.report || {};
    const reports = report.reports || [];
    const batchLists = [];
    for (const batch of reports) {
      const batchList = await this.create({
        event: this.getId(event),
        ews: this.getId(ews),
        batch: this.getId(batch),
        content: report.content,
        triggered: false
      });
      batchLists.push(batchList);
    }
    return batchLists;
  },

  retrieveConfig: async function(batch, store = {}) {
    const domain = this.getId(batch.event.domain);
    const dId = domain || 'NULL';
    if (store[dId]) {
      return store[dId];
    }
    const config = await Site.thisSiteAsync(domain);
    store[dId] = config;
    return store[dId];
  },

  globalStation: function(id, name) {
    return { id: id, local_name: name, station_id: '' };
  },

  retrieveStation: async function(batch, store = {}) {
    const stationID = this.getId(batch.event.station);
    if (!stationID || stationID < 0) {
      return this.globalStation(stationID, batch.event.name);
    }
    if (store[stationID]) {
      return store[stationID];
    }
    const station = await Station.findOneById(stationID);
    store[stationID] = station;
    return store[stationID];
  },

  retrieveNodeSchema: async function(batch, store = {}) {
    const nodeId = this.getId(batch.event.node);
    if (!nodeId) {
      return null;
    }

    if (store[nodeId]) {
      return store[nodeId];
    }
    const ns = await NodeSchema.findOneById(nodeId);
    store[nodeId] = ns;
    return store[nodeId];
  },

  batchContentWrapper: function(batchContentModels = []) {
    if (!batchContentModels.length) {
      return '<p>No Events Detected</p>';
    }
    return `<ul class="list-unstyled">${batchContentModels
      .map(c => c.__content || c.content)
      .join('')}</ul>`;
  },

  batchConfigTemplate: function() {
    return `<li>
      <p><strong>%event.name%:</strong> %triggered_time%, %station.local_name% %station.station_id%</p>
      <em>%batch_content%</em>
    </li>`;
  },

  parseContent: async function(batch, context = {}) {
    const locals = {
      triggered_time: TimeUtils.formattedDate(
        batch.ews.triggered_time,
        TimeUtils.constants.formats.DateTime.verboseAmPm
      ),
      ...batch,
      ...context
    };
    return CommonUtils.parseLocals(this.batchConfigTemplate(), locals);
  },

  contentRetrieval: async function(batch, localStore = {}) {
    const config = await this.retrieveConfig(batch, localStore.config);
    const station = await this.retrieveStation(batch, localStore.station);
    const nodeschema = await this.retrieveNodeSchema(
      batch,
      localStore.nodeschema
    );
    if (!nodeschema) {
      return { config, station };
    }
    const node = await Node.findOneById(batch.ews.target, nodeschema);
    return {
      config,
      station,
      nodeschema,
      node
    };
  },

  applyUserImpact: async function(contentDetails = {}) {
    for (const details of contentDetails.content) {
      const members = contentDetails.members || [];
      await EventImpact.addMany(
        members,
        {
          station: Model.getId(details.event.station),
          event: this.getId(details.event),
          ews: this.getId(details.ews),
          domain: this.getId(details.event.domain),
          meta: {
            batch: this.getId(details.batch),
            list: this.getId(details)
          }
        },
        'report'
      );
    }
  },

  finalizeContent: async function(contentDetails = {}) {
    await this.applyUserImpact(contentDetails);
    const content = contentDetails.content || [];
    return this.update(
      { id: content.map(cd => this.getId(cd)) },
      { triggered: true, triggered_on: Common.timeIsNow() }
    );
  },

  buildEventHeaderLocals: function(batch = {}, member = {}, config = {}) {
    const locals = {
      NAME: member.name,
      EMAIL: member.email,
      PHONE: member.phone,
      BATCH_NAME: batch.name,
      SITE_NAME: config.site_name,
      site_name: config.site_name,
      host: CommonUtils.pullHost(config)
    };
    return locals;
  },

  batchSubjectHeading: function(batch, member, config) {
    const content = Message.parseMessageBody(batch.description);
    return CommonUtils.parseLocals(
      content,
      this.buildEventHeaderLocals(batch, member, config)
    );
  },

  batchContentHeading: function(batch, member, config) {
    const content = Message.parseMessageBody(batch.body);
    return CommonUtils.parseLocals(
      content,
      this.buildEventHeaderLocals(batch, member, config)
    );
  },

  appendEwsData: function(batchContent = {}) {
    const context = batchContent.context || {};
    const data = {
      ...context,
      ew: batchContent.event
    };
    return EWS.setLocals(data);
  },

  batchContentDetails: function(batchContent, member = {}) {
    const context = batchContent.context || {};
    const batchLocals = this.buildEventHeaderLocals(
      batchContent.batch,
      member,
      context.config
    );

    const locals = {
      ...batchLocals,
      ...this.appendEwsData(batchContent)
    };
    const language = member.language;
    const batchText = Translates.pullLanguageFromModel(
      batchContent.content,
      language
    );
    const content = CommonUtils.parseLocals(batchText, locals);
    return CommonUtils.parseLocals(batchContent.parsedContent, {
      batch_content: content
    });
  },

  applyContentForMembers: function(
    batch = {},
    member = {},
    modelContent = [],
    config = {}
  ) {
    const memberSend = {};
    memberSend.subject = this.batchSubjectHeading(batch, member, config);
    memberSend.heading = this.batchContentHeading(batch, member, config);
    memberSend.body = this.batchContentWrapper(modelContent);
    return memberSend;
  },

  batchContent: async function(batch) {
    // there will be a number of repeat values,
    // so we need to cache them
    const configStore = {
      config: {},
      station: {},
      nodeschema: {}
    };
    const batchList = await this.find({
      batch: this.getId(batch),
      triggered: false
    })
      .sort({ createdAt: 'DESC' })
      .populateAll();

    const sendContent = [];
    for (const batch of batchList) {
      const context = await this.contentRetrieval(batch, configStore);
      const parsedContent = await this.parseContent(batch, context);
      sendContent.push({
        ...batch,
        context,
        parsedContent
      });
    }
    return sendContent;
  }
};
