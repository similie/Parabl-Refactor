/**
 * NodeSchema.js
 *
 * @description :: TODO: You might write a short summary of how this model works and what it represents here.
 * @docs        :: http://sailsjs.org/documentation/concepts/models-and-orm/models
 */
// [sg] necessary for l_.differenceBy as not in _ shipped with sails
const l_ = require('lodash');
const { SqlUtils } = require('similie-api-services');

module.exports = {
  migrate: process.env.MIGRATION || 'safe',

  attributes: {
    name: {
      type: 'string',
      required: true
    },
    module: {
      type: 'string'
    },
    mappings: {
      type: 'array'
    },

    param_groups: {
      type: 'json'
    },

    requires_approval: {
      type: 'boolean',
      defaultsTo: false
    },

    approvals_workflow: {
      type: 'json'
    },

    survey: {
      type: 'boolean',
      defaultsTo: false
    },

    domain_schema: {
      type: 'string',
      // defaultsTo: "nodes",
      maxLength: 45
    },

    weight: {
      type: 'integer',
      min: 0,
      max: 100
    },

    schema: {
      type: 'array'
    },
    color: {
      type: 'string',
      maxLength: 40
    },
    has_point: {
      type: 'boolean',
      defaultsTo: false
    },

    has_early_warning: {
      type: 'boolean',
      defaultsTo: false
    },

    has_files: {
      type: 'boolean',
      defaultsTo: false
    },

    full_screen_enabled: {
      type: 'boolean',
      defaultsTo: false
    },

    disable_reporting: {
      type: 'boolean',
      defaultsTo: false
    },

    is_global: {
      type: 'boolean',
      defaultsTo: false
    },

    serialized_item: {
      type: 'boolean',
      defaultsTo: false
    },

    is_asset: {
      type: 'boolean',
      defaultsTo: false
    },

    remove_approvals: {
      type: 'boolean',
      defaultsTo: false
    },

    can_link: {
      type: 'boolean',
      defaultsTo: false
    },

    fullscreen: {
      type: 'json'
    },

    modules: {
      collection: 'module'
    },

    domain: {
      model: 'domain'
    },
    // compatibility with stations
    parents: {
      type: 'array'
    },

    derivative: {
      type: 'boolean',
      defaultsTo: false
    },

    transient: {
      type: 'boolean',
      defaultsTo: false
    },

    is_inventory: {
      type: 'boolean',
      defaultsTo: false
    },

    show_workorder: {
      type: 'boolean',
      defaultsTo: false
    },

    is_pos: {
      type: 'boolean',
      defaultsTo: false
    },

    is_burried: {
      type: 'boolean',
      defaultsTo: false
    },

    socket_name: {
      type: 'string',
      required: false,
      maxLength: 100
    },

    derivative_statement: {
      type: 'text',
      required: false
    },

    title: {
      type: 'string',
      required: false,
      maxLength: 100
    },

    tags: {
      collection: 'tag'
    },

    show_barcode: {
      type: 'boolean',
      defaultsTo: false
    },

    scannable_id: {
      unique: true,
      type: 'string'
    },

    constant: {
      type: 'boolean',
      defaultsTo: false
    },

    disable_import_tab: {
      type: 'boolean',
      defaultsTo: false
    },

    disable_device_tab: {
      type: 'boolean',
      defaultsTo: false
    },

    child_identities: {
      collection: 'nodeschema'
    },

    applications: {
      type: 'json'
    },

    user_assigned: {
      type: 'boolean',
      defaultsTo: false
    },

    personnel: {
      type: 'boolean',
      defaultsTo: false
    },

    system_access: {
      type: 'boolean',
      defaultsTo: false
    },

    assign_rank: {
      type: 'boolean',
      defaultsTo: false
    },

    assign_org: {
      type: 'boolean',
      defaultsTo: false
    },

    icon: {
      type: 'string'
    },

    show_devices: {
      type: 'boolean',
      defaultsTo: false
    },

    remove_observer: {
      type: 'boolean',
      defaultsTo: false
    },

    assign_to_ew: {
      type: 'boolean',
      defaultsTo: false
    },

    meta: {
      type: 'json'
    },

    require_user_license: {
      type: 'boolean',
      defaultsTo: false
    },

    toJSON: function() {
      const model = this.toObject();
      Node.sortSchema(model.schema);
      return model;
    }
  },

  filterAssetsForDomain: function(domains = [], domain = null) {
    if (!Array.isArray(domains)) {
      return [];
    }
    const index = domains.indexOf(null);
    const setOr = [
      {
        is_asset: true,
        domain: domains.filter(d => !!d)
      },

      { domain: Domain.getId(domain) }
    ];
    if (index !== -1 && domain) {
      setOr.push({
        is_asset: true,
        domain: null
      });
    }

    return setOr;
  },

  filterSchema: function(schema, user) {
    if (user) {
      Utils.permitUser(user, schema);
    } else {
      NodeSchema.stripSchema(schema);
    }
  },

  sendSchema: function(req, res) {
    const user = req.user;
    const _this = this;
    return function(records) {
      if (_.isArray(records)) {
        _.each(records, schema => {
          _this.filterSchema(schema, user);
        });
      } else {
        _this.filterSchema(records, user);
      }
      res.send(records);
    };
  },

  stripSchema: function(schema) {
    const u = {
      role: Roles.ANNOYMOUS
    };
    const user = new User._model(u);
    schema = Utils.permitUser(user, schema);
    return schema;
  },

  defaultParams: function() {
    return {
      observer: 'user',
      tags: 'tag_array',
      point: 'object',
      station: 'station',
      contact: 'contact'
    };
  },

  parseCSV: function() {},

  alarmStates: function(param, violation) {
    const violations = {
      min: '_MIN_EXCEDDED',
      max: '_MAX_EXCEDDED',
      required: '_IS_REQUIRED',
      type: '_IS_WRONG_TYPE',
      active: '_IS_INACTIVE'
    };

    return (param || '').toUpperCase() + violations[violation];
  },

  stripDefaultMappings: function(values) {
    if (!values || !values.mappings) {
      return;
    }
    const strip = {
      __default_page_tab__: true
    };

    _.remove(values.mappings, m => strip[m.key]);
  },

  beforeUpdate: async function(values, next) {
    this.stripDefaultMappings(values);
    await this.pruneMapNameFromSchema(values.mappings);

    if (values.derivative) {
      return next();
    }

    NodeSchema.findOneById(values.id).exec((err, previous) => {
      if (err) {
        return next(err);
      }

      const difference = l_.differenceBy(
        values.schema,
        previous.schema,
        'name'
      );
      if (!difference.length) {
        return next();
      }

      const knex = sails.models.knex;
      knex.schema
        .withSchema(SqlUtils.knex().getSchemaName(previous))
        .table(previous.name, function(t) {
          _.each(
            difference,
            function(value, index) {
              buildTable(t, value, this);
            },
            this
          );
        })
        .then(() => {
          return next();
        })
        .catch(next);
    });
  },

  removeMapNameFromSchema: async function(map, name) {
    for (let i = 0; i < _.size(map); i++) {
      const m = map[i];
      if (m.map[0] && !_.isString(m.map[0])) {
        await this.removeMapNameFromSchema(m.map, name);
      } else {
        _.remove(m.map, m => m === name);
      }
    }
  },

  pruneMapNameFromSchema: async function(map) {
    for (let i = 0; i < _.size(map); i++) {
      const m = map[i];
      if (m.map[0] && !_.isString(m.map[0])) {
        await this.pruneMapNameFromSchema(m.map);
      } else {
        const clone = [...m.map];
        const has = {};
        for (let j = 0; j < _.size(clone); j++) {
          const c = clone[j];
          if (!has[c]) {
            _.remove(m.map, m => m === c);
            m.map.push(c);
            has[c] = true;
          }
        }
      }
    }
  },

  setSchemaWeight: function(schema) {
    for (let i = 0; i < _.size(schema); i++) {
      schema[i].weight = i;
    }
  },

  afterCreate: async function(values, next) {
    const knex = sails.models.knex;
    const ormHelper = SqlUtils.knex(knex);

    if (values.derivative) {
      if (
        values.derivative_statement === '__APPLICATION_ENTITY__' ||
        _.startsWith(values.derivative_statement, '__STORED_PROCEDURE__')
      ) {
        return next();
      }
      try {
        // [sg] await SqlUtil.createView(values, next);
        await ormHelper.createView(values); // returns Bool, but unused
        return next();
      } catch (err) {
        return next(err);
      }
    }

    knex.schema
      .withSchema(ormHelper.getSchemaName(values))
      .hasTable(values.name)
      .then(exists => {
        if (!exists) {
          knex.schema
            .withSchema(ormHelper.getSchemaName(values))
            .createTable(values.name, function(t) {
              t.increments('id').primary();

              _.each(
                values.schema,
                function(value, index) {
                  // var build;
                  buildTable(t, value, this);
                },
                this
              );
              // t.foreign('schema').references('nodeschema.id');
              t.integer('schema').defaultTo(values.id);
              t.integer('domain').defaultTo(Model.getId(values.domain));
              // t.foreign('station').references('station.id');
              // t.foreign('owner').references('user.id');
              // t.foreign('contact').references('contact.id');
              t.integer('station').notNullable();
              t.integer('observer');
              t.integer('import');
              t.integer('survey');
              t.integer('data_import');
              t.integer('user_details');

              t.uuid('scannable_id');
              t.unique('scannable_id');

              t.integer('contact'); // user_details
              t.integer('__device__');
              t.integer('copy_of');
              t.integer('__parent__');
              t.integer('state_key');
              t.boolean('complete_state').defaultTo(true);
              t.boolean('alarm').defaultTo(false);
              t.boolean('approved').defaultTo(true);
              t.boolean('__available__').defaultTo(true);
              t.boolean('rejected').defaultTo(false);
              // may not need
              t.jsonb('asset_approval').defaultTo('{}');
              t.jsonb('alarm_states').defaultTo('{}');
              t.jsonb('__target_values__').defaultTo('{}');
              // t.json('survey_text').defaultTo('{}');
              t.specificType('tags', 'jsonb[]');
              t.specificType('files', 'jsonb[]');

              // t.json('tags').defaultTo('[]');
              // t.jsonb('point').defaultTo('{}');
              // geo elements
              t.text('geo');
              t.string('word_address');

              t.timestamp('updatedAt').defaultTo(knex.fn.now());
              t.timestamp('createdAt').defaultTo(knex.fn.now());
            })
            .then(() => {
              next();
            })
            .catch(error => {
              // Error handler
              sails.log.error(error);
              NodeSchema.destroy({
                id: values.id
              }).exec(err => {
                if (err) {
                  return next({
                    error: err
                  });
                }

                next({
                  error: error
                });
              });
            });
        } else {
          NodeSchema.destroy({
            id: values.id
          }).exec(err => {
            if (err) {
              return next({
                error: err
              });
            }

            next({
              error: 'errors.TABLE_EXISTS'
            });
          });
        }
      });
  },

  beforeCreate: async function(values, next) {
    values.color = Utils.color();

    const knex = sails.models.knex;
    const ormHelper = SqlUtils.knex(knex);
    values.scannable_id = Node.createToken();

    let domain = null;
    if (values.domain) {
      domain = await Domain.findOneById(values.domain);
      values.domain_schema = domain.node_schema;
    } else {
      values.domain_schema = ormHelper.getSchemaName(values);
    }

    if (values.derivative) {
      if (_.isEmpty(values.derivative_statement)) {
        return next({
          error: 'errors.DERIVATIVE_SQL_STMT_NOT_POPULATED'
        });
      }
      if (Node.isSpecialTypeDerivative(values)) {
        return next();
      }
      try {
        // ormHelper hasTable = hasView, both return True|False
        const viewExists = await ormHelper.hasTable(values);
        if (viewExists) {
          return next({
            error: 'errors.A_SYSTEM_VIEW_EXISTS'
          });
        }
        await Model.queryAsync(values.derivative_statement);
        return next();
      } catch (err) {
        sails.log.error(err);
        return next(err);
      }
    }

    knex.schema
      .withSchema(ormHelper.getSchemaName(values))
      .hasTable(values.name)
      .then(exists => {
        if (!exists) {
          return next();
        } else {
          return next({
            error: 'errors.A_SYSTEM_TABLE_EXISTS'
          });
        }
      });
  },
  isSpecial: function(type) {
    if (!type) {
      return true;
    }
    const first = type[0];
    const last = type[_.size(type) - 1];
    return first === '_' && last === '_';
  },

  hasPurpose: function(param, validate) {
    const special = this.isSpecial(param.type);
    if (validate || special) {
      return special;
    } else if (param.param_purpose) {
      return true;
    }
    return false;
  }
};

