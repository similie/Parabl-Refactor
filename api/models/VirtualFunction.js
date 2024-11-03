/**
 * VirtualFunction.js
 *
 * @description :: A model definition.  Represents a database table/collection/etc.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */
const { TimeUtils, SqlUtils } = require('similie-api-services');
const tz = TimeUtils.constants.timeZone;
const TimePeriod = TimeUtils.constants.ENUMS.timePeriods;

const getDelta = (value, config, schema) => {
  const span = config.span;
  const against = config.against;
  const escape = SqlUtils.escapeUtil();
  const q = `SELECT
  "${escape('%s', span)}" as last_date,
  EXTRACT(EPOCH FROM ('${escape(
    '%s',
    TimeUtils.sqlFormattedDate(value)
    // SqlUtil.convertToDate(value, true)
    // moment(value)
    //   .tz(tz)
    //   .format()
  )}'::TIMESTAMP AT TIME ZONE '${escape('%s', tz)}' - "${escape(
    '%s',
    span
  )}"::TIMESTAMP AT TIME ZONE '${escape('%s', tz)}') ) as delta_last,
	"${escape('%s', against)}" as last_value
	FROM "${SqlUtils.knex().getSchemaName(schema)}"."${schema.name}"
	WHERE "station" = ${escape('%s', config.station)}
  AND "${escape('%s', span)}" IS NOT NULL
	ORDER BY "${escape('%s', span)}" DESC LIMIT 1`;
  return q;
};

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    name: 'string',
    description: 'text',
    function: 'string',
    options: 'json',
    meta: 'json'
  },
  /**
   * nodeSetup
   *
   * generates the query for the inner node values being tested against
   *
   * @param {*} config
   * @param {*} schema - nodeschema
   * @returns {KnexQueryObject}
   */
  nodeSetup: function(config, schema) {
    const model = SqlUtils.knex(sails.models.knex).withSchema(schema);
    const whereStatement = this.setVirtualWhere(config);
    model.whereRaw(whereStatement);
    return model;
  },

  /**
 * @deprecated Use SqlUtils.setVirtualWhere
 * setVirtualWhere
 * 
 * @param {
    over: true, 
    virtual: 13, // id of virtual
    against: 'value', // this is an agregate value
    span: 'date', // this is a grouping value
    interval: 'limit', // limit your dataset to a certain number of records
    scale: 1, // the limiting scale
    virtual_name: 'Difference', // human readable name
    virtual_function: 'difference', // machine readable name
    interval_label: 'labels.LIMIT', // translatable label
    span_value: '2021-12-09T20:50:44.786Z', // the value the interval is limited
    station: 51 // station ID
   } vConfig 
 * @returns String - a database query string
 */
  setVirtualWhere: function(vConfig) {
    const station = vConfig.station;
    const escape = SqlUtils.escapeUtil();
    const where = escape('"station" = %s', station);

    if (hasVirtualLimit(vConfig)) {
      return setVituralLimit(vConfig, where);
    }

    if (hasNoVritualInterval(vConfig)) {
      return where;
    }

    return setVirtualSpan(vConfig, where);
  },

  applyDevice: function(config, params, schema) {
    if (!schema.show_devices) {
      return;
    }

    const device = params.__device__;
    if (device) {
      const escape = SqlUtils.escapeUtil();
      config.device = escape('= %s', device);
    } else {
      config.device = 'IS NULL';
    }
  },

  aggregateSetup: async function(config, params, schema, entity, aggregate) {
    const current = params[config.against] || 0;
    config.span_value = params[config.span];
    config.station = Station.getId(params.station);
    this.applyDevice(config, params, schema);

    if (entity === 'node') {
      try {
        // await here so we can catch an error
        return await processAndStripQuery(
          buldFullVirualSql(config, current, schema, aggregate)
        );
      } catch (e) {
        sails.log.error(e);
      }
    } /** @todo: we could solve for stations and other entities  */
    return null;
  },

  generic: async function(config, params, schema, entity, aggregate) {
    const found = await VirtualFunction.aggregateSetup(
      config,
      params,
      schema,
      entity,
      aggregate
    );
    const _var = found[aggregate] || 0;
    return _var;
  },
  difference: async function(config, params, schema, entity) {
    return await this.generic(config, params, schema, entity, 'difference');
  },
  change_velocity: async function(config, params, schema, entity) {
    config.station = Station.getId(params.station);
    let avg = await this.generic(config, params, schema, entity, 'avg');
    if (typeof avg === 'string') {
      avg = parseFloat(avg);
    }

    const span = config.span;
    const against = config.against;
    const lastValue = getDelta(params[span], config, schema);
    const deltaRows = await Model.queryAsync(lastValue);
    const delta = deltaRows.rows.pop();
    let deltaLast = (delta || {}).delta_last;
    if (deltaLast == null) {
      return 0;
    } else if (deltaLast === 0) {
      deltaLast = 1;
    } else {
      deltaLast = parseFloat(deltaLast);
    }
    const againstValue = params[against] || 0;
    const value = parseFloat(againstValue);
    if (avg === value) {
      avg = parseFloat(delta.last_value);
    }
    const delta_change = avg - value;
    const change = (delta_change / Math.round(deltaLast)) * -1;
    return change.toFixed(6);
  },
  stdev: async function(config, params, schema, entity) {
    return await this.generic(config, params, schema, entity, 'stdev');
  },
  stddev_pop: async function(config, params, schema, entity) {
    return await this.generic(config, params, schema, entity, 'stddev_pop');
  },
  stddev_samp: async function(config, params, schema, entity) {
    return await this.generic(config, params, schema, entity, 'stddev_samp');
  },
  variance: async function(config, params, schema, entity) {
    return await this.generic(config, params, schema, entity, 'variance');
  },
  var_pop: async function(config, params, schema, entity) {
    return await this.generic(config, params, schema, entity, 'var_pop');
  },
  var_samp: async function(config, params, schema, entity) {
    return await this.generic(config, params, schema, entity, 'var_sample');
  },
  min: async function(config, params, schema, entity) {
    return await this.generic(config, params, schema, entity, 'min');
  },
  max: async function(config, params, schema, entity) {
    return await this.generic(config, params, schema, entity, 'max');
  },
  counter: async function(config, params, schema, entity) {
    return await this.generic(config, params, schema, entity, 'count');
  },
  avg: async function(config, params, schema, entity) {
    return await this.generic(config, params, schema, entity, 'avg');
  },
  sum: async function(config, params, schema, entity) {
    return await this.generic(config, params, schema, entity, 'sum');
  },
  droughtIndex: async function(config, params, schema) {
    const span_value = Node.formatDateParam(params[config.span]);
    config.station = Station.getId(params.station);
    const against = config.against;
    const span = config.span;

    const q = `SELECT SUM
    ( "${against}" ) AS "${against}",
    DATE ( "${span}" AT TIME ZONE '${tz}' ) AS "${span}",
    ( EXTRACT ( 'day' FROM date_trunc( 'day', '${span_value}'::TIMESTAMP  - DATE ( "${span}" AT TIME ZONE '${tz}' ))) + 1 ) AS "drought_days"
    FROM "${SqlUtils.knex().getSchemaName(schema)}"."${schema.name}"
    WHERE
    "station" = ${config.station} AND
    "${against}" > 0
    AND ((
    "${span}" AT TIME ZONE '${tz}'
    ) > ( '${span_value}' AT TIME ZONE '${tz}' - INTERVAL '10 DAYS' ))
  GROUP BY
    DATE ( "${span}" AT TIME ZONE '${tz}' ) UNION ALL
  SELECT
    0 AS "${against}",
    DATE ((( '${span_value}' AT TIME ZONE '${tz}' - INTERVAL '10 DAYS' ) :: TIMESTAMP AT TIME ZONE '${tz}' ) AT TIME ZONE '${tz}' ) AS "${span}",
    10 AS "drought_days"
  ORDER BY
    "drought_days" ASC
    LIMIT 1;`;
    const _q = await Model.queryAsync(q);
    const values = _q.rows.pop();
    const index = values.drought_days;
    return index;
  },

  sqsNodes: async function(results) {
    const _d = _.unique(_.pluck(results, 'device'));
    if (!_.size(_d)) {
      throw new Error('A primary devices is required');
    }

    const devices = await Device.find({
      where: {
        or: [
          {
            serial_number: _d
          },
          {
            access_key: _d
          }
        ]
      }
    });
    sails.log.debug('PROCESSING DEVICE REQUEST FOR ', _d);
    if (!_.size(devices)) {
      throw new Error('Selected devices not found');
    }

    const deviceMap = {};
    const deviceStationMap = {};
    const dIds = [];
    _.each(devices, d => {
      deviceMap[d.id] = d;
      dIds.push(d.id);

      Device.deviceLog(d, results, 'Virtual');
    });

    if (!_.size(dIds)) {
      throw new Error('EWS mapping not found');
    }

    const dMap = await DeviceMap.find({
      device: dIds
    }).populateAll();

    for (let i = 0; i < _.size(dMap); i++) {
      const e = dMap[i];
      const d = e.device;
      const dId = Device.getId(d);
      const selector = deviceMap[dId];
      const selection = _.size(
        _.where(devices, {
          serial_number: selector.serial_number
        })
      )
        ? 'serial_number'
        : 'access_key';
      const identity = selector[selection];
      deviceStationMap[identity] = deviceStationMap[identity] || [];
      deviceStationMap[identity].push({
        device: selector,
        station: e.station,
        node: e.node,
        identity: identity,
        id: dId
      });
    }

    const nodeCache = {};
    const domainCache = {};
    const creations = [];

    for (let i = 0; i < _.size(results); i++) {
      const res = results[i];
      const map = deviceStationMap[res.device];
      for (let j = 0; j < _.size(map); j++) {
        const cache = map[j];
        const dates = _.filter(
          _.where(cache.node.schema, {
            type: 'date'
          }),
          d => (d.meta || {}).time
        );
        const dateName = (dates[0] || {}).name || 'date';
        const sId = NodeSchema.getId(cache.node);
        const node = {
          station: Station.getId(cache.station),
          schema: sId,
          observer: User.getId(cache.device.owner),
          [dateName]: res[dateName],
          __device__: cache.id,
          ...res.data
        };

        DeviceTracker.create({ device: cache.id }).exec(err => {
          if (err) {
            sails.log.error(err);
          }
        });

        const schema =
          nodeCache[sId] ||
          (await NodeSchema.findOneById(sId).populate('domain'));
        if (!nodeCache[sId]) {
          nodeCache[sId] = schema;
        }
        const model = schema.name;
        const domain = schema.domain;
        const dId = Domain.getId(domain);
        const config = domainCache[dId] || (await Site.thisSiteAsync(domain));
        if (!domainCache[dId]) {
          domainCache[dId] = config;
        }

        try {
          const created = await Node.create(
            node,
            {},
            {
              locals: {
                domain: cache.station.domain,
                siteData: config,
                schema: schema,
                device: cache.device
              }
            }
          );
          const blasts = Node.blasts(created);
          blasts.blastCreatedNodeToStation(model, created.station);
          blasts.renderBirth(model, created.station);
          blasts.blastParentsWithBirth(model, schema);
          creations.push(created);
        } catch (e) {
          sails.log.debug(e);
        }
      }
    }
    return creations;
  },

  _processors: [
    {
      name: 'sqsNodes',
      process: async function(job) {
        const data = job.data;
        let result;
        try {
          result = await VirtualFunction.sqsNodes(data);
        } catch (e) {
          return Promise.reject(e);
        }
        return result;
      },

      stats: Utils.stats({
        completed: function() {
          sails.log.debug('Virtuals.sqsNodes::COMPLETE::');
        },
        failed: function(job, err) {
          sails.log.error('Virtuals.sqsNodes::ERR::', err);
        }
      })
    }
  ]
};

