const csv = require('csv');
const commonUtils = require('../../utils/common');
const xlsx = require('async-xlsx');
const stream = require('stream');
const a_sync = require('async');
const { TimeUtils } = require('similie-api-services');
const xlsxNode = require('node-xlsx');

/**
 * Splits a key on a dot and retrieves the corresponding value from a row.
 * @param {string} key - The key to split.
 * @param {Object} row - The row object to retrieve the value from.
 * @returns {string} - The value from the row corresponding to the split key.
 */
const headerSplitOnDot = (key = '', row) => {
  const split = key.split('.');
  return (row[split[0]] || {})[split[1]] || '';
};

/**
 * Splits a key against a cell and returns the corresponding cell value.
 * @param {string} key - The key to split.
 * @param {Object} row - The row object to retrieve the value from.
 * @param {Object} [params={ var_cache: {} }] - Additional parameters.
 * @returns {string} - The cell value.
 */
const splitKeyAgainstCell = (key, row, params = { var_cache: {} }) => {
  const value = headerSplitOnDot(key, row);
  let cell = '';
  if (commonUtils.isBoolean(value)) {
    cell = value ? params.var_cache.YES : params.var_cache.NO;
  } else if (commonUtils.isUndefined(value) || value === null) {
    cell = ((params || {}).var_cache || {}).NULL || 'NULL';
  } else {
    cell = value;
  }
  return cell || '';
};

/**
 * Parses a CSV model from a request and processes it.
 * @param {Object} req - The request object.
 * @param {Object} res - The response object.
 * @param {string} model - The model to parse.
 */
function parseCSVModel(req, res, model) {
  req.file('file').upload(sails.config.skipper, function(err, files) {
    if (err) {
      sails.log.error(err);
      return res.serverError(err);
    }

    if (!files || commonUtils.isEmpty(files)) {
      return res.badRequest();
    }

    const file = files[0];
    const params = req.params.all();
    if (!params.socket) {
      return res.badRequest();
    }

    const socketId = params.socket;
    Jobs.processCSV.add({
      model: model,
      csv: csv,
      file: file,
      socket: socketId,
      station: params.station,
      user: req.user.id,
      system: true
    });

    res.ok();
  });
}

/**
 * Parses a CSV file from a request and processes it.
 * @param {Object} req - The request object.
 * @param {Object} res - The response object.
 * @param {string} model - The model to parse.
 */
function parseCSV(req, res, model) {
  req.file('file').upload(sails.config.skipper, function(err, files) {
    if (err) {
      sails.log.error(err);
      return res.serverError(err);
    }

    if (!files || commonUtils.isEmpty(files)) {
      return res.badRequest();
    }

    const file = files[0];

    const params = req.params.all();

    // params.socket = params.socket;

    if (!params.socket) {
      return res.badRequest();
    }

    const socketId = params.socket;

    Jobs.processCSV.add({
      model: model,
      csv: csv,
      file: file,
      socket: socketId,
      station: params.station,
      user: req.user.id
    });

    res.ok();
  });
}

/**
 * Pulls a model template and sends it as a CSV file.
 * @param {Object} res - The response object.
 * @param {string} model - The model to pull the template for.
 */
function pullModelTemplate(res, model) {
  // var parser = csv.parse();

  const schema = commonUtils.clone(sails.models[model]._attributes);
  let keys = commonUtils.keys(schema);
  const translate = (sails.models[model].translateKey || commonUtils.noop)() || '';

  if (commonUtils.contains(keys, 'geo') && sails.models[model].geo) {
    keys = commonUtils.union(keys, sails.models[model].geo());
  }

  commonUtils.remove(keys, function(k) {
    return (
      [
        'observer',
        'contact',
        'createdAt',
        'geo',
        'updatedAt',
        'id',
        'meta',
        'station',
        translate
      ].indexOf(k) > -1
    );
  });

  if (translate) {
    const languages = (res.locals.siteData || {}).languages;

    commonUtils.each(languages, function(l) {
      keys.unshift(translate + '.' + l);
    });
  }

  const input = [keys];
  const csv = require('csv');

  csv.stringify(input, function(err, output) {
    if (err) {
      sails.log.error(err);
      return res.negotiate(err);
    }

    if (!output) {
      return res.badRequest('errors.NO_FILE_FOUND');
    }

    const buff = Buffer.from(output);

    res.set({
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="' + model + '.csv' + '"',
      'Content-Length': buff.byteLength,
      'Transfer-Encoding': 'chunked'
    });

    res.send(buff);
  });
}

/**
 * Pulls a template and sends it as a CSV file.
 * @param {Object} res - The response object.
 * @param {string} model - The model to pull the template for.
 */
function pullTemplate(res, model) {
  const s = commonUtils.clone(model.schema);
  const schema = commonUtils.filter(s, function(sc) {
    return sc.active;
  });
  const keys = commonUtils.pluck(schema, 'name');
  // this is the translated key

  commonUtils.remove(keys, function(k) {
    return (
      [
        'observer',
        'contact',
        'createdAt',
        'updatedAt',
        'id',
        'meta',
        'data_upload',
        'approved_by'
      ].indexOf(k) > -1
    );
  });

  const insert = ['observer', 'station', 'tags'];

  if (model.has_point) {
    insert.push('point.lat');
    insert.push('point.lng');
  }

  commonUtils.each(insert, function(i) {
    keys.push(i);
  });

  const input = [keys];

  csv.stringify(input, function(err, output) {
    if (err) {
      sails.log.error(err);
      return res.negotiate(err);
    }

    if (!output) {
      return res.badRequest('errors.NO_FILE_FOUND');
    }

    const buff = Buffer.from(output);

    res.set({
      'Content-Type': 'text/csv',
      'Content-Disposition':
        'attachment; filename="' + model.name + '.csv' + '"',
      'Content-Length': buff.byteLength,
      'Transfer-Encoding': 'chunked'
    });

    res.send(buff);
  });
}

