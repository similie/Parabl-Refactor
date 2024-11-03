const { TimeUtils, SqlUtils } = require('similie-api-services');
const {
  NodeDownloadActions
} = require('../model-utilities/nodedownloads/nodedownloads-actions');
const now_ = TimeUtils.constants.now_;

module.exports = {
  migrate: process.env.MIGRATION || 'safe',

  attributes: {
    name: {
      type: 'string',
      required: true
    },

    fileId: {
      type: 'uuid'
    },

    socket: {
      type: 'string'
    },

    language: {
      type: 'string',
      defaultsTo: 'en'
    },

    tracking_id: {
      type: 'string',
      unique: true,
      required: true
    },

    schema: {
      model: 'nodeschema'
    },

    count: {
      type: 'integer',
      min: 0,
      defaultsTo: 0
    },

    skip: {
      type: 'integer',
      min: 0,
      defaultsTo: 0
    },

    limit: {
      type: 'integer',
      min: 0,
      defaultsTo: 0
    },

    sample: {
      type: 'integer',
      min: 1,
      defaultsTo: 1
    },

    finished: {
      type: 'boolean',
      defaultsTo: false
    },

    user: {
      model: 'user'
    },

    file: {
      model: 'sysfile'
    },

    query: {
      type: 'json'
    },

    where: {
      type: 'json'
    },

    selected_params: {
      type: 'json'
    },

    meta: {
      type: 'json'
    }
  },

  getNonExpiredDownloadQuery: function(params) {
    const escape = SqlUtils.escapeUtil();
    const stationQuery = `AND ("where"->>'station'::TEXT) LIKE '%%%s%'`;
    let appendedStationQuery = '';
    const query = `SELECT "id" FROM "nodedownload" 
      WHERE "schema" = %s %s AND "finished" IS TRUE AND "file" IS NOT NULL AND (now() - interval '1 DAY' ) <= "updatedAt"
    ORDER BY "updatedAt" DESC
    LIMIT 1
    ;`;
    if (params.station) {
      appendedStationQuery = escape(
        stationQuery,
        Array.isArray(params.station)
          ? SqlUtils.setInString(params.station)
          : params.station.in && Array.isArray(params.station.in)
          ? SqlUtils.setInString(params.station)
          : ` = ${params.station}`
      );
    }
    const finalQuery = escape(query, params.schema, appendedStationQuery);
    return finalQuery;
  },

  getNonExpiredDownload: async function(params) {
    // uncomment for debugging
    // return null;
    const query = this.getNonExpiredDownloadQuery(params);
    const results = await NodeDownload.queryAsync(query);
    const result = results.rows.pop();
    if (result && result.id) {
      return NodeDownload.findOneById(result.id).populateAll();
    }
    return null;
  },

  getNodeCount: async function(req, schema) {
    const cResult = await Node.countNode(req)(schema);
    const count = parseInt((cResult.pop() || {}).count || 0);
    return count;
  },

  massageCount: function(count, download) {
    const skip = download.skip || 0;
    const limit = download.limit || 0;
    const sample = download.sample || 1;
    const totalAvailable = count - skip;
    const countEvery = totalAvailable / sample;
    const _count = limit
      ? totalAvailable >= limit
        ? limit / sample
        : countEvery
      : countEvery;

    return Math.floor(_count);
  },

  countAttributes: async function(req, res, _schema = null) {
    const params = req.params.all();
    const user = req.user;
    const schema =
      _schema ||
      (await Node.pullSchema(
        { schema: this.getSchemaFromQuery(params) },
        res,
        user
      ));
    const count = await this.getNodeCount(req, schema);
    const newCount = this.massageCount(count, params);
    return newCount;
  },

  getFileName: function(schema) {
    const now = TimeUtils.date(now_);
    const formatted = TimeUtils.formattedDate(
      now,
      TimeUtils.constants.formats.Date.full
    );
    return `${schema.name}-${formatted
      .replaceAll(' ', '-')
      .replaceAll(',', '')}.xlsx`;
  },

  getQueryMeta: function(params) {
    const _params = params.query || params;
    const copy = { ..._params };
    const kill = ['selected_params', '__model', 'sample', 'count'];
    kill.forEach(k => {
      delete copy[k];
    });
    delete copy.where;
    return copy;
  },

  setSelectedParams: function(download, schema = []) {
    download.selected_params = download.selected_params || {};
    const keys = Object.keys(download.selected_params);
    if (keys.length) {
      return;
    }
    for (let i = 0; i < schema.length; i++) {
      const param = schema[i];
      download.selected_params[param.name] = true;
    }
  },

  buildCraftedModel: async function(req, res) {
    const params = req.params.all();
    const template = await this.buildBlankModel(req, res);
    const model = {
      ...params,
      ...template
    };
    delete model.__model;
    return model;
  },

  getSchemaFromQuery: function(params) {
    const schema =
      params.__model || params.schema || (params.query || {}).schema;
    if (!schema) {
      throw new Error('Schema not found');
    }
    return NodeSchema.getId(schema);
  },

  buildBlankModel: async function(req, res) {
    const params = req.params.all();
    const user = req.user;
    const _schema = this.getSchemaFromQuery(params);
    const schema = await Node.pullSchema({ schema: _schema }, res, user);
    const count = await this.countAttributes(req, res, schema);
    const where = await Node.manageAsyncWhere(req)(schema);
    const createdDownload = {
      name: this.getFileName(schema),
      socket: sails.sockets.getId(req),
      schema: NodeSchema.getId(schema),
      count: params.count || count,
      query: this.getQueryMeta(params),
      where: where,
      user: User.getId(user),
      skip: params.skip || 0,
      sample: params.sample || 1,
      limit: params.limit || 0,
      language: Translates.getLanguage(req, res),
      selected_params: params.selected_params || {},
      domain: Domain.getId(res.locals.domain),
      meta: {}
    };
    this.setSelectedParams(createdDownload, _schema.schema);
    return createdDownload;
  },

  applyJob: function(download) {
    Jobs.nodeDownloadGenerator.add({
      download: NodeDownload.getId(download)
    });
    return download;
  },

  beforeValidate: async function(values, next) {
    if (!values.tracking_id) {
      values.tracking_id = Tracker.buildRandomId();
    }
    if (!values.fileId) {
      values.fileId = Tracker.buildRandomId('uuid');
    }
    next();
  },

  _processors: [
    {
      name: 'nodeDownloadGenerator',
      process: async function(job) {
        const data = job.data;
        sails.log.debug('Jobs.nodeDownloadGenerator::PROCESSING', data);
        if (!data.download) {
          throw new Error('Download ID required');
        }
        const nd = await NodeDownload.findOneById(data.download).populateAll();
        if (!nd) {
          throw new Error('Download is not valid');
        }

        job.nd = nd;
        const ndAction = new NodeDownloadActions(job.nd, job);
        return ndAction.build();
      },

      stats: Utils.stats({
        completed: function() {
          sails.log.debug('Jobs.nodeDownloadGenerator::COMPLETE');
        },
        failed: function(job, err) {
          const ndAction = new NodeDownloadActions(job.nd, job);
          ndAction.sendError(err);
          sails.log.error('Jobs.nodeDownloadGenerator::ERR::', err);
        }
      })
    }
  ]
};