/**
 * buldFullVirualSql
 *
 * Wrapper that builds the aggregate sql query
 *
 * @param {*} config
 * @param {*} current
 * @param {*} schema
 * @param {*} aggregate
 * @returns {KnexObject}
 */
function buldFullVirualSql(config, current, schema, aggregate) {
  const against = config.against;
  const knex = sails.models.knex;
  const query = VirtualFunction.nodeSetup(config, schema);
  const q = aggregatedSelection(against, aggregate);
  const subselect = limiterSelect(config, current);
  const sql = query.select(knex.raw(`"${against}" as "${against}" `)).toSQL();
  const fullsql = knex
    .select(knex.raw(q))
    .from(knex.raw(`((${sql.sql}) ${subselect}) a`));
  // fullsql.debug();
  return fullsql;
}

/**
 * limiterSelect
 *
 * Generates a union subquery
 *
 * @param {*} config
 * @param {*} current
 * @returns {string} - union subquer
 */
function limiterSelect(config, current) {
  if (hasVirtualLimit(config) && falseScaleValue(config)) {
    return '';
  }
  const escape = SqlUtils.escapeUtil();
  const union = escape(`UNION ALL SELECT %s as "${config.against}" `, current);
  return union;
}

/**
 * setVituralLimit
 *
 * Allows the function to test against a limited number of records
 *
 * @param {*} vConfig
 * @param {*} where
 * @returns string - sql where appendage with limit and sorting
 */
