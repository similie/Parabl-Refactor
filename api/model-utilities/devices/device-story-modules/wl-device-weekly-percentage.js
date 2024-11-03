const { SqlUtils, CommonUtils, TimeUtils } = require('similie-api-services');
const now_ = TimeUtils.constants.now_;
const TimePeriod = TimeUtils.constants.ENUMS.timePeriods;
const { WLDeviceManager } = require('./wl-device-module');
class WLDeviceWeeklyPercentage {
  context = null;
  static QUERY_STRING = `
  WITH last_week AS ( SELECT ( now( ) - ( INTERVAL '7 Days' ) ) :: DATE AS last_week ),
  last_year AS ( SELECT ( now( ) - ( INTERVAL '1 year' ) ) :: DATE AS last_year ),
  last_year_week AS ( SELECT ( ( now( ) - ( INTERVAL '7 Days' ) ) - ( INTERVAL '1 year' ) ) :: DATE AS last_year_week ) SELECT
  ROUND( AVG ( "%wl_percent%" ) )::NUMERIC as "average_full",
  EXTRACT ( YEAR FROM "%wl_date%" ) AS "year",
  EXTRACT ( DAY FROM "%wl_date%" ) AS "day",
  "%wl_date%" :: DATE AS "date",
  to_char( "%wl_date%", 'Day' ) AS "day_of_week" 
  FROM
      %s
  WHERE
      "station" = %s 
      AND ("%wl_date%" :: DATE > ( TABLE last_week ) OR (
              "%wl_date%" :: DATE > ( TABLE last_year_week ) 
          AND "%wl_date%" :: DATE <= ( TABLE last_year ) 
    ) )
  GROUP BY
      2,
      3,
      4,
      5 
  ORDER BY
      "year" ASC,
      "date" ASC 
  `;

  min = -1;
  max = -1;
  nCache = {};
  lCache = {};
  constructor(context) {
    this.context = context;
  }

  async procesQuery(params, nodeschema) {
    const station = this.context.station || null;
    if (!station) {
      return [];
    }
    const qString = CommonUtils.parseLocals(
      WLDeviceWeeklyPercentage.QUERY_STRING,
      params
    );
    const table = Node.getStringTableNameWithSchema(nodeschema);
    const escape = SqlUtils.escapeUtil();
    const query = escape(qString, table, station);
    const results = await Model.queryAsync(query);
    return results.rows;
  }

  getSize(obj) {
    return Object.keys(obj).length;
  }

  isNext(obj) {
    return this.getSize(obj) >= 1;
  }

  applyFill(result, year) {
    const dString = TimeUtils.formattedDate(
      result.date,
      TimeUtils.constants.formats.Date.full
    );

    const send = {
      fill: result.average_full,
      date: dString.replace(`, ${year}`, ''),
      dayOfWeek: `labels.${result.day_of_week.trimEnd().toUpperCase()}`,
      year: result.year
    };
    return send;
  }

  isThisYear(date) {
    return TimeUtils.date(now_)
      .hasSame(TimePeriod.years)
      .as(date);
  }

  setMinMax(val) {
    const day = parseInt(val);
    if (this.min === -1 || day < this.min) {
      this.min = day;
    }

    if (this.max === -1 || day > this.max) {
      this.max = day;
    }
  }