const now_ = TimeUtils.constants.now_;
const Formats = TimeUtils.constants.formats;

const SkipperAdapter = sails.config.skipper.adapter;
const fileAdapter = SkipperAdapter(sails.config.skipper);

/**
 * Sets a null cell value based on a key and row.
 * @param {string} key - The key to use.
 * @param {Object} row - The row object.
 * @param {Object} [params={ var_cache: {} }] - Additional parameters.
 * @returns {string} - The cell value.
 */
const setNullCell = (key, row, params = { var_cache: {} }) => {
  const value = headerSplitOnDot(key, row);
  let cell = value;
  if (typeof value === 'undefined' || value === null) {
    cell = params.var_cache.NULL;
  }
  return cell;
};

/**
 * Generates headers for CSV rows based on attributes and translation keys.
 * @param {Array} rows - The rows to add headers to.
 * @param {Object} attributes - The attributes to use for headers.
 * @param {Function} translateKeys - Function to translate keys.
 * @returns {Function} - A callback function to generate headers.
 */
const headers = function(rows, attributes, translateKeys) {
  return function(cb) {
    const headers = [];
    for (const key in attributes) {
      const header = translateKeys(key); // translations[key];
      if (commonUtils.isObject(header)) {
        for (const k in header) {
          const head = translateKeys(k, header);
          headers.push(head);
        }
      } else if (!Translates.restrictedKey(key)) {
        headers.push(header); // header[language]);
      }
    }
    rows.push(headers);
    cb();
  };
}

/**
 * Places data into rows based on models, attributes, and other parameters.
 * @param {Array} models - The models to process.
 * @param {Object} attributes - The attributes to use.
 * @param {Function} translateKeys - Function to translate keys.
 * @param {Object} variables - Variables to use in processing.
 * @param {Object} station - The station object.
 * @param {string} language - The language to use.
 * @param {Array} rows - The rows to place data into.
 * @returns {Function} - A callback function to place data.
 */
const placeData = function(
  models,
  attributes,
  translateKeys,
  variables,
  station,
  language,
  rows
) {
  return function(cb) {
    try {
      const linked = Utils.linkObject(variables);

      const attrTransformed = Utils.transformAttributes(attributes);
      let data = [];

      if (!commonUtils.isArray(models)) {
        data.push(models);
      } else {
        data = commonUtils.clone(models);
      }

      a_sync.forEachOf(
        data,
        function(model, _i, calling) {
          const contents = {};

          a_sync.forEachOf(
            attributes,
            function(value, key, callback) {
              const header = translateKeys(key);

              if (header) {
                const m = (model || {})[key];
                const dt = TimeUtils.date(m);

                switch (attrTransformed[key]) {
                  case 'variable':
                    contents[header] =
                      ((linked(m) || {} || {}).value || {})[
                        Translates.language(language)
                      ] || null;
                    break;
                  case 'datetime':
                    if (m) {
                      contents[header] = dt.toFormat(Formats.Date.medium);
                    } else {
                      contents[header] = null;
                    }
                    break;
                  case 'dates':
                    if (m) {
                      contents[header] = dt.toFormat(Formats.Date.medium);
                    } else {
                      contents[header] = null;
                    }
                    break;
                  case 'station':
                    contents[header] = (station || {}).station_id;
                    break;
                  case 'borehole_station':
                    contents[header] = (station || {}).station_id;
                    break;
                  default:
                    contents[header] = m == null ? null : m;
                }
              }

              callback();
            },
            function() {
              const tempRow = [];
              commonUtils.each(rows[0], function(head) {
                tempRow.push(contents[head]);
              });

              rows.push(tempRow);
              calling();
            }
          );
        },
        function() {
          cb();
        }
      );
    } catch (e) {
      sails.log.error('PROCSSING::EXCEL::ERROR', e);
      return cb(e);
    }
  };
}

/**
 * Puts data into a cell based on row, header, and other parameters.
 * @param {Object} row - The row object.
 * @param {Object} header - The header object.
 * @param {Object} params - Additional parameters.
 * @param {Object} station - The station object.
 * @param {Function} forward - Callback function to forward the cell value.
 */