function setVituralLimit(vConfig, where) {
  const span = vConfig.span;
  const against = vConfig.against;
  const scale = vConfig.scale;
  const escape = SqlUtils.escapeUtil();
  const interval = vConfig.interval;
  const distribution = interval === 'distribution';
  const span_value = TimeUtils.isoFormattedDate(vConfig.span_value, true);
  where += escape(` AND "%s" IS NOT NULL AND "%s" IS NOT NULL`, span, against);
  if (span_value) {
    where += escape(
      ` AND "%s" %s '%s'`,
      span,
      /**
       * need to consider this from a data science propspective. The sort order
       * distacts which records we select from. However, since we are working with realtime datasets,
       * it is most likely that we only want to test against data from before. Limit will
       * test against the last, most recent records and distribution the first records. Therefore,
       * both conditions will test against <= (lessthan or equal values)
       */

      distribution ? '<=' : '<=',
      span_value
    );
  }

  if (vConfig.device) {
    where += escape(' AND "__device__" %s', vConfig.device);
  }

  const alteredWhere = escape(
    `%s ORDER BY "%s" %s LIMIT %s`,
    where,
    span,
    distribution ? 'ASC' : 'DESC',
    scale
  );
  return alteredWhere;
}

/**
 * aggregatedSelection
 *
 * Sets up the primary aggregate SQL function
 *
 * @param {*} column - value aggregating
 * @param {*} aggregate - the aggregate function
 * @returns
 */

