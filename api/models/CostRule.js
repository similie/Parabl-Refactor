/**
 * CostRules.js
 *
 * @description :: A model definition.  Represents a database table/collection/etc.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    name: {
      type: 'string'
    },

    cost_code: {
      type: 'string'
    },

    entity: {
      type: 'string'
    },

    target: {
      type: 'integer'
    },

    rule: {
      model: 'rule'
    },

    dependents: {
      type: 'array'
    },

    query: {
      type: 'string'
    },

    message_flag: {
      type: 'text'
    },

    until: {
      type: 'string',
      in: ['once', 'every', 'date']
    },

    accepted: {
      // defaultsTo: false,
      defaultsTo: -1,
      min: -2,
      max: 2,
      type: 'integer'
    },

    memo: {
      type: 'text'
    },

    until_date: {
      type: 'datetime'
    },

    available: {
      type: 'boolean',
      defaultsTo: true
    },

    weight: {
      type: 'integer',
      min: 0
    }
  },

  mask: function() {
    return -1;
  },

  oneCanRuleTemplate: function(ruleValue) {
    const deletions = ['id', 'createdAt', 'updatedAt'];
    const rule = {
      ...ruleValue
    };
    rule.accepted = Const.rules.ACCEPTED;
    rule.until = 'once';

    rule.weight += 1;

    _.each(deletions, del => {
      delete rule[del];
    });

    return _.clone(rule);
  },

  validateDependency: async function(query, dataSource) {
    return await Rule.stripDependents(query, dataSource);
  },

  settleQuery: async function(query, dataSource) {
    const settlement = await Rule.settleQuery(query, dataSource);
    return settlement;
  },

  beforeValidate: async function(values, next) {
    if (values.accepted === true) {
      values.accepted = Const.rules.ACCEPTED;
    } else if (values.accepted === false) {
      values.accepted = Const.rules.REJECT;
    }

    next();
  },
  beforeCreate: async function(values, next) {
    const count = await CostRule.count({
      cost_code: values.cost_code,
      entity: values.entity,
      target: values.target
    });
    values.weight = count;
    next();
  },

  overrideRules: async function(tender) {
    let valid = false;

    if (tender.token && tender.meta && tender.meta.manager_approval) {
      const approver = await User.findOneById(tender.meta.manager_approval);
      if (!approver) {
        return valid;
      }

      if (!User.is(approver, Roles.MANAGER)) {
        return valid;
      }

      const verified = await CostApproval.verify(tender.token);
      // the system hasn't approved the cost approval
      if (!verified.approved) {
        // here we just want some files
        // in the future, we can look at any bar codes or
        // elements of the file to determine it's legitimacy
        valid = !!_.size(tender.meta.files);
      } else {
        valid = verified.approved;
      }
    }

    return valid;
  },

  iterateAncestors: async function(
    cost_code,
    entity,
    params,
    restrictions = []
  ) {
    /*
     * Here we are going to pretend our cost codes are approved
     */
    const ancestors = await Station.ancestors(cost_code, true);
    _.remove(ancestors, a => _.contains(restrictions, a.station_id));
    // let approved = true;
    for (let i = 0; i < _.size(ancestors); i++) {
      const ancestor = ancestors[i];
      // need to test fully
      const thisApproval = await CostRule.validateTransaction(
        ancestor.station_id,
        entity,
        params
      );
      if (!thisApproval) {
        // approved = false;
        // break;
        return false;
      }
    }
    return true;
  },

  applyOverrides: async function(rule, params) {
    const tender = params.payment;
    let valid = false;

    switch (rule) {
      case 'pointofsale':
        valid = await this.overrideRules(tender);
        break;
      default:
    }
    return valid;
  },

  findRulesOnEntity: async function(ruleEntity, cost_code) {
    return CostRule.find({
      sort: { weight: 'ASC' },
      where: {
        rule: Rule.getId(ruleEntity),
        cost_code: cost_code,
        available: true,
        or: [{ until_date: null }, { until_date: { '>=': new Date() } }]
      }
    });
  },

  validateOneRule: function(rule, ruleName, params) {
    return (
      sails.models[ruleName].validateonce ||
      (() => {
        return new Promise(resolve => {
          resolve(Const.rules.ACCEPTED);
        });
      })
    )(rule, params);
  },

  validateTransaction: async function(cost_code, rule, params) {
    let valid = await this.applyOverrides(rule, params);
    if (valid) {
      return valid;
    }

    const ruleEntity = await Rule.findOne({ entity: rule });
    // this is an entity that maps to our element
    if (!ruleEntity) {
      return !valid;
    }

    const rules = await this.findRulesOnEntity(ruleEntity, cost_code);
    // we have no rules here. Yay!!!
    if (!_.size(rules)) {
      return !valid;
    }
    const approvals = [];
    const rejections = [];
    for (let i = 0; i < _.size(rules); i++) {
      const r = rules[i];
      const accepted = r.accepted;
      const dataSource = params[ruleEntity.entity];
      const approval = await this.settleQuery(r.query, _.clone(dataSource));
      // patch to allow those that are accepted to pass
      // if (accepted === Const.rules.ACCEPTED && approval === Const.rules.REJECT) {
      //   approval *= CostRule.mask();
      // }
      // if we have a situation where nothing was relevant, we track it here
      if (approval === Const.rules.IRRELEVANT) {
        approvals.push(approval);
        continue;
      }

      const boolApproval = approval * accepted;
      valid = boolApproval;

      if (valid === Const.rules.REJECT) {
        rejections.push({ id: r.id, memo: r.memo, costcode: r.cost_code });
      }

      if (valid === Const.rules.ACCEPTED && r.until === 'once') {
        valid = await this.validateOneRule(r, rule, params);
      }
    }

    if (valid === Const.rules.ACCEPTED) {
      return true;
    }

    params.rejections = rejections;
    // this means every rule was invalid to this context
    return _.size(approvals) === _.size(rules);
  }
};
