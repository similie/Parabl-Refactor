const _lo = require('lodash');
const moment = require('moment-timezone');
const tz = process.env.TIME_ZONE || 'Asia/Dili';
const escape = require('pg-escape');

function escapeUtil() {
  return escape;
}

function SetQueryString(query) {
  let queryString = '';

  if (_.size(query.where)) {
    const where = buildWhereString(query.where, true);
    queryString += `WHERE ${where} `;
  }

  if (_.size(query.sort)) {
    const sort = buildSort(query.sort);
    queryString += `${sort}`;
  }

  let limit = '';
  let offset = '';

  if (query.skip) {
    offset = ` OFFSET ${query.skip}`;
    queryString += `${offset}`;
  }

  if (query.limit) {
    limit = ` limit ${query.limit}`;
    queryString += ` ${limit}`;
  }

  return queryString;
}

function setInString(inArr) {
  let q = 'in(';
  _.each(inArr, (inQ, i) => {
    let id;
    if (_.isFinite(inQ) || _.isString(inQ)) {
      id = inQ;
    } else if ((inQ || {}).id) {
      id = inQ.id;
    }

    if (id) {
      q += _.isString(id) && !_.isFinite(id) ? `'${id}'` : id;
      if (i < _.size(inArr) - 1) {
        q += ',';
      } else {
        q += ')';
      }
    }
  });

  return q;
}

function getIsNull(attr) {
  if (!attr) {
    return `IS NULL`;
  } else {
    return `${Model.getId(attr)}`;
  }
}

function formatDomainQuery(domain, key) {
  key = key || 'domain';
  const space = domain ? ' = ' : ' ';
  return `"${key}"${space}${getIsNull(domain)}`;
  // if (!domain) {
  //   return `"${key}" IS NULL`;
  // } else {
  //   return `"${key}" = ${Domain.getId(domain)}`;
  // }
}

function buildSort(sort) {
  let sortString = '';

  const sortSize = _.size(sort);
  if (sortSize) {
    sortString += 'ORDER BY ';
  } else {
    return sortString;
  }

  let index = 0;
  _.each(sort, (s, k) => {
    index++;
    sortString += `"${k}" ${s}${index < sortSize ? ', ' : ''}`;
  });
  return sortString;
}

function getDomainSchema(domain) {
  const result =
    (domain || {}).node_schema || process.env.SITE_SCHEMA || 'nodes';
  return result;
}

function getSchemaName(schema) {
  if (schema.is_asset) {
    return process.env.SITE_SCHEMA_ASSETS || 'assets';
  }
  const nodesSchema = process.env.SITE_SCHEMA || 'nodes';
  const userSchema = process.env.SITE_SCHEMA_USERS || 'users';
  const fallbackSchema = schema.user_assigned ? userSchema : nodesSchema;

  return (
    schema.domain_schema || (schema.domain || {}).node_schema || fallbackSchema
  );
}

function tableNameForQuery(schema) {
  const schema_name = getSchemaName(schema);
  return `"${schema_name}"."${schema.name}"`;
}

function getKnexWithSchema(schema) {
  const knex = sails.models.knex;
  return knex(`${getSchemaName(schema)}.${schema.name}`); // .withSchema(getSchemaName(schema));//.table(schema.name);
}

function hasTable(schema) {
  const knex = sails.models.knex;
  return knex.schema
    .withSchema(`${getSchemaName(schema)}`)
    .hasTable(schema.name);
}

async function createView(values) {
  const schemaName = SqlUtil.getSchemaName(values);
  const sql = escape(
    `CREATE VIEW ${schemaName}.%s AS %s`,
    values.name,
    values.derivative_statement
  );
  const knex = sails.models.knex;

  knex.schema
    .withSchema(schemaName)
    .raw(sql)
    .then(exists => {
      return exists;
    });
}