const putData = function(row, header, params, station, forward) {
  let cell;
  const key = header.key;

  switch (header.type) {
    case 'integer':
      cell = row[key];
      break;
    case 'decimal':
      cell = row[key];
      break;
    case 'float':
      cell = row[key];
      break;
    case 'variable':
      cell =
        ((row[key] || {}).value || {})[params.language] ||
        ((row[key] || {}).value || {})[
          (params.config || {}).default_langage
        ] ||
        null;
      break;
    case 'boolean':
      cell = row[key] ? 'TRUE' : 'FALSE';
      break;
    case 'money':
      cell = row[key] ? row[key].currency + ' ' + row[key].value : '';
      break;
    case 'date':
      if (row[key]) {
        const p = commonUtils.where((params.schema || {}).schema || station.schema, {
          name: key
        });

        const dt = TimeUtils.date(row[key]);
        if (p.time || header.time) {
          cell = dt.toFormat(Formats.DateTime.fullAmPm);
        } else {
          cell = dt.toFormat(Formats.Date.full);
        }
      } else {
        cell = null;
      }
      break;
    case 'json':
      cell = splitKeyAgainstCell(key, row, params);
      break;
    case 'disaggregator':
      cell = cell || '';
      if (params.schema) {
        const p = commonUtils.where(params.schema.schema, { name: key });
        if (commonUtils.size(p)) {
          const param = p[0];
          let i = 0;
          const rowSize = commonUtils.size(row[key]);
          commonUtils.each(row[key], function(r, k) {
            // we want the translated name
            param.select_options.push({
              select_text: { en: 'Unknown' },
              name: '__unknown__'
            });
            const f = commonUtils.where(param.select_options, { name: k });
            if (r && commonUtils.size(f)) {
              const found = f[0];
              cell +=
                (((found || {}).select_text || {})[params.language] ||
                  ((found || {}).select_text || {})[
                    params.config.default_langage
                  ]) + (rowSize > 1 && i < rowSize - 1 ? ` ${r}, ` : ` ${r}`);
            } else if (k !== '__unknown__') {
              cell +=
                k +
                ' ' +
                (rowSize > 1 && i < rowSize - 1 ? ` ${r}, ` : ` ${r}`);
            }
            i++;
          });
          break;
        }
      }
      commonUtils.each(row[key], function(r, k) {
        cell += `*  ${k}  ${r} \n`;
      });
      break;
    case 'array':
      cell = cell || '';
      commonUtils.each(row[key], function(r) {
        cell += '* ' + r + '\n';
      });
      break;
    case 'node':
      // cell = row[key];
      break;
    case 'user':
      cell = cell || '';
      if (commonUtils.isArray(row[key])) {
        commonUtils.each(row[key], function(r) {
          cell += '* ' + User.fullName(r, '') + '\n';
        });
      } else {
        cell = User.fullName(row[key], '');
      }

      break;
    case 'alarms':
      if (!commonUtils.size(row[key])) {
        break;
      }
      cell = cell || '';
      commonUtils.each(row[key], function(val, key) {
        cell +=
          '* ' +
          key +
          (val.max ? ' ' + val.max : '') +
          (val.min ? ' ' + val.min : '');
      });
      break;
    case 'contact':
      if (!row[key]) {
        break;
      }
      return Contact.findOneById(row[key]).exec(function(err, contact) {
        if (err) {
          sails.log.error(err);
        }

        if (!contact) {
          return forward(null);
        }

        cell = User.fullName(contact, '') + ' ' + contact.organization;

        forward(cell);
      });

    case 'point':
      cell = headerSplitOnDot(header.key, row);
      break;
    case 'tags':
      commonUtils.each(row[key], function(val) {
        if (commonUtils.isObject(val)) {
          val = val.id;
        }
        const tag = commonUtils.where(params.tags, { id: val });
        cell = cell || '';
        if (tag && tag.length) {
          cell += '* ' + (tag[0] || {}).name + '\n';
        }
      });
      break;
    case 'station':
      cell = station.station_id;
      break;
    case 'calculator':
      cell = cell || '';
      if (row[key]) {
        cell = row[key].val;
      }

      break;
    case 'paragraphs':
      cell = setNullCell(key, row, params);
      break;
    case 'duration':
      const sprite = key.split('.');
      const t = (row[sprite[0]] || {})[sprite[1]] || 0; // .duration || 0;
      if (sprite[1] === 'duration') {
        const seconds = parseInt(t) / 1000;
        cell = TimeUtils.timeFormatFromSeconds(seconds);
      } else if (t !== 0) {
        cell = TimeUtils.formattedDate(t, Formats.DateTime.verboseAmPm);
      } else {
        cell = params.var_cache['NULL'];
      }
      // cell = mom_ent((row[key] || {}).start).tz(tz).format('LLLL') + ', ' + mom_ent((row[key] || {}).end).tz(tz).format('ll') + ', ' + time.hours + ':' + time.minutes + ':' + time.seconds;
      break;
    case 'filestory':
      const story = row[key] || {};
      cell = `${params.var_cache['TITLE']}: ${
        story.title ? story.title : params.var_cache['NULL']
      }, ${params.var_cache['DESCRIPTION']}: ${
        story.description ? story.description : params.var_cache['NULL']
      }`;
      break;
    case 'dimension':
      const streatch = key.split('.');
      const k = streatch[0];
      const val = streatch[1];
      const _v = (row[k] || {})[val];
      cell = _v;
      break;
    default:
      cell = row[key];
  }

  forward(cell);
}

/**
 * Strips rows from a station and processes them.
 * @param {Object} station - The station object.
 * @param {Array} headers - The headers to use.
 * @param {Object} params - Additional parameters.
 * @param {Function} next - Callback function to process the contents.
 */
const stripRows = function(station, headers, params, next) {
  const rows = station.fill;
  const contents = [];

  async.forEach(
    rows,
    function(row, go) {
      const hold = [];

      if (row.schema) {
        commonUtils.each(row.schema, function(r, key) {
          row[key] = r;
        });
        delete row.schema;
      }

      async.forEach(
        headers,
        function(header, forward) {
          putData(row, header, params, station, function(spill) {
            hold.push(spill);
            forward();
          });
        },
        function() {
          contents.push(hold);
          go();
        }
      );
    },
    function() {
      next(contents);
    }
  );
}

/**
 * Builds an Excel file for a station based on parameters.
 * @param {Object} params - The parameters to use.
 * @param {Function} next - Callback function to process the Excel file.
 */