function aggregatedSelection(column, aggregate) {
  const pull = {
    max: `COALESCE ( MAX ( a."${column}" ), 0 ) AS max`,
    min: `COALESCE ( MIN ( a."${column}" ), 0 ) AS min`,
    count: `COALESCE ( COUNT ( a."${column}" ), 0 ) as count`,
    sum: `COALESCE ( SUM ( a."${column}" ), 0 ) as sum`,
    difference: `ABS(max(a."${column}") - min(a."${column}")) as difference`,
    avg: `AVG ( a."${column}" ) AS avg`,
    stdev: `stddev (a."${column}") as stdev`,
    stddev_pop: `stddev_pop(a."${column}") stddev_pop`,
    stddev_samp: `stddev_samp(a."${column}") stddev_samp`,
    variance: `variance( a."${column}"  ) variance`,
    var_pop: `var_pop( a."${column}"  ) var_pop`,
    var_samp: `var_samp( a."${column}"  ) var_samp`
  };
  return pull[aggregate];
}

/**
 * setVirtualSpan
 *
 * Ensures the function is bound within a specified date range
 *
 * @param {*} vConfig
 * @param {*} where
 * @returns string - the where appendage with ordered dates
 */
function setVirtualSpan(vConfig, where) {
  const span = vConfig.span;
  const over = vConfig.over;
  // we've included offset values and we only
  // want the offset when the over property is set to false
  const offset = over ? 0 : vConfig.offset || 0;
  const _span_value = TimeUtils.date(vConfig.span_value);
  const spanedOffset = _span_value.minus(offset, TimePeriod.minutes).tz(tz)
    .toISO;

  const interval = vConfig.interval;
  const scale = vConfig.scale;
  const escape = SqlUtils.escapeUtil();
  where += ' AND ';
  if (over && scale) {
    where += escape(
      `"%s" AT TIME ZONE '%s' > ('%s' AT TIME ZONE '%s' - interval '%s %s') AND "%s" AT TIME ZONE  '%s' <= ('%s' AT TIME ZONE '%s')`,
      span,
      tz,
      spanedOffset,
      tz,
      scale,
      interval,
      span,
      tz,
      spanedOffset,
      tz
    );
  } else {
    const index = getVirtualIntervalIndex(vConfig);
    const intervals = getVirtualIntervals();

    for (let i = 0; i < index; i++) {
      const int = intervals[i];
      where += escape(
        `EXTRACT(%s FROM  "%s" AT TIME ZONE '%s') = EXTRACT(%s FROM '%s' AT TIME ZONE '%s') AND `,
        int,
        span,
        tz,
        int,
        spanedOffset,
        tz
      );
    }
    where += escape(
      `EXTRACT(%s FROM "%s" AT TIME ZONE '%s') = EXTRACT(%s FROM '%s' AT TIME ZONE '%s') `,
      interval,
      span,
      tz,
      interval,
      spanedOffset,
      tz
    );
  }
  return where;
}