async function findSchemaView(schemaName, name) {
  const sql = escape(
    'SELECT EXISTS (\n' +
      '   SELECT 1\n' +
      '   FROM   pg_catalog.pg_class c\n' +
      '   JOIN   pg_catalog.pg_namespace n ON n.oid = c.relnamespace\n' +
      "   WHERE  n.nspname = '%s'\n" +
      "   AND    c.relname = '%s'" +
      "   AND    c.relkind = 'v')",
    schemaName,
    name
  );
  const knex = sails.models.knex;
  const sqlResult = await knex.schema.withSchema(schemaName).raw(sql);
  return new Promise(function(resolve) {
    if (
      sqlResult.rowCount &&
      sqlResult.rowCount === 1 &&
      sqlResult.rows[0].exists === true
    ) {
      resolve(true);
    } else {
      resolve(false);
    }
  });
}

async function hasView(schema) {
  // for the column relkind, v is for views, r is for tables
  const schemaName = getSchemaName(schema);
  return findSchemaView(schemaName, schema.name);
}

async function hasTableOrView(schema) {
  if (schema.derivative) {
    return await hasView(schema);
  } else {
    return await hasTable(schema);
  }
}

function createSchemaFail(schemaName, cb) {
  const schema = schemaName;
  const connection = (sails.config.models || {}).connection;
  const credentials = sails.config.connections[connection];
  const query = sails.models.knex.schema.raw(
    'CREATE SCHEMA "' + schema + '" AUTHORIZATION "' + credentials.user + '"'
  );
  query
    .then(schema => {
      cb(null, schema);
    })
    .catch(cb);
}

function createSchema(schemaName, cb) {
  const schema = schemaName;
  const connection = (sails.config.models || {}).connection;
  const credentials = sails.config.connections[connection];
  const query = sails.models.knex.schema.raw(
    'CREATE SCHEMA IF NOT EXISTS "' +
      schema +
      '" AUTHORIZATION "' +
      credentials.user +
      '"'
  );
  query
    .then(schema => {
      cb(null, schema);
    })
    .catch(cb);
}

/*
 * Swaps the value to a date for postgres
 */
function transformValue(value, strict) {
  if (isDate(value)) {
    value = convertToDate(value, strict);
  } else if (value != null && Utils.isFloat(parseFloat(value))) {
    value = parseFloat(value);
  } else if (value != null && Utils.isInteger(parseInt(value))) {
    value = parseInt(value);
  }
  return value;
}

function convertToDate(value, retain) {
  const dateString = moment(value)
    .tz(tz)
    .format('MM-DD-YYYY HH:mm:ssz');
  if (retain) {
    return dateString;
  }
  return dateString.replace('+', '#');
}

function isDate(value) {
  if (Utils.isNumber(value) || !isNaN(value)) {
    return false;
  }

  if (
    value != null &&
    _lo.isString(value) &&
    !_lo.isFinite(value) &&
    moment(new Date(value)).isValid()
  ) {
    return true;
  }

  return false;
}

/*
 * Applies to date queries
 */
function transformSuffix(value) {
  let suffix = '';
  if (isDate(value)) {
    suffix = `::timestamp WITH TIME ZONE AT TIME ZONE '${tz}'`;
  }
  return suffix;
}
/*
 * Applies to date and number queries
 */
function transformPrefix(value) {
  let prefix = ')';
  if (isDate(value)) {
    prefix = `::timestamp WITH TIME ZONE AT TIME ZONE '${tz}')::DATE`;
  } else if (value != null && Utils.isFloat(parseFloat(value))) {
    prefix = ')::NUMERIC';
  } else if (value != null && Utils.isInteger(parseInt(value))) {
    prefix = ')::NUMERIC';
  }

  return prefix;
}

function buildSpreadQueryString(paramName, values) {
  const size = _.size(values);
  if (!size) {
    return '';
  }
  const pName = paramName.replace('(', '');
  const qTemplate = `ANY ( REPLACE(REPLACE( %s ::TEXT, ']', '}' ), '[', '{' )::TEXT[] )`;
  let send = '(';
  for (let i = 0; i < size; i++) {
    const value = values[i];
    send += `${value}::TEXT = ${escape(qTemplate, pName)}`;
    if (i < size - 1) {
      send += ' OR ';
    }
  }
  send += ')';
  return send;
}

