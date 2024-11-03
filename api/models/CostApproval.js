/**
 * CostApproval.js
 *
 * @description :: A model definition.  Represents a database table/collection/etc.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */
const { TimeUtils } = require('similie-api-services');
const now_ = TimeUtils.constants.now_;
const cost_exp = process.env.COST_APPROVAL_EXP || '3h';

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    amount: {
      type: 'float'
    },

    approval_token: {
      type: 'uuid',
      unique: true
    },

    approved: {
      type: 'boolean',
      defaultsTo: false
    },

    consumed: {
      type: 'boolean',
      defaultsTo: false
    },

    issue: function(expiration) {
      const _self = this.toObject();
      if (!_self.approval_token) {
        return null;
      }
      return jwToken.issue(
        {
          approval: _self.approval_token
        },
        expiration || cost_exp
      );
    },

    meta: {
      type: 'json'
    }
  },

  invalidate: async function(token) {
    const verified = await new Promise((resolve, reject) => {
      jwToken.verify(token, (err, decode) => {
        if (err) {
          return reject(err);
        }
        resolve(decode);
      });
    });
    return await CostApproval.destroy({ approval_token: verified.approval });
  },

  revert: async function(token) {
    const verified = await new Promise((resolve, reject) => {
      jwToken.verify(token, (err, decode) => {
        if (err) {
          return reject(err);
        }
        resolve(decode);
      });
    });

    //[sg] if (moment(verified.exp).isAfter(moment()))
    if (TimeUtils.date(verified.exp).isAfter(now_)) {
      throw new Error('Approval code has Expired');
    }

    const ca = await CostApproval.findOne({
      approval_token: verified.approval
    });
    ca.consumed = false;
    const saved = await CostApproval.saveAsync(ca);
    return saved;
  },

  verify: async function(token) {
    const verified = await new Promise((resolve, reject) => {
      jwToken.verify(token, (err, decode) => {
        if (err) {
          return reject(err);
        }
        resolve(decode);
      });
    });

    //[sg]if (moment(verified.exp).isAfter(moment()))
    if (TimeUtils.date(verified.exp).isAfter(now_)) {
      throw new Error('Approval code has Expired');
    }

    return CostApproval.findOne({
      approval_token: verified.approval,
      consumed: false
    });
  },

  beforeCreate: function(values, next) {
    if (!values.approval_token) {
      values.approval_token = Tracker.buildRandomId('uuid');
    }
    next();
  }
};