const buildStationExcel = function(params, next) {
  /*
   * Pull the headers by iterating the stations.
   *
   * Get the Translated disclaimers. We need to use the replace function from EMAIL and then
   * we can create page <br/>.split
   *
   * Then draw the rows.
   */

  const schemes = params.schemes;
  const language = params.language;
  const variables = params.variables;
  const config = params.config;
  const disclaimerPage = Translates.disclaimer(
    language,
    variables,
    config
  ).model({ name: 'station' });

  const pages = [
    {
      name: disclaimerPage.disclaimerName,
      data: disclaimerPage.disclaimer
    }
  ];

  async.forEach(
    schemes,
    function(s, forward) {
      const fillers = s.fill;
      if (!commonUtils.size(fillers)) {
        return forward();
      }

      let headers = commonUtils.union(Station.schema(), commonUtils.sortBy(s.schema, 'weight'));
      const hVars = params.header_vars;

      headers = commonUtils.map(headers, function(head) {
        const found = commonUtils.where(hVars, { identity: head.label });
        const h = { key: head.key || head.name, type: head.type };
        if (found && found.length) {
          const f = found[0];
          h.name =
            f.value[language] ||
            f.value[config.default_language || Translates.fallbackLanguage];
        } else {
          h.name = head.label || head.name || head.key;
        }

        return h;
      });
      const tags = commonUtils.flatten(commonUtils.uniq(commonUtils.pluck(fillers, 'tags'), 'id'));

      const page = {
        name: s.name + ', ' + s.station_url,
        data: [commonUtils.pluck(headers, 'name')]
      };

      params.tags = tags;
      stripRows(s, headers, params, function(rows) {
        commonUtils.each(rows, function(row) {
          page.data.push(row);
        });

        pages.push(page);
        forward();
      });
    },
    function() {
      xlsx.buildAsync(pages, {}, function(error, xlsBuffer) {
        if (error) {
          return next({ error: 'errors.E_UNKNOWN' });
        }
        // Buffer is ready.
        const message = {
          report: xlsBuffer,
          name:
            'Stations' +
            '_output_' +
            TimeUtils.date(now_).toFormat(Formats.Date.medium) +
            '.xlsx',
          rows: 0, // rows.length,
          socket: params.socket
        };
        next(error, message);
      });
    }
  );
}

/**
 * Sets object headers based on a scheme, head, and other parameters.
 * @param {Object} scheme - The scheme object.
 * @param {Object} head - The head object.
 * @param {Array} objectHeaders - The object headers to set.
 * @param {string} language - The language to use.
 * @param {Object} varCache - Variable cache to use.
 * @param {string} type - The type of object.
 */
const setObjects = function(scheme, head, objectHeaders, language, varCache, type) {
  if (scheme) {
    commonUtils.each(scheme.select_options, s => {
      const jsonHead = {
        name: `${head.name}, ${s.select_text[language]}`,
        type: 'json',
        key: `${head.key}.${s.name}`
      };
      objectHeaders.push(jsonHead);
    });

    if (type === 'disaggregator') {
      objectHeaders.push({
        name: `${head.name}, ${varCache.__unknown__}`,
        type: 'json',
        key: `${head.key}.__unknown__`
      });
    } else if (type === 'dimension') {
      const dim = [
        {
          identity: 'dimension_length',
          fallback: 'L',
          attr: 'length'
        },
        {
          identity: 'dimension_width',
          fallback: 'W',
          attr: 'width'
        },
        {
          identity: 'dimensions_height',
          fallback: 'H',
          attr: 'height'
        },
        {
          identity: 'dimensions_weight',
          fallback: 'W',
          attr: 'weight'
        }
      ];

      commonUtils.each(dim, d => {
        objectHeaders.push({
          name: `${varCache[d.identity] || d.fallback}, ${head.name}`,
          type: 'dimension',
          key: `${head.key}.${d.attr}`
        });
      });
    }
  }
}

/**
 * Sets node headers based on parameters and metadata.
 * @param {Object} params - The parameters to use.
 * @param {Object} meta - The metadata to use.
 * @returns {Promise<Array>} - A promise that resolves to the object headers.
 */
const setNodeHeaders = async function(params, meta) {
  const schema = params.schema;
  const language = params.language;
  const config = params.config || {};
  let headers = [...params.schema.schema];
  if (commonUtils.size((meta || {}).add)) {
    // { key: 'sku', type: 'barcode', name: 'SKU' },
    commonUtils.each(meta.add, m => {
      headers.push({ key: '', type: '__SKIP__', name: m });
    });
  }
  if (!(meta || {}).strip) {
    headers.push(...(schema.derivative ? [] : Node.csvVars()));
  }
  const hVars = params.header_vars;
  commonUtils.remove(headers, function(h) {
    if (h.type === 'survey') {
      return !schema.survey;
    } else if (h.type === 'point') {
      return !schema.has_point;
    }
    return false;
  });

  headers = commonUtils.map(headers, function(head) {
    const found = commonUtils.where(hVars, { identity: head.label });
    const h = { key: head.key || head.name, type: head.type };

    if (head.time) {
      h.time = head.time;
    }

    if (found && found.length) {
      const f = found[0];
      h.name =
        f.value[language] ||
        f.value[config.default_langage || Translates.fallbackLanguage];
    } else {
      h.name = head.label || head.name || head.key;
    }

    return h;
  });
  const objectHeaders = [];
  for (let i = 0; i < commonUtils.size(headers); i++) {
    const head = headers[i];
    const scheme = params.schema_cache[head.key];
    switch (head.type) {
      case 'json':
        setObjects(
          scheme,
          head,
          objectHeaders,
          language,
          params.var_cache
        );
        break;
      case 'duration':
        // case 'money':
        commonUtils.each(['start', 'end', 'duration'], d => {
          objectHeaders.push({
            name: `${head.name}, ${params.var_cache[d]}`,
            type: 'duration',
            key: `${head.key}.${d}`
          });
        });
        break;
      case 'disaggregator':
        setObjects(
          scheme,
          head,
          objectHeaders,
          language,
          params.var_cache,
          'disaggregator'
        );
        break;
      case 'dimension':
        setObjects(
          scheme,
          head,
          objectHeaders,
          language,
          params.var_cache,
          'dimension'
        );
        break;
      case 'paragraphs':
        commonUtils.each(scheme.keys, (v, k) => {
          const setter = {
            name: `${head.name}, ${v}`,
            type: 'paragraphs',
            key: `${head.key}.${k}`
          };
          objectHeaders.push(setter);
        });

        break;
      default:
        objectHeaders.push(head);
    }
  }
  return objectHeaders;
}