/*
 * buildWhereString
 *
 * Builds a postgres query string from a where object
 * It would be in the form (model.foo > bar AND model.foo <= 10000);
 *
 * @param {Object} where - there where value
 * @return {String} - the postgres where query part
 */

function recurseString(v, k, strict) {
  let joined = '';
  const value = v == null ? 'NULL' : v;
  switch (k) {
    // case 'spread':
    //   break;

    case 'in':
      joined += ')';
      joined += escape(' in (%s)', v.join(','));
      break;
    case 'startsWith':
      joined += ')';
      joined += escape(' ILIKE %L', transformValue(value, strict) + '%');
      break;
    case 'between':
      // if (value && _.isString(value.from) && _.isString(value.to) && moment(new Date(value.from)).isValid() && moment(new Date(value.to)).isValid()) {
      if (isDate(value.from) && isDate(value.to)) {
        joined += escape(
          `::timestamp WITH TIME ZONE AT TIME ZONE '${tz}')::DATE BETWEEN (%L::timestamp WITH TIME ZONE AT TIME ZONE '${tz}')::DATE AND (%L::timestamp WITH TIME ZONE AT TIME ZONE '${tz}')::DATE`,
          // "::timestamp WITH TIME ZONE::DATE BETWEEN %L::timestamp WITH TIME ZONE::DATE AND %L::timestamp WITH TIME ZONE::DATE",
          // `::timestamp WITH TIME ZONE AT TIME ZONE '${tz}' BETWEEN %L::timestamp AND %L::timestamp `,
          '' + transformValue(value.from, strict),
          '' + transformValue(value.to, strict)
        );
      } else {
        joined += escape(
          ') BETWEEN %L AND %L',
          '' + transformValue(value.from, strict),
          '' + transformValue(value.to, strict)
        );
      }

      break;
    case 'contains':
      // transformValue(value)
      joined += escape(') ILIKE %L', '%' + value + '%');
      break;
    case '<=':
      joined += escape(
        transformPrefix(value) + ' <= %L' + transformSuffix(value),
        '' + transformValue(value, strict)
      );
      break;
    case '<':
      joined += escape(
        transformPrefix(value) + ' < %L' + transformSuffix(value),
        '' + transformValue(value, strict)
      );
      break;
    case '>=':
      joined += escape(
        transformPrefix(value) + ' >= %L' + transformSuffix(value),
        '' + transformValue(value, strict)
      );
      break;
    case '>':
      joined += escape(
        transformPrefix(value) + ' > %L' + transformSuffix(value),
        '' + transformValue(value, strict)
      );
      break;
    case '!':
      if (isDate(value)) {
        joined += escape(
          `::timestamp WITH TIME ZONE AT TIME ZONE '${tz}')::DATE <> (%L::timestamp WITH TIME ZONE AT TIME ZONE '${tz}')::DATE`,
          '' + convertToDate(value, strict)
        );
      } else {
        joined += escape(
          ') ' +
            (value == 'NULL' ? 'NOT' : '<> ') +
            (value == 'NULL' ? '%s' : '%L'),
          '' + value
        );
      }
      break;
    default:
      if (isDate(value)) {
        joined += escape(
          `::timestamp WITH TIME ZONE AT TIME ZONE '${tz}')::DATE = (%L::timestamp WITH TIME ZONE AT TIME ZONE '${tz}')::DATE`,
          // "::timestamp WITH TIME ZONE::DATE = %L::timestamp WITH TIME ZONE::DATE",
          '' + convertToDate(value, strict)
        );
      } else {
        if (v == null) {
          joined += escape(') %s', `IS ${value}`);
        } else {
          joined += escape(') = %L', '' + value);
        }
      }
  }

  return joined;
}

