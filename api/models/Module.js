/**
 * Module.js
 *
 * @description :: TODO: You might write a short summary of how this model works and what it represents here.
 * @docs        :: http://sailsjs.org/documentation/concepts/models-and-orm/models
 */

const { SqlUtils } = require('similie-api-services');
const {
  WindyWarning
} = require('../model-utilities/early-warning/windy/windy-warning');
const SailsExtensions = require('../services/SailsExtensions');

module.exports = {
  attributes: {
    name: {
      type: 'text'
    },

    active: {
      type: 'boolean'
    },

    domain: {
      model: 'domain'
    },

    meta: {
      type: 'json'
    }
  },

  _helpers: {
    logistics: function(type) {
      type = type || 'logistics_parameter';
      return {
        logParams: function(schema) {
          const qParams = {};
          _.each(schema, s => {
            if (s && s[type]) {
              qParams[s.param_purpose] = s;
            }
          });
          return function(type, attr) {
            if (!type) {
              return _.clone(qParams);
            }
            attr = attr || 'name';
            const param = qParams[type] || {
              [attr]: ''
            };
            return _.clone(param[attr]);
          };
        },

        getItemParent: async function(sku = '', schema = {}) {
          const logParams = this.logParams(schema.schema);
          const skuParam = logParams('sku');
          const db = SqlUtils.knex().tableNameForQuery(schema);
          const escape = SqlUtils.escapeUtil();
          const query = escape(
            `SELECT * FROM %s WHERE "%s" = '%s' 
            AND "copy_of" IS NULL 
            AND "__available__" = true ORDER BY "createdAt" ASC;`,
            db,
            skuParam,
            sku
          );
          const results = await Model.queryAsync(query);
          const rows = results.rows;
          return rows.pop();
        },

        getPotentialItemParent: async function(sku = '', schema = {}) {
          const logParams = this.logParams(schema.schema);
          const skuParam = logParams('sku');
          const db = SqlUtils.knex().tableNameForQuery(schema);
          const escape = SqlUtils.escapeUtil();
          const query = escape(
            `SELECT * FROM %s WHERE "%s" = '%s' 
            AND "copy_of" IS NOT NULL 
            AND "__available__" = true ORDER BY "createdAt" ASC;`,
            db,
            skuParam,
            sku
          );
          const results = await Model.queryAsync(query);
          const rows = results.rows;
          return rows.pop();
        },

        setupInventoryParentCheck: function(node = {}, schema = {}) {
          if (!schema.is_inventory) {
            throw new Error('Schema is not an inventory type');
          }
          if (node.copy_of) {
            return new Error('Node is a valid copy');
          }
          const logParams = this.logParams(schema.schema);
          const sku = logParams('sku');
          if (!sku) {
            throw new Error('Schema does not have an SKU param type');
          }
          const skuValue = node[sku];
          if (!skuValue) {
            throw new Error('Node does not contain a vaild sku');
          }
          return skuValue;
        },

        setCopyOfToNull: async function(node, schema = {}) {
          const db = SqlUtils.knex().tableNameForQuery(schema);
          const escape = SqlUtils.escapeUtil();
          const query = escape(
            `UPDATE %s SET "copy_of" = NULL WHERE "id" = %s`,
            db,
            node.id
          );
          const results = await Model.queryAsync(query);
          return results.rows.pop();
        },

        setParentDeletion: async function(node = {}, schema = {}) {
          let skuValue;
          try {
            skuValue = this.setupInventoryParentCheck(node, schema);
          } catch (e) {
            return;
          }
          const send = await this.getPotentialItemParent(skuValue, schema);
          if (!send) {
            return;
          }
          return await this.setCopyOfToNull(send, schema);
        },

        applyInventorySkuParent: async function(node = {}, schema = {}) {
          let skuValue;
          try {
            skuValue = this.setupInventoryParentCheck(node, schema);
          } catch {
            return;
          }
          const parent = await this.getItemParent(skuValue, schema);
          const id = Model.getId(parent);
          if (!id || Model.getId(node) === id) {
            return;
          }

          node.copy_of = id;
          Node.overrideConstants(node, parent, schema);
        },
        cloneInventory: function(parent, schema) {
          const clone = Node.clone(parent, schema);
          const logParams = this.logParams(schema.schema);
          const values = ['quantity', 'quantity_incoming', 'quantity_outgoing'];
          values.forEach(val => {
            clone[logParams(val)] = 0;
          });
          return clone;
        }
      };
    }
  },

  _timers: [
    {
      interval: Const.timers.CUSTOM(
        process.env.WINDY_PROCESS_CHECK || 6,
        Const.timers.HOUR
      ),
      name: 'windy_processor',
      action: function() {
        return {
          do: function() {
            Jobs.windyEwProcessor.add();
          }
        };
      }
    }
  ],

  _processors: [
    /*
     * This processor looks for users who are still considered offline,
     * but their session has expired. It there is no session data, we set the
     * user to their offline state
     */

    {
      name: 'windyEwProcessor',
      process: async function() {
        sails.log.debug('SCANNING WINDY');
        const ww = new WindyWarning();
        try {
          await ww.scan();
        } catch (e) {
          sails.log.error(e.message);
        }
      },

      stats: SailsExtensions.stats({
        completed: function() {
          // sails.log.debug('All Users Purged');
        },
        failed: function(_job, err) {
          console.error('JOB windyEwProcessor ERROR::', err);
          // Utils.sendexcelMessage(err, job.data);
        }
      })
    }
  ],

  _creation_overrides: async function(schema, _params, _req, _res) {
    const overrides = {
      logistics: async function() {
        return schema;
      }
    };

    return await (overrides[schema.module] || _.noop)();
  }
};