/**
 * Builds a generic node Excel file based on parameters.
 * @param {Object} params - The parameters to use.
 * @param {Function} next - Callback function to process the Excel file.
 */
const buildGenericNodeExcel = async function(params, next) {
  /*
   * Pull the headers by iterating the stations.
   *
   * Get the Translated disclaimers. We need to use the replace function from EMAIL and then
   * we can create page <br/>.split
   *
   * Then draw the rows.
   */

  const schema = params.schema;
  params.schema_cache = {};

  commonUtils.each(schema.schema, function(s) {
    params.schema_cache[s.name] = s;
  });
  const query = params.query || {};
  const meta = commonUtils.clone(query.__meta) || {};
  delete query.__meta;
  const language = params.language;
  const variables = params.variables;

  params.var_cache = {};
  const csvVars = []; // commonUtils.where(variables, { key: "csv_variables" });
  const match = ['csv_variables', 'csv_dimensions'];
  commonUtils.each(variables, v => {
    if (commonUtils.indexOf(match, v.key) !== -1) {
      csvVars.push(v);
    }
  });

  commonUtils.each(csvVars, v => {
    params.var_cache[v.identity] = v.value[language];
  });

  const config = params.config;
  const disclaimerPage = Translates.disclaimer(
    language,
    variables,
    config
  ).model(schema);
  const headers = await setNodeHeaders(params, meta);
  const pages = [
    {
      name: disclaimerPage.disclaimerName,
      data: disclaimerPage.disclaimer
    }
  ];

  if (meta.noDisclaimer) {
    pages.pop();
  }

  async.forEach(
    params.stations,
    function(station, forward) {
      const page = {
        name: station.station_id + ' ' + schema.name,
        data: [commonUtils.pluck(headers, 'name')]
      };
      stripRows(station, headers, params, function(rows) {
        // page.data.push(rows);
        commonUtils.each(rows, function(row) {
          page.data.push(row);
        });
        pages.push(page);

        forward();
      });
    },
    function() {
      xlsx.buildAsync(pages, {}, function(error, xlsBuffer) {
        if (error) {
          return next('errors.E_UNKNOWN');
        }
        // Buffer is ready
        const message = {
          report: xlsBuffer,
          name:
            schema.name +
            '_output_' +
            TimeUtils.date(now_).toFormat(Formats.Date.medium) +
            '.xlsx',
          rows: 0, // rows.length,
          socket: params.socket
        };
        next(null, message);
      });
    }
  );
}

/**
 * Parses a model based on the request method.
 * @param {Object} req - The request object.
 * @param {Object} res - The response object.
 * @param {string} model - The model to parse.
 */
const parseModel = function(req, res, model) {
  const method = req.method;

  switch (method) {
    case 'GET':
      pullModelTemplate(res, model);
      break;
    case 'POST':
      parseCSVModel(req, res, model);
  }
}

/**
 * Parses a request based on the request method.
 * @param {Object} req - The request object.
 * @param {Object} res - The response object.
 * @param {string} model - The model to parse.
 */
const parse = function(req, res, model) {
  const method = req.method;

  switch (method) {
    case 'GET':
      pullTemplate(res, model);
      break;
    case 'POST':
      parseCSV(req, res, model);
      break;
    default:
  }
}

/**
 * Builds a CSV item based on columns, attributes, and a record.
 * @param {Object} item - The item to build.
 * @param {Array} columns - The columns to use.
 * @param {Object} attrTransformed - Transformed attributes.
 * @param {Array} record - The record to process.
 * @param {Object} ex_attributes - Extra attributes.
 * @returns {Function} - A function to process each column.
 */
