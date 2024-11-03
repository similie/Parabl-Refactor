/**
 * CostCode.js
 *
 * @description :: A model definition.  Represents a database table/collection/etc.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

const Dinero = require('dinero.js');
const currencyFormat = require('currency-format');

const SHA256 = require('crypto-js/sha256');
const EC = require('elliptic').ec;
const ec = new EC('secp256k1');
const { TimeUtils } = require('similie-api-services');

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    domain: {
      model: 'domain'
    },

    from: {
      type: 'string'
    },

    to: {
      type: 'string'
    },

    from_public_key: {
      type: 'string'
    },

    to_public_key: {
      type: 'string'
    },

    amount: {
      type: 'integer'
    },

    currency: {
      type: 'string',
      defaultsTo: 'USD'
    },

    state_key: {
      unique: true,
      model: 'statekeys'
    },

    /*
     * Not yet implemented
     */
    signed_transaction: {
      type: 'string'
    },

    signature: {
      type: 'string'
    },

    previous: {
      model: 'costcode'
    },

    toJSON: function() {
      const _self = this.toObject();
      delete _self.signature;
      delete _self.previous;
      delete _self.state_key;

      const amount = _self.amount;
      _self.amount = this.parseValue(amount, _self.currency);
      /*
       * Alter the currency here
       */
      return _self;
    },

    parseValue: function(value, currency) {
      return CostCode.parseValue(value, currency);
    },

    addToStateChain: async function() {
      //  const start = Date.now();
      const _self = this.toObject();
      Utils.itsRequired(_self)(Utils.setErrorCode(Const.code.BAD_REQUEST));
      // sails.log.debug("POS CHECKPOINT 2.1.1.6.1", Date.now() - start);
      let domain = Domain.defaultElements();

      if (_self.domain) {
        domain = await Domain.findOneById(Domain.getId(_self.domain));
      }

      let chain = await StateChain.findOrCreate({
        costcode: Domain.costcodeName(domain),
        entity: 'costcode',
        retired: false
      });
      const lastState = await chain.lastState();
      if (!lastState) {
        chain = await StateChain.create({
          costcode: Domain.costcodeName(domain),
          entity: 'costcode',
          retired: false
        });
      }

      // sails.log.debug("POS CHECKPOINT 2.1.1.6.2", Date.now() - start);
      this.previous = StateChain.getId(lastState);
      // sails.log.debug("POS CHECKPOINT 2.1.1.6.3", Date.now() - start);
      // this is huge
      const calcHash = {};
      this.signature = await this.signRequest(calcHash);
      // sails.log.debug("POS CHECKPOINT 2.1.1.6.4", Date.now() - start);
      // cr.consumed = true;
      await CostCode.saveAsync(this);
      // sails.log.debug("POS CHECKPOINT 2.1.1.6.5", Date.now() - start);
      // this is even bigger
      await chain.addState(this, calcHash);
      // sails.log.debug("POS CHECKPOINT 2.1.1.6.6", Date.now() - start);
      return this;
    },

    /**
     * Creates a SHA256 hash of the transaction
     *
     * @returns {string}
     */
    calculateHash: async function(calcHash) {
      // const start = Date.now();
      const self = this.toObject();
      const id = CostCode.getId(self);

      let previous = '';

      if (self.previous) {
        const previousId = CostCode.getId(self.previous);

        if (calcHash && calcHash[previousId]) {
          previous = calcHash[previousId];
        } else {
          const pre = await CostCode.findOneById(previousId);
          // sails.log.debug(
          //   "POS CHECKPOINT 2.1.1.6.3.1.1",
          //   Date.now() - start,
          //   CostCode.getId(self),
          //   CostCode.getId(self.previous)
          // );
          previous = await pre.calculateHash(calcHash);
          // sails.log.debug(
          //   "POS CHECKPOINT 2.1.1.6.3.1.2",
          //   Date.now() - start,
          //   CostCode.getId(self),
          //   CostCode.getId(self.previous)
          // );
          if (calcHash) {
            calcHash[previousId] = previous;
          }
        }
      }

      if (calcHash && calcHash[id]) {
        return calcHash[id];
      }

      // self.signed_transaction +
      const hash = SHA256(
        previous +
          Model.getId(self.domain) +
          self.from +
          self.to +
          self.currency +
          self.amount +
          self.from_public_key +
          self.to_public_key +
          Model.getId(self.state_key) +
          Model.getId(self) +
          TimeUtils.isoFormattedDate(self.createdAt)
      ).toString();

      if (calcHash) {
        calcHash[id] = hash;
      }

      return hash;
    },

    /**
     * Signs a transaction with the given signingKey (which is an Elliptic keypair
     * object that contains a private key). The signature is then stored inside the
     * transaction object and later stored on the blockchain.
     *
     * @param {string} signingKey
     */
    signRequest: async function(calcHash) {
      // const start = Date.now();
      const _self = this.toObject();
      // sails.log.debug("POS CHECKPOINT 2.1.1.6.3.1", Date.now() - start);
      const sk = await StateKeys.findOne({
        target: CostCode.getId(_self),
        entity: 'costcode'
      });
      // sails.log.debug("POS CHECKPOINT 2.1.1.6.3.2", Date.now() - start);
      const signingKey = ec.keyFromPrivate(sk.private_key);
      // sails.log.debug("POS CHECKPOINT 2.1.1.6.3.3", Date.now() - start);
      if (signingKey.getPublic('hex') !== sk.public_key) {
        throw new Error(Const.err.STATE_OWN_SIGNATURE);
      }
      // Calculate the hash of this transaction, sign it with the key
      // and store it inside the state chain obect
      // sails.log.debug("POS CHECKPOINT 2.1.1.6.3.4", Date.now() - start);

      const hashTx = await this.calculateHash(calcHash);
      // sails.log.debug("POS CHECKPOINT 2.1.1.6.3.5", Date.now() - start);
      const sig = signingKey.sign(hashTx, 'base64');
      // sails.log.debug("POS CHECKPOINT 2.1.1.6.3.6", Date.now() - start);
      return sig.toDER('hex');
    },

    /**
     * Checks if the signature is valid (transaction has not been tampered with).
     * It uses the fromAddress as the public key.
     *
     * @returns {boolean}
     */
    isValid: async function(calcHash) {
      const self = this.toObject();
      const sk = await StateKeys.findOne({
        target: CostCode.getId(self),
        entity: 'costcode'
      });
      // If the transaction doesn't have a from address we assume it's a
      // mining reward and that it's valid. You could verify this in a
      // different way (special field for instance)
      if (sk.public_key === null) return true;

      if (!self.signature || self.signature.length === 0) {
        throw new Error(Const.err.STATE_VALID_SIGNATURE);
      }

      const publicKey = ec.keyFromPublic(sk.public_key, 'hex');
      const hashTx = await this.calculateHash(calcHash);
      return publicKey.verify(hashTx, self.signature);
    }
  },

  parseValue: function(value, currency) {
    const local = currencyFormat[currency || Const.DEFAULT_CURRENCY];
    const fraction = parseInt(local.fractionSize);
    const amount = value;
    return Dinero({
      amount: amount,
      currency: currency,
      precision: fraction
    }).toUnit();
  },

  asCurrency: function(ledger) {
    const balance = {};

    _.each(ledger, (values, currency) => {
      balance[currency] = {};
      _.each(values, (v, k) => {
        balance[currency][k] = CostCode.parseValue(v, currency);
      });
    });

    return balance;
  },

  getBalance: function(costcode, transactions) {
    const ledger = {};

    for (let i = 0; i < _.size(transactions); i++) {
      const transaction = transactions[i];
      const currency = transaction.currency;
      const amount = transaction.amount;
      ledger[currency] = ledger[currency] || {
        balance: 0,
        outgoing: 0,
        incoming: 0
      };

      if (transaction.from === costcode) {
        ledger[currency].outgoing += amount;
        ledger[currency].balance -= amount;
      }

      if (transaction.to === costcode) {
        ledger[currency].incoming += amount;
        ledger[currency].balance += amount;
      }
    }

    return ledger;
  },

  convertCurrency: function(value, currency) {
    const local = currencyFormat[currency || Const.DEFAULT_CURRENCY];
    const fraction = parseInt(local.fractionSize);
    const multiple = 10 ** fraction; // Math.pow(10, fraction);
    return parseInt(Math.ceil(value * multiple));
  },

  afterCreate: async function(values, next) {
    await StateKeys.registerState(values, 'costcode');
    next();
  },

  invoice: async function(details) {
    //  const start = Date.now();
    if (!details || details.amount == null) {
      throw new Error(Const.err.NO_COST_CODE_AMOUNT);
    }

    if (!details.from || !details.to) {
      throw new Error(Const.err.NOT_A_COST_CODE_TRANSACTION);
    }

    const stations = await Station.find({
      station_id: [details.from, details.to]
    });

    if (!_.size(stations)) {
      throw new Error(Const.err.NOT_A_COST_CODE_TRANSACTION);
    }

    const keys = await StateKeys.find().where({
      target: _.pluck(stations, 'id'),
      entity: 'station'
    });

    if (!_.size(keys)) {
      throw new Error(Const.err.NOT_A_COST_CODE_TRANSACTION);
    }

    const keyCache = {};
    const dId = details.domain;
    const domain = !dId
      ? Domain.defaultElements()
      : await Domain.findOneById(Domain.getId(dId));
    const domainCode = Domain.costcodeName(domain);

    if (details.from === domainCode || details.to === domainCode) {
      const domainKeys = await StateKeys.findOne().where({
        target: domain.id,
        entity: 'domain'
      });
      keyCache[domainCode] = domainKeys;
    }
    _.each(keys, key => {
      const target = key.target;
      const station = _.where(stations, { id: target })[0];
      keyCache[station.station_id] = key;
    });

    details.from_public_key = keyCache[details.from].public_key;
    details.to_public_key = keyCache[details.to].public_key;

    const site = await Site.thisSiteAsync(details.domain);
    details.currency =
      details.currency || site.currency || Const.DEFAULT_CURRENCY;

    const costcode = await CostCode.create(details);

    // sails.log.debug("POS CHECKPOINT 2.1.1.6", Date.now() - start);
    const chain = await costcode.addToStateChain();

    // sails.log.debug("POS CHECKPOINT 2.1.1.7", Date.now() - start);
    return chain;
  }
};