  applyValues(results) {
    const values = {};
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const thisYear = this.isThisYear(result.date);
      const yearFormatted = thisYear ? 'this_year' : 'last_year';
      const day = result.day;
      this.setMinMax(day);
      const year = result.year;
      values[day] = values[day] || {};
      values[day][yearFormatted] = this.applyFill(result, year);
    }
    return values;
  }

  getParamSet(ns, cb) {
    const others = ['wl_date', 'wl_percent'];
    for (let i = 0; i < others.length; i++) {
      const other = others[i];
      const param = this.wlDevice.getMetaParam(other, ns);
      if (param) {
        cb(param, other);
      }
    }
  }

  getParams(ns) {
    const params = {};
    const rOther = this.getParamSet.bind(this);
    let count = 0;
    rOther(ns, (param, key) => {
      params[key] = param;
      count++;
    });

    return count ? params : null;
  }

  sendDataToArray(values) {
    const send = [];
    for (const year in values) {
      const val = values[year];
      send.push(val);
    }
    return send;
  }

  applyLabelValues(label = '', arr = []) {
    if (this.lCache[label]) {
      return;
    }
    this.lCache[label] = true;
    arr.push(label);
  }

  findYearLabel(year, arr) {
    const sLabel =
      year === 'last_year' ? 'labels.LAST_YEAR' : 'labels.THIS_WEEK';
    this.applyLabelValues(sLabel, arr);
  }

  applyDateLabels(date, arr) {
    const _d = date;

    this.applyLabelValues(_d, arr);
  }

  findNextValue(values, next) {
    let found = null;
    let vals = null;
    if (next > this.max) {
      return this.min;
    } else {
      vals = values[next];
    }
    if (vals) {
      found = next + 1;
    }
    return found;
  }

  isOverlap(max, min) {
    return max - min >= 8;
  }

  findNewMin(values, start) {
    const size = this.getSize(values);
    // 34
    let lower = start;
    // let
    for (let i = 0; i < size; i++) {
      const dayValues = values[lower];
      if (this.isOverlap(lower, this.min) && dayValues) {
        lower--;
      } else if (dayValues) {
        break;
      } else {
        // send it back up, because its not this
        lower++;
        break;
      }
    }
    return lower;
  }

  findNewMax(values, start) {
    const size = this.getSize(values);

    // 34
    let upper = start;

    for (let i = 0; i < size; i++) {
      const dayValues = values[upper];
      if (!this.isOverlap(upper, this.min) && dayValues) {
        upper++;
      } else if (dayValues) {
        break;
      } else {
        // send it back up, because its not this
        upper--;
        break;
      }
    }
    return upper;
  }

  getKeysForBuild(values) {
    const keys = [];
    let min = this.min;
    // const lastMax = this.min;
    if (this.isOverlap(this.max, this.min)) {
      min = this.findNewMin(values, this.max);
    }
    let next = min;
    let i = 0;
    const FAIL_SAFE = 20;
    while (next != null && i < FAIL_SAFE) {
      // [sg] only unique keys?? if (!keys.includes(next)) keys.push(next);
      // keys.push(next);
      if (!keys.includes(next)) keys.push(next);
      next = this.findNextValue(values, next);
      i++;
    }
    // [sg] currently always returns FAIL_SAFE elements, repeating keys from
    // min-max as necessary to pad the array. Could return _.unique(keys) or
    // only add unique keys in the while loop? (see comment above in while)
    return keys;
  }

  stuffIntoArrays(values) {
    const hold = {};
    const labels = [];
    const series = [];
    const keys = this.getKeysForBuild(values);
    for (let i = 0; i < keys.length; i++) {
      const day = keys[i];
      const attrs = values[day];
      for (const year in attrs) {
        const attr = attrs[year];
        hold[year] = hold[year] || [];
        hold[year].push(parseInt(attr.fill));
        this.findYearLabel(year, series);
        if (year === 'last_year') {
          // if last year, just show Monday, Tuesday etc
          this.applyLabelValues(attr.dayOfWeek, labels);
        } else {
          // if last week, show the dates: mmm dd
          this.applyLabelValues(attr.date, labels);
        }
      }
    }
    const data = this.sendDataToArray(hold);

    return {
      labels,
      series,
      data
    };
  }

  async cycleParams(schemas) {
    const params = {};
    for (let i = 0; i < schemas.length; i++) {
      const schema = schemas[i];
      const schemaId = StationSchema.getId(schema);
      const nodes = await StationSchema.getNodes(schema);
      for (let j = 0; j < nodes.length; j++) {
        const nId = nodes[j];
        const node = this.nCache[nId] || (await NodeSchema.findOneById(nId));
        this.nCache[nId] = node;
        const param = this.getParams(node);

        if (param) {
          const results = await this.procesQuery(param, node);
          const values = this.applyValues(results);
          // const meta = this.getParamForMeta(param, node);
          params[schemaId] = {};
          params[schemaId].name = schema.name;
          params[schemaId][nId] = {};
          params[schemaId][nId].values = values;
          params[schemaId][nId].chart = this.stuffIntoArrays(values);
          params[schemaId][nId].label = node.title;
          params[schemaId][nId].name = node.name;
          params[schemaId][nId].nodeschema = nId;
        }
      }
    }
    return params;
  }

  async process() {
    this.wlDevice = new WLDeviceManager(this.context);
    const schemas = await this.wlDevice.getSchemasFromContext();
    const params = await this.cycleParams(schemas);
    return params;
  }
}

module.exports = { WLDeviceWeeklyPercentage };