const buildCSV = function(item, columns, attrTransformed, record, ex_attributes) {
  const stripInt = function(item, column, record, index, next) {
    try {
      const num = parseInt((record || '').replace(/[^0-9.-]/g, ''));

      if (num == null) {
        return next();
      }

      if (!commonUtils.isFinite(num)) {
        throw new Error('failed to parse');
      }

      item[column] = num;
    } catch (e) {
      return next({
        err: 'parseError',
        column: column,
        index: index,
        record: record[index]
      });
    }
    next();
  };

  const stripFloat = function(item, column, record, next) {
    try {
      const num = parseFloat((record || '').replace(/[^0-9.-]/g, ''));

      if (num == null) {
        return next();
      }

      if (!commonUtils.isFinite(num)) {
        throw new Error('failed to parse');
      }

      item[column] = num;
    } catch (e) {
      return next({
        err: 'parseError',
        column: column,
        record: record
      });
    }
    next();
  };

  return function(column, index, next) {
    // var index = columns.indexOf(column);
    // it is a string, so this will process the 0 value
    if (!record[index] || record[index] === 'undefined') {
      return next();
    }
    const protect = column;
    const transformed = column.split('.');

    if (transformed.length > 1) {
      column = transformed[0];
    }

    switch (attrTransformed[column]) {
      case 'duration':
        const time_split = record[index].split(',');

        if (commonUtils.size(transformed) <= 2) {
          item[column] = item[column] || {};

          const timePart = transformed[1];

          switch (timePart) {
            case 'date':
              item[column].meta = item[column].meta || {};
              item[column].meta.date = record[index];
              break;
            case 'time_start':
              item[column].meta = item[column].meta || {};
              item[column].meta.start = record[index];
              break;
            case 'time_end':
              item[column].meta = item[column].meta || {};
              item[column].meta.end = record[index];
              break;
            case 'date_start':
              item[column].start = new Date(record[index]);
              break;
            case 'date_end':
              item[column].end = new Date(record[index]);
              break;
          }

          if (item[column].meta) {
            const keys = ['start', 'end', 'date'];
            let complete = true;

            for (const k of keys) {
              if (!item[column].meta[k]) {
                complete = false;
                break;
              }
            }

            if (complete) {
              const startDate = new Date(
                item[column].meta.date + ' ' + item[column].meta.start
              );
              const endDate = new Date(
                item[column].meta.date + ' ' + item[column].meta.end
              );
              item[column].start = TimeUtils.isoFormattedDate(startDate);
              item[column].end = TimeUtils.isoFormattedDate(endDate);
              delete item[column].meta;
            }
          }
        } else if (commonUtils.size(time_split) === 1) {
          item[column] = {};
          item[column].start = new Date(time_split[0]);
          item[column].end = new Date(time_split[1]);
        }

        return next();
      case 'variable':
        Variable.find({ key: column }).exec(function(err, variables) {
          if (err) {
            return next(err);
          }

          let identity = record[index].toLowerCase();
          identity = identity.replaceAll(' ', '');

          let value = commonUtils.where(variables, { identity: identity })[0];
          if (!value) {
            commonUtils.each(variables, function(v) {
              if (v && v.meta && v.meta.map && v.meta.map) {
                let mapped = v.meta.map.toLowerCase();
                mapped = mapped.replaceAll(' ', '');
                if (mapped === identity) {
                  value = v;
                  return;
                }
              }
            });
          }

          item[column] = (value || {}).id;
          return next();
        });

        break;
      case 'float':
        return stripFloat(item, column, record[index], next);
      case 'decimal':
        return stripFloat(item, column, record[index], next);
      case 'integer':
        return stripInt(item, column, record[index], index, next);
      case 'string':
        item[column] = record[index];
        return next();
      case 'tracker':
        item[column] = record[index];
        return next();
      case 'text':
        item[column] = record[index];
        return next();
      case 'date':
        item[column] = new Date(record[index]);
        return next();
      case 'datetime':
        item[column] = new Date(record[index]);
        return next();
      case 'array':
        const arr = (record[index] || '').split(',');

        if (arr.length) {
          const save = [];

          commonUtils.each(arr, function(r, index) {
            if (r.match(/^[\-\+]?\d+$/)) {
              // valid integer
              save.push(parseInt(r));
            } else if (r.match(/^[\-\+]?\d+\.\d+$/)) {
              // valid float
              save.push(parseFloat(r));
            } else {
              save.push(r);
            }
          });

          item[column] = save;
        }

        return next();
      case 'json':
        const values = record[index].split(',');
        const r = item[column] || {};
        let replace = true;
        commonUtils.each(values, function(val) {
          const v = val.split(':');

          /*
           * Logic implemented to support Marie Stopes TL data migration
           */
          if (v && v.length === 1) {
            replace = false;
            const key = v[0];
            let token = key.toLowerCase();
            token = token.replaceAll(' ', '');
            let found = false;
            item[column] = item[column] || {};

            const attrs_needed = commonUtils.where(ex_attributes, { name: column });
            if (commonUtils.size(attrs_needed)) {
              const iterate = attrs_needed[0].select_options;

              commonUtils.each(iterate, function(attr) {
                if (attr.select_text) {
                  commonUtils.each(attr.select_text, function(a, lang) {
                    let changed = a.toLowerCase();
                    changed = changed.replaceAll(' ', '');
                    // we are going to compare the raw lowercase text
                    if (changed === token) {
                      found = true;
                      item[column][attr.name] = true;
                      return;
                    }
                  });
                }
              });
            }

            if (!found) {
              item[column][record[index]] = true;
            }
          } else if (!v || v.length !== 2) {
            // return;
            replace = false;
            Utils.recurseObject(protect, item, val);
          } else {
            let value = v[1];
            const key = v[0];
            value = value.trim();
            if (value.match(/^[\-\+]?\d+$/)) {
              // valid integer
              value = parseInt(value);
            } else if (value.match(/^[\-\+]?\d+\.\d+$/)) {
              // valid float
              value = parseFloat(value);
            }

            r[key] = value;
          }
        });

        if (replace) {
          item[column] = r;
        }
        return next();
      case 'boolean':
        let value = null;
        if (record[index] == 'true' || record[index] == 'TRUE') {
          value = true;
        } else if (record[index] == 'false' || record[index] == 'FALSE') {
          value = false;
        }

        item[column] = value;
        return next();
      case 'translation':
        const records = record[index].split(',');
        const d = {};
        const names = ['english', 'portugues', 'tetum'];
        commonUtils.each(records, function(record, i) {
          if (i < names.length) {
            d[names[i]] = record;
          }
        });
        item[column] = d;
        return next();
      case 'object':
        Utils.recurseObject(protect, item, record[index]);
        return next();
      case 'tag_array':
        const recordS = record[index].split(',');
        commonUtils.each(recordS, function(r, index) {
          recordS[index] = (r || '').trim();
        });
        // var names = ['english', 'portugues', 'tetum'];
        Tag.find()
          .where({ name: recordS })
          .exec(function(err, tags) {
            if (err) {
              return next(err);
            }

            const ids = commonUtils.pluck(tags, 'id');

            item[column] = ids;

            return next();
          });
        break;
      case 'dimension':
        item[column] = '';
        return next();
      case '__SKIP__':
        item[column] = '';
        return next();
      default:
        const model = sails.models[attrTransformed[column]];
        let query;

        if (model) {
          query = { where: {} };

          if (model.requiresKey) {
            query.where.key = column;
          }

          let identity = column;

          if (commonUtils.isFunction(model.csvIdentity)) {
            identity = {};

            const identities = model.csvIdentity();

            commonUtils.each(identities, function(ident, i) {
              // identity[ident] = record[index];
              if (identities.length > 1) {
                if (i === 0) {
                  identity.or = [];
                }
                const or = {};

                or[ident] = record[index];
                identity.or.push(or);
              } else {
                identity[ident] = record[index];
              }
            });
            query.where = identity;
          } else {
            // need to debug
            // // we will just default to the id
            query.id = record[index];
          }

          /*
           * We look to see if we can find an association
           */
          model.findOne(query).exec(function(err, value) {
            if (err) {
              return next(err);
            }

            if (!value) {
              return next();
            }

            item[column] = value.id;
            next();
          });
        } else {
          if (commonUtils.contains(column, '.')) {
            Utils.recurseObject(column, item, record[index]);
            return next();
          } else {
            const hold = {};
            hold[column] = record[index];
            Geo.setGeo(hold, function() {
              if (hold.geo) {
                item.geo = hold.geo;
              }
              next();
            });
          }
        }
    }
  };
}

