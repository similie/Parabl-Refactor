/**
 * Rule.js
 *
 * @description :: A model definition.  Represents a database table/collection/etc.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    entity: {
      type: 'string',
      required: true,
      unique: true
    },
    name: {
      type: 'string',
      required: true,
      unique: true
    },
    class_name: 'string',
    actors: 'json'
  },

  searchTrace: async function(query, action, set) {
    let foundTrace = Const.rules.IRRELEVANT;

    const traceArray = _.isArray(query) ? query : [query];

    for (let i = 0; i < _.size(traceArray); i++) {
      if (foundTrace === Const.rules.ACCEPTED) {
        break;
      }

      let trace = traceArray[i];
      if (_.isString(trace) && Utils.isNumeric(trace)) {
        trace = parseFloat(trace);
      }

      switch (action) {
        case 'is':
          if (Utils.contains(set, trace)) {
            // foundTrace = Const.rules.ACCEPTED;
            return Const.rules.ACCEPTED;
          } else {
            foundTrace = Const.rules.REJECT;
          }
          break;
        case 'is_not':
          if (!Utils.contains(set, trace)) {
            return Const.rules.ACCEPTED;
          } else {
            foundTrace = Const.rules.REJECT;
          }
          break;
        case 'is_less':
          for (let i = 0; i < _.size(set); i++) {
            const s = set[i];
            if (trace < s) {
              return Const.rules.ACCEPTED;
            } else {
              foundTrace = Const.rules.REJECT;
            }
          }
          break;
        case 'is_more':
          for (let i = 0; i < _.size(set); i++) {
            const s = set[i];
            if (trace > s) {
              return Const.rules.ACCEPTED;
            } else {
              foundTrace = Const.rules.REJECT;
            }
          }
          break;
        case 'has':
          if (Utils.contains(set, trace)) {
            return Const.rules.ACCEPTED;
          } else {
            foundTrace = Const.rules.REJECT;
          }
          break;
        case 'has_not':
          if (!Utils.contains(set, trace)) {
            return Const.rules.ACCEPTED;
          } else {
            foundTrace = Const.rules.REJECT;
          }
          break;
        case 'between':
          for (let i = 0; i < _.size(set); i++) {
            const s = set[i];
            if (trace >= s.start && trace <= s.end) {
              return Const.rules.ACCEPTED;
            } else {
              foundTrace = Const.rules.REJECT;
            }
          }
          break;
        case 'is_type':
          break;
        case 'is_not_type':
          break;
        default:
      }
    }
    return foundTrace;
  },

  parseAction: async function(sentence, source) {
    // new RegExp(`with_action`, 'i')
    if (!sentence.match(/with_action/i)) {
      return source;
    }
    const against = sentence.split(' ');
    const actionIndex = 1;
    const action = against[actionIndex];
    let set = against[actionIndex + 1];
    try {
      set = JSON.parse(against[actionIndex + 1]);
    } catch {
      //
    }
    return this.searchTrace(source, action, set);
  },

  parseObject: async function(sentence, source) {
    if (source) {
      return source[sentence];
    }
    return source;
  },

  parseArr: async function(sentence, source) {
    if (source) {
      const split = sentence.split(' ');
      // new RegExp(`filter*`, 'i')
      if (sentence.match(/filter*/i)) {
        const f = _.filter(source, f => {
          if ((split[2] || '').match(/\[.*?\]/g)) {
            return Utils.contains(JSON.parse(split[2]), f[split[1]]);
          }
          // eslint-disable-next-line eqeqeq
          return f[split[1]] == split[2];
        });
        return f;
      }
      const plucks = _.pluck(source, split[0]);
      return plucks;
    }
    return source;
  },

  parseAs: async function(sentence, source) {
    // new RegExp(`as`, 'i')
    if (sentence.match(/as/i)) {
      const asPhrase = sentence.split(' ');
      const selectModel = asPhrase[Utils.findWord(asPhrase, 'as') + 1];
      if (sails.models[selectModel] && Utils.isNumeric(source)) {
        return await sails.models[selectModel]
          .findOneById(source)
          .populateAll();
      }
    }
    return source;
  },

  parser: async function(sentence, dataSource) {
    const source = await this.parseAs(sentence, dataSource);
    // new RegExp(`with_action`, 'i')
    if (sentence.match(/with_action/i)) {
      return await this.parseAction(sentence, source);
    } else if (_.isArray(dataSource)) {
      return await this.parseArr(sentence, source);
    } else if (_.isObject(dataSource)) {
      return await this.parseObject(sentence, source);
    }
    return source;
  },

  walkDependents: async function(sentence, dataSource) {
    const parsed = await this.parser(sentence, dataSource);
    return parsed;
  },

  settleQuery: async function(sentence, datasource) {
    if (!sentence) {
      return Const.rules.IRRELEVANT;
    }
    const split = sentence.split(' can ');
    for (let i = 0; i < _.size(split); i++) {
      const phrase = split[i];
      const data = await this.stripDependents(phrase, _.clone(datasource));
      if (data !== Const.rules.ACCEPTED) {
        // if we can't even parse past the first
        // can, it doesn't pertain to us
        if (i < _.size(split) - 1) {
          return Const.rules.IRRELEVANT;
        }
        return data;
      }
    }

    return Const.rules.ACCEPTED;
  },

  stripDependents: async function(query = '', dataSource) {
    const splits = query.split(' select ');
    const parentDependents = [];
    parentDependents.push(_.cloneDeep(dataSource));
    for (let i = 0; i < _.size(splits); i++) {
      const sentence = splits[i].trim();
      const parentDependent = await this.walkDependents(
        sentence,
        parentDependents[i]
      );
      // console.log('SELECTING DEPENDENTS', sentence, parentDependents[i]);
      parentDependents.push(_.cloneDeep(parentDependent));
    }
    return parentDependents[parentDependents.length - 1]; // parentDependent;
  }
};