function joinParts(key, strict) {
  const parts = (key || '').split('.');
  for (let i = strict ? 0 : 1; i < parts.length; i++) {
    parts[i] =
      i === 0
        ? `"${parts[i].replace('+^', `"+^`)}${
            _.contains(parts[i], '+^') ? '' : `"`
          }`
        : "'" + parts[i] + "'";
  }
  return parts;
}

function avoidKeys(key) {
  const avoid = ['in', 'or', 'spread'];
  return _.indexOf(avoid, key) !== -1;
}

function isValidTypeArray(value, key) {
  return _.isArray(value) && !avoidKeys(key);
}

function isTypeOr(value, key) {
  return key === 'or' && _.isArray(value);
}

function isTypeNestedObject(value, key) {
  const breakKey = getBreakKey(key);
  return _.isObject(value) && _.size(breakKey) >= 2;
}

function extendWhereValueObject(value, key) {
  if (!_.isObject(value) || _.isArray(value)) {
    const hold = _.clone(value);
    value = {};
    value[key] = hold;
  }
  return value;
}

function getBreakKey(key) {
  const breakKey = (key || '').split('*');
  return breakKey;
}

function buildBreak(value, key, joined) {
  const breakKey = getBreakKey(key);
  if (_.size(breakKey) >= 2) {
    const take = {};
    const _key = breakKey[0] + '^';
    const hold = _.clone(value);
    take[_key] = {};
    take[_key][breakKey[1].replace('^', '')] = hold;
    value = take;
    return joined.replace('*' + breakKey[1], '') + '^';
  }
  return joined;
}

function isTypeSpread(key) {
  return key === 'spread';
}

function setNestedObject(value, strict) {
  let joined = '';
  _.each(value, function(r, m) {
    joined += recurseString(r, m, strict) + ' ';
  });
  return joined;
}

function setColAttributes(key, strict) {
  const parts = joinParts(key, strict);
  const col = parts.splice(0, 1);
  const queryCol = `+^${col}^${
    _.size(parts) ? `->>${parts.join('->>')}` : ''
  }  `;
  return queryCol;
}

function basicOrReplacementCol(or, iKey, key, queryCol, strict) {
  const replacement =
    '((' +
    key.replace(
      '+^or^',
      `${queryCol}` + recurseString(or, iKey, strict) + ') '
    );
  return replacement;
}

function handleOrCol(or, key, queryCol, strict) {
  let replacement = '';
  let e = 0;
  _.each(or, (val, k) => {
    replacement += basicOrReplacementCol(val, k, key, queryCol, strict);
    e++;
    if (e < _.size(or)) {
      replacement += 'AND ';
    }
  });
  return replacement;
}

function setOrElements(value, key, strict) {
  let replacement = '';

  for (let i = 0; i < _.size(value); i++) {
    const or = value[i];
    let j = 0;
    for (const k in or) {
      const o = or[k];
      const queryCol = setColAttributes(k, strict);
      if (_.isObject(o)) {
        replacement += handleOrCol(o, key, queryCol, strict);
      } else {
        replacement += basicOrReplacementCol(o, k, key, queryCol, strict);
      }

      if (j < _.size(or) - 1) {
        replacement += 'AND ';
      }
      j++;
    }
    if (i < _.size(value) - 1) {
      replacement += 'OR ';
    }
  }

  return replacement;
}

function concatJoin(value, key, joined, index, size, strict) {
  for (const k in value) {
    const v = value[k];
    if (isTypeSpread(k)) {
      joined = buildSpreadQueryString(joined, v);
    } else if (isValidTypeArray(v, k)) {
      joined += escape(" @> '{%s}')", v.join(','));
    } else if (isTypeOr(v, k)) {
      const replacement = setOrElements(v, key, strict);
      joined = joined.replace(key, replacement + ')');
    } else if (isTypeNestedObject(v, k)) {
      joined += setNestedObject(value, strict);
    } else {
      joined += recurseString(v, k, strict);
    }
  }

  if (index < size) {
    joined += ' AND ';
  } else {
    joined += ' ';
  }

  return joined;
}

function whereParseCycle(where, strict) {
  const size = _.size(where) - 1;
  let index = 0;
  let concat = '';
  for (const key in where) {
    let value = _.clone(where[key]);
    let joined = '(';
    const parts = joinParts(key, strict);
    joined += parts.join('->>');
    joined = buildBreak(value, key, joined);
    value = extendWhereValueObject(value, key);
    concat += concatJoin(value, key, joined, index, size, strict);
    index++;
  }
  return concat;
}
/**
 *
 * @param {*} where the object being parsed and converted to sql string
 * @param {*} strict boolean value for strict parsing
 * @returns string concatenated sql query string
 */
function buildWhereString(where, strict) {
  if (_.isString(where)) {
    where = JSON.parse(where);
  }

  findBetween(where);
  const concat = whereParseCycle(where, strict);
  return concat;
}

function generateOrQueryString(or) {
  const orSize = _.size(or);
  let queryString = ``;
  _.each(or, (o, i) => {
    const elementSize = _.size(o);
    let index = 0;
    _.each(o, (val, key) => {
      queryString += `"${key}" `;
      if (_.isObject(val)) {
        _.each(val, (v, k) => {
          switch (k) {
            case 'contains':
              queryString += ` ILIKE '%${v}%' `;
              break;
            case 'startsWith':
              queryString += ` ILIKE '%${v}' `;
              break;
            case '<':
              queryString += ` < ${v} `;
              break;
            case '<=':
              queryString += ` <= ${v} `;
              break;
            case '>':
              queryString += ` > ${v} `;
              break;
            case '>=':
              queryString += ` >= ${v} `;
              break;
          }
        });
      } else {
        queryString += ` = ${val} `;
      }
      index++;
      if (index < elementSize) {
        queryString += ` AND `;
      }
    });

    if (i < orSize - 1) {
      queryString += ` OR `;
    }
  });

  return queryString;
}

/*
 * findBetween
 *
 * Finds a between clause from the
 * where object from a query
 *
 * @param {Object} where - there where value
 */

function findBetween(where) {
  _.each(where, function(w, key) {
    if (_.isObject(w)) {
      const keys = _.keys(w);
      if (_.indexOf(keys, '>=') != -1 && _.indexOf(keys, '<=') != -1) {
        where[key] = {
          between: {
            from: w['>='],
            to: w['<=']
          }
        };
      }
    }
  });
}

function setVirtualWhere(vConfig, query) {
  const span = vConfig.span;
  const station = vConfig.station;
  const span_value = SqlUtil.convertToDate(vConfig.span_value, true);
  const interval = vConfig.interval;
  const over = vConfig.over;
  const scale = vConfig.scale;
  let where = escape('"station" = %s', station);
  const intervals = ['year', 'month', 'day', 'hour', 'minute', 'limit'];
  const index = _.indexOf(intervals, interval);

  if (interval === 'forever' || index === -1) {
    query.whereRaw(where);
    return query;
  }

  if (interval === 'limit') {
    where += ` AND "${span}" IS NOT NULL`;
    const alteredWhere = `${where} ORDER BY "${span}" DESC LIMIT ${scale}`;
    query.whereRaw(alteredWhere);
    return query;
  }

  where += ' AND ';
  if (over && scale) {
    where += `"${span}" AT TIME ZONE '${tz}' > ('${span_value}' AT TIME ZONE '${tz}' - interval '${scale} ${interval}') AND "${span}" AT TIME ZONE  '${tz}' <= ('${span_value}' AT TIME ZONE '${tz}')`;
  } else {
    for (let i = 0; i < index; i++) {
      const int = intervals[i];
      where += `EXTRACT(${int} FROM  "${span}" AT TIME ZONE '${tz}') = EXTRACT(${int} FROM '${span_value}' AT TIME ZONE '${tz}') AND `;
    }
    where += `EXTRACT(${interval} FROM "${span}" AT TIME ZONE '${tz}') = EXTRACT(${interval} FROM '${span_value}' AT TIME ZONE '${tz}')`;
  }
  query.whereRaw(where);
  return query;
}

module.exports = {
  buildSpreadQueryString,
  buildSort,
  generateOrQueryString,
  setVirtualWhere,
  escapeUtil,
  setInString,
  formatDomainQuery,
  getDomainSchema,
  hasTable,
  buildWhereString,
  isDate,
  createSchema,
  createSchemaFail,
  getKnexWithSchema,
  getSchemaName,
  transformValue,
  hasTableOrView,
  hasView,
  findSchemaView,
  createView,
  getIsNull,
  convertToDate,
  SetQueryString,
  tableNameForQuery
};
