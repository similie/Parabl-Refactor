/**
 * StockNotification.js
 *
 * @description :: A model definition.  Represents a database table/collection/etc.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */
const { CommonUtils } = require('similie-api-services');

module.exports = {
  migrate: process.env.MIGRATION || "safe",
  attributes: {
    user: {
      type: "integer"
    },

    user_type: {
      type: "string",
      maxLength: 20
    },

    schema: {
      model: "nodeschema"
    },

    station: {
      model: "station"
    },

    item: {
      type: "string"
    },

    description: {
      type: "string"
    },

    pending: {
      type: "boolean",
      defaultsTo: true
    }
  },

  evaluate: async function(nodeItem, schema, quantity) {
    if (!quantity || nodeItem) {
      return;
    }
    const helpers = Module._helpers.logistics();
    const logParams = helpers.logParams(schema.schema);
    const sku = nodeItem[logParams("sku")];
    const sns = await StockNotification.find({
      pending: true,
      item: sku,
      station: Station.getId(nodeItem.station),
      schema: StationSchema.getId(schema)
    }).limit(quantity);

    const limit = _.size(sns);
    for (let i = 0; i < limit; i++) {
      const sn = sns[i];
      sn.pending = false;
      await StockNotification.saveAsync(sn);
    }
  },

  afterCreate: async function(values, next) {
    const emailElements = {
      key: "stock_notification",
      subject: "stock_notification_subject",
      body: "stock_notification_body"
    };
    await Email.setUserComs(values, emailElements);
    next();
  },

  afterDestroy: async function(values, next) {
    const emailElements = {
      key: "stock_notification",
      subject: "stock_notification_destroy_subject",
      body: "stock_notification_destroy_body"
    };
    const valuesArray = CommonUtils.coerceToArray(values);
    _.each(valuesArray, async value => {
      await Email.setUserComs(value, emailElements);
    });
    next();
  },

  beforeUpdate: async function(values, next) {
    const emailElements = {
      key: "stock_notification",
      subject: "stock_notification_ready_subject",
      body: "stock_notification_ready_body"
    };

    const valuesArray = CommonUtils.coerceToArray(values);
    const limit = _.size(valuesArray);
    for (let i = 0; i < limit; i++) {
      const value = valuesArray[i];
      const old = await StockNotification.findOneById(value.id);
      if (!value.pending && old.pending) {
        await Email.setUserComs(value, emailElements);
      }
    }

    next();
  }
};
