/**
 * StateChain.js
 *
 * @description :: A model definition.  Represents a database table/collection/etc.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    costcode: {
      type: 'string'
    },

    entity: {
      required: true,
      type: 'string'
    },

    blocks: {
      collection: 'block'
    },

    retired: {
      type: 'boolean',
      defaultsTo: false
    },

    validateAllStates: async function() {
      const self = this.toObject();
      return StateChain.validateAllStates(self);
    },

    queryStates: async function() {
      const self = this.toObject();
      return StateChain.queryStates(self);
    },

    lastState: async function() {
      const self = this.toObject();
      return StateChain.lastState(self);
    },

    addState: async function(state, calcHash) {
      const self = this.toObject();
      const lastState = await StateChain.lastState(self);
      const valid = await state.isValid(calcHash);

      if (!valid) {
        throw new Error(Const.err.STATE_CHAIN_HACKING_ATTEMPT);
      }

      if (
        lastState &&
        (!lastState.isValid || (await lastState.isValid(calcHash)) !== true)
      ) {
        throw new Error(Const.err.STATE_CHAIN_HACKING_ATTEMPT);
      }

      if (lastState && !state.previous) {
        throw new Error(Const.err.STATE_CHAIN_PREVIOUS_REQUIRED);
      }

      if (!state.signature) {
        throw new Error(Const.err.STATE_CHAIN_SIGNED_TRANSACTION);
      }

      this.blocks.add({
        entity: self.entity,
        target: Model.getId(state)
      });

      await StateChain.saveAsync(this);
    }
  },
  THRESHOLD: 49,
  validateAllStates: async function(sc) {
    Utils.itsRequired(sc)(Utils.setErrorCode(Const.code.BAD_REQUEST));
    const chain = await StateChain.findOneById(
      StateChain.getId(sc)
    ).populateAll();

    const targets = _.pluck(chain.blocks, 'target');
    const model = sails.models[chain.entity];
    const models = await model.find({ id: targets });

    for (let i = 0; i < _.size(models); i++) {
      const m = models[i];
      if ((m && !m.isValid) || !(await m.isValid())) {
        throw new Error(Const.err.STATE_CHAIN_HACKING_ATTEMPT);
      }
    }
    return true;
  },

  queryStatesReq: async function(req) {
    const actionUtil = Utils.actionUtil();
    const where = actionUtil.parseCriteria(req);

    const sc = where.id;
    delete where.id;
    Utils.itsRequired(sc)(Utils.setErrorCode(Const.code.BAD_REQUEST));
    const chain = await StateChain.findOneById(
      StateChain.getId(sc)
    ).populateAll();
    const targets = _.pluck(chain.blocks, 'target');
    const q = _.merge(where, { id: targets });
    const model = sails.models[chain.entity];
    return await model
      .find()
      .where(q)
      .populateAll();
  },

  queryStates: async function(sc, query) {
    Utils.itsRequired(sc)(Utils.setErrorCode(Const.code.BAD_REQUEST));
    const chain = await StateChain.findOneById(
      StateChain.getId(sc)
    ).populateAll();
    const targets = _.pluck(chain.blocks, 'target');
    const q = _.merge(query, { id: targets });
    const model = sails.models[chain.entity];
    return await model
      .find()
      .where(q)
      .populateAll();
  },

  lastState: async function(sc) {
    Utils.itsRequired(sc)(Utils.setErrorCode(Const.code.BAD_REQUEST));
    const chain = await StateChain.findOneById(
      StateChain.getId(sc)
    ).populateAll();
    if (_.size(chain.blocks) > this.THRESHOLD && !chain.retired) {
      chain.retired = true;
      try {
        await new Promise((resolve, reject) => {
          // [sg] remove 2nd param from sails.save [update] v0.12, returning the modified 'chain' instead
          chain.save(err => {
            // [sg] (err, update) => {
            if (err) {
              return reject(err);
            }
            resolve(chain); // [sg]resolve(update);
          });
        });
      } catch (e) {
        sails.log.error(e);
      }
      return null;
    }

    let max = 0;
    let target = 0;
    _.each(chain.blocks, b => {
      if (b.id > max) {
        max = b.id;
        target = b.target;
      }
    });

    if (max === 0) {
      return null;
    }

    const model = sails.models[chain.entity];
    return await model.findOneById(target); // .populateAll();
  },

  beforeCreate: function(values, next) {
    if (!sails.models[values.entity]) {
      return next(Const.err.VALID_ENTITY_REQUIRED);
    }
    next();
  }
};