function buildTable(table, value, bind) {
  if (NodeSchema.isSpecial(value.type)) {
    return;
  }
  let b = null;
  switch (value.type) {
    case 'array':
      table.text(value.name);
      // table.specificType(value.name, 'jsonb[]');
      // table.integer(value.name);
      break;
    case 'decimal':
      // table.float(value.name, 8, 12);
      // table.float(value.name);
      table.specificType(value.name, 'float8');
      break;
    case 'variable':
      table.integer(value.name);
      break;
    case 'json':
      table.jsonb(value.name);
      break;
    case 'date':
      table.timestamp(value.name);
      break;
    case 'money':
      table.jsonb(value.name);
      break;
    case 'user':
      table.jsonb(value.name);
      break;
    case 'node':
      table.jsonb(value.name);
      break;
    case 'duration':
      table.jsonb(value.name);
      break;
    case 'tracker':
      table.string(value.name);
      break;
    case 'calculator':
      table.jsonb(value.name);
      break;
    case 'disaggregator':
      table.jsonb(value.name);
      break;
    case 'filestory':
      table.jsonb(value.name);
      break;
    case 'paragraphs':
      table.jsonb(value.name);
      break;
    case 'barcode':
      table.string(value.name);
      break;
    case 'districts':
      table.string(value.name);
      break;
    case 'dimension':
      table.jsonb(value.name);
      break;
    case 'scheduler':
      table.jsonb(value.name);
      break;
    case 'priority':
      table.jsonb(value.name);
      break;
    case 'costcode':
      table.jsonb(value.name);
      break;
    case 'country':
      table.text(value.name);
      break;
    case 'multi_select':
      table.text(value.name);
      break;
    case 'integer':
      // table.bigInteger(value.name);
      table.integer(value.name);
      break;
    default:
      b = (table[value.type] || _.noop).bind(bind);
      b(value.name);
  }

  // if (value.unique_value) {
  //   table.unique(value.name);
  // }
}