/**
 * Retrieves the file name from the environment or data.
 * @returns {Promise<string>} - A promise that resolves to the file name.
 */
const getFileName = () => {
  return new Promise((resolve, reject) => {
    let f_name;

    if (process.env.CLOUD_DEPLOYMENT) {
      f_name = data.file.fd;
    } else {
      f_name = data.file;
    }

    fileAdapter.read(f_name, function(err, f) {
      if (err) {
        return reject(err);
      }

      resolve(f);
    });
  })
}

/**
 * Processes a model based on data and a callback.
 * @param {Object} data - The data to process.
 * @param {Function} cb - The callback function.
 */
const processModel = function(data, cb) {
  data.output = [];

  const model = data.model;
  const attributes = sails.models[model]._attributes;

  getFileName().then(function(buffer) {
    const input = new stream.PassThrough();
    input.end(Buffer.from(buffer));

    // var input = fs.createReadStream(data.file.fd);
    let columns = null;
    const attrTransformed = Utils.transformAttributes(attributes);

    const parser = csv.parse({
      columns: function(cols) {
        columns = cols.map(function(col) {
          const c = (col || '').toLowerCase();
          return c.replace(/\s+/g, '_');
        });
      }
    });
    const transformer = csv.transform(
      function(record, callback) {
        const item = {};

        a_sync.forEachOf(
          columns,
          buildCSV(item, columns, attrTransformed, record),
          function endLoop(err) {
            if (err) {
              return callback(err);
            }

            if (commonUtils.size(item)) {
              if (!item.station) {
                item.station = data.station;
              }
              if (!item.observer) {
                item.observer = data.user;
              }

              sails.models[model].create(item).exec(function(err, mod) {
                if (mod && mod.id) {
                  data.output.push(mod.id);
                }

                callback(err, data.output);
              });
            } else {
              return callback(null);
            }
          }
        );
      },
      {
        parallel: 1
      },
      function(err) {
        cb(err, data, data.output);
      }
    );

    input.pipe(parser).pipe(transformer);

    transformer.on('error', function(err) {
      sails.log.error('CSV::TRANSFORM-ERROR', err.message, data.output);

      if ((data.output || []).length) {
        Jobs.destructor.add({
          model: model,
          query: { id: data.output }
        });
      }
    });
  });
}

/**
 * Synchronizes variables from a file with existing variables.
 * @param {Buffer} file - The file buffer to process.
 * @param {Array} variables - The existing variables.
 * @returns {Promise<Array>} - A promise that resolves to the synchronized variables.
 */