function falseScaleValue(config) {
  return config.scale == null || config.scale < 1;
}

/**
 * getVirtualIntervalIndex
 *
 * The virtual set index is used to order the length of time for a limited
 * set
 *
 * @param {*} vConfig
 * @returns int - index of the the limit set
 */
function getVirtualIntervalIndex(vConfig) {
  return _.indexOf(getVirtualIntervals(), vConfig.interval);
}

/**
 * getVirtualIntervalIndex
 *
 * Returns the the limiter array
 *
 * @returns Array{string}
 */
function getVirtualIntervals() {
  return ['year', 'month', 'day', 'hour', 'minute', 'limit', 'distribution'];
}

/**
 * hasNoVritualInterval
 *
 * Checks to see if the interval value is valid
 *
 * @param {*} vConfig
 * @returns boolean - true if there is no valid virtual configuation
 */

function hasNoVritualInterval(vConfig) {
  const interval = vConfig.interval;
  const index = getVirtualIntervalIndex(vConfig);
  return interval === 'forever' || index === -1;
}

/**
 * hasVirtualLimit
 *
 * Do we need to add a limit to the query
 *
 * @param {*} vConfig
 * @returns boolean - true if a limit function exists
 */
function hasVirtualLimit(vConfig) {
  const interval = vConfig.interval;
  return interval === 'limit' || interval === 'distribution';
}

/**
 * processAndStripQuery
 *
 * Process and pop the SQL values from it's array
 * @param {*} fullsql
 * @returns data from the aggregate query
 */
async function processAndStripQuery(fullsql) {
  const f = await fullsql;
  const found = f.pop();
  return found;
}