const syncVariables = async function(file, variables) {
  const LABEL_INDEX = 0;
  const DEFAULT_INDEX = 1;
  const filterKey = key => {
    return variables.filter(v => v.identity === key && v.domain === null);
  };
  const generateTemplate = (variable, key) => {
    return (
      variable || {
        key: Translates.translateIdentity,
        identity: key,
        value: {},
        locked: true
      }
    );
  };

  const pullVariable = key => {
    const variables = filterKey(key);
    const firstVariable = variables.shift();
    const variable = generateTemplate(firstVariable, key);
    return {
      variable,
      forDeletion: variables
    };
  };

  const filterRowContent = (rowContent, defaultText) => {
    return rowContent.startsWith('<html') ? defaultText : rowContent;
  };

  const getValueContent = (
    currentValue,
    index,
    row = [],
    preserve = true
  ) => {
    return preserve && currentValue
      ? currentValue
      : row[index]
      ? filterRowContent(row[index], row[DEFAULT_INDEX]) // we have a row we use it
      : row[DEFAULT_INDEX]
      ? row[DEFAULT_INDEX] // if not, try to parse the default language
      : row[LABEL_INDEX].toLowerCase() // Convert everything to lower case
          .replace(/_/g, ' ') // Replace underscores with spaces
          .replace(/\b\w/g, char => char.toUpperCase()); // or we try to get it from the key
  };

  const applyValues = (variable = {}, headers = [], row = []) => {
    const preserve = process.env.LANGUAGE_SYNC_FORCE !== 'true';
    for (let i = 1; i < headers.length; i++) {
      const langKey = headers[i].toLowerCase().replace(/\s+/g, '_');
      const currentValue = variable.value[langKey];
      variable.value[langKey] = getValueContent(
        currentValue,
        i,
        row,
        preserve
      );
    }
  };

  const saveVariable = variable => {
    variable.locked = true;
    if (Variable.getId(variable)) {
      return Variable.saveAsync(variable);
    }
    return Variable.create(variable);
  };

  const findIdenticalIdentity = (variable, savedVariables) => {
    return savedVariables.filter(
      v =>
        v.identity === variable.identity && variable.id !== v.id && !v.marked
    );
  };

  const destroyRemaining = async (variables = []) => {
    const ids = variables.map(Variable.getId);
    if (!ids.length) {
      return;
    }
    commonUtils.remove(variables, v => ids.indexOf(v.id) !== -1);
    await Variable.update({ id: ids }, { locked: false });
    return Variable.destroy({ id: ids });
  };

  const consolidate = async (savedVariables = []) => {
    for (const variable of savedVariables) {
      if (variable.marked) {
        continue;
      }
      variable.marked = true;
      const extraVariables = findIdenticalIdentity(variable, savedVariables);
      extraVariables.forEach(v => {
        v.marked = true;
      });
      await destroyRemaining(extraVariables);
    }
    return savedVariables;
  };

  const workSheetsFromBuffer = xlsxNode.parse(file);
  const savedVariables = [];
  for (const page of workSheetsFromBuffer) {
    const headers = page.data.shift();
    for (const row of page.data) {
      const key = row[LABEL_INDEX];
      sails.log.debug('BUILDING ', key);
      const contents = pullVariable(key);
      applyValues(contents.variable, headers, row);
      try {
        const saved = await saveVariable(contents.variable);
        savedVariables.push(saved);
        await destroyRemaining(contents.forDeletion);
      } catch (e) {
        sails.log.error(e);
      }
    }
  }
  return consolidate(savedVariables);
}

/**
 * Processes data based on a callback.
 * @param {Object} data - The data to process.
 * @param {Function} cb - The callback function.
 */
const process = function(data, cb) {
  data.output = [];
  const model = data.model;
  const domain = data.domain;
  const attributes = model.schema;

  getFileName().then(
    function(buffer) {
      const input = new stream.PassThrough();
      input.end(Buffer.from(buffer));
      let columns = null;
      const attrTransformed = commonUtils.merge(
        NodeSchema.defaultParams(),
        Node.transformAttributes(attributes)
      );

      const parser = csv.parse({
        columns: function(cols) {
          columns = cols.map(function(col) {
            const c = (col || '').toLowerCase();
            return c.replace(/\s+/g, '_');
          });
        }
      });
      const transformer = csv.transform(
        function(record, callback) {
          const item = {};
          a_sync.forEachOf(
            columns,
            buildCSV(
              item,
              columns,
              attrTransformed,
              record,
              attributes
            ),
            function endLoop(err) {
              if (err) {
                return callback(err);
              }

              if (commonUtils.size(item)) {
                if (!item.station) {
                  item.station = data.station;
                }
                if (!item.observer) {
                  item.observer = data.user;
                }

                item.schema = Model.getId(model);
                item.domain = Domain.getId(domain);
                Node.pullSchema(item)
                  .then(Node.parseSchema(item))
                  .then(Node.updateOrCreate())
                  .then(function(created) {
                    if (created && created.id) {
                      data.output.push(created.id);
                    }

                    callback(null, data.output);
                  })
                  .catch(function(err) {
                    callback(err);
                  });
              } else {
                return callback(null);
              }
            }
          );
        },
        {
          parallel: 1
        },
        function(err, out) {
          cb(err, data, data.output);
        }
      );

      input.pipe(parser).pipe(transformer);

      transformer.on('error', function(err) {
        sails.log.error('CSV::TRANSFORM-ERROR', err.message, data.output);

        if ((data.output || []).length) {
          Jobs.destructor.add({
            model: model,
            domain: domain,
            query: { id: data.output }
          });
        }
      });
    },
    function(why) {
      sails.log.error(why);
      cb(why);
    }
  );
}

module.exports = {
  splitKeyAgainstCell,
  headerSplitOnDot,
  setNullCell,
  headers,
  placeData,
  putData,
  stripRows,
  buildStationExcel,
  setObjects,
  setNodeHeaders,
  buildGenericNodeExcel,
  parseModel,
  parse,
  buildCSV,
  processModel,
  syncVariables,
  process
};
