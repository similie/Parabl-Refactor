/**
 * CostRequest.js
 *
 * @description :: A model definition.  Represents a database table/collection/etc.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

const SHA256 = require('crypto-js/sha256');
const EC = require('elliptic').ec;
const ec = new EC('secp256k1');
const cost_exp = process.env.COST_APPROVAL_EXP || '3h';
const { TimeUtils } = require('similie-api-services');
const now_ = TimeUtils.constants.now_;

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    costcode: {
      required: true,
      type: 'string'
    },

    target: {
      type: 'integer'
    },

    model: {
      type: 'string'
    },

    rule: {
      model: 'costrule'
    },

    requested_by: {
      model: 'user'
    },

    requested_through: {
      model: 'user'
    },

    status: {
      type: 'integer',
      min: -2,
      max: 2,
      defaultsTo: 0
    },

    statement_of_purpose: {
      type: 'text'
    },

    memo: {
      type: 'string'
    },
    /*
     * Send a message
     */
    coms: {
      type: 'boolean',
      defaultsTo: false
    },

    approved_by: {
      model: 'user'
    },

    request_signature: {
      unique: true,
      type: 'string'
    },

    expires_on: {
      type: 'datetime'
    },

    state_key: {
      unique: true,
      model: 'statekeys'
    },

    signature: {
      type: 'string'
    },

    previous: {
      model: 'costrequest'
    },

    consumed: {
      type: 'json',
      defaultsTo: false
    },

    submittal_files: {
      through: 'sub_file',
      collection: 'sysfile'
    },

    approval_files: {
      through: 'appr_file',
      collection: 'sysfile'
    },

    issue: function(expiration) {
      const _self = this.toObject();
      if (!_self.state_key || !_self.state_key.public_key) {
        return null;
      }
      return jwToken.issue(
        {
          approval: _self.state_key.public_key
        },
        expiration || cost_exp
      );
    },

    toJSON: function() {
      const values = this.toObject();
      delete values.hash;
      delete values.state_key;
      delete values.signature;
      delete values.request_signature;
      return values;
    },

    /**
     * Creates a SHA256 hash of the transaction
     *
     * @returns {string}
     */
    calculateHash: async function() {
      const self = this.toObject();
      let previous = '';
      if (self.previous) {
        const pre = await CostRequest.findOneById(
          CostRequest.getId(self.previous)
        );
        previous = await pre.calculateHash();
      }
      // self.previous_hash +
      return SHA256(
        previous +
          self.costcode +
          self.target +
          self.model +
          Model.getId(self.state_key) +
          Model.getId(self.rule) +
          Model.getId(self) +
          self.status +
          self.request_signature +
          TimeUtils.isoFormattedDate(
            self.createdAt
          ) /* [sg] moment().format() */
      ).toString();
    },

    /**
     * Signs a transaction with the given signingKey (which is an Elliptic keypair
     * object that contains a private key). The signature is then stored inside the
     * transaction object and later stored on the blockchain.
     *
     * @param {string} signingKey
     */
    signRequest: async function() {
      const _self = this.toObject();

      if (!_self.request_signature) {
        throw new Error(Const.err.STATE_VALID_SIGNATURE);
      }

      const self = await CostRequest.verify(_self.request_signature);

      const sk = await StateKeys.findOne({
        target: CostRequest.getId(self),
        entity: 'costrequest'
      });

      const signingKey = ec.keyFromPrivate(sk.private_key);

      if (signingKey.getPublic('hex') !== sk.public_key) {
        throw new Error(Const.err.STATE_OWN_SIGNATURE);
      }

      // Calculate the hash of this transaction, sign it with the key
      // and store it inside the transaction obect
      const hashTx = await this.calculateHash();
      const sig = signingKey.sign(hashTx, 'base64');
      return sig.toDER('hex');
    },

    /**
     * Checks if the signature is valid (transaction has not been tampered with).
     * It uses the fromAddress as the public key.
     *
     * @returns {boolean}
     */
    isValid: async function() {
      const self = this.toObject();
      const sk = await StateKeys.findOne({
        target: CostRequest.getId(self),
        entity: 'costrequest'
      });
      // If the transaction doesn't have a from address we assume it's a
      // mining reward and that it's valid. You could verify this in a
      // different way (special field for instance)
      if (sk.public_key === null) return true;
      if (!self.signature || self.signature.length === 0) {
        throw new Error(Const.err.STATE_VALID_SIGNATURE);
      }

      const publicKey = ec.keyFromPublic(sk.public_key, 'hex');
      const hashTx = await this.calculateHash();
      return publicKey.verify(hashTx, self.signature);
    }
  },

  isApprovedWithValidModel: function(cr) {
    return (
      cr.status === CostRequest.status().APPROVED && sails.models[cr.model]
    );
  },

  isNotApprovedWithValidModel: function(cr) {
    return (
      cr.status === CostRequest.status().REJECTED && sails.models[cr.model]
    );
  },

  getEmailMessageTemplates: function(cr) {
    const emailElements = {
      key:
        cr.status === 1 ? 'point_of_sale_approved' : 'point_of_sale_rejected',
      subject: 'point_of_sale_request_subject',
      body: 'point_of_sale_request_body'
    };

    const mail = {
      user_type: 'user',
      user: User.getId(cr.requested_by),
      costcode: cr.costcode,
      memo: cr.memo
    };

    return {
      emailElements,
      mail
    };
  },

  setApproval: async function(status, costrequest) {
    Utils.itsRequired(costrequest)(Utils.setErrorCode(Const.code.BAD_REQUEST));
    let cr = await CostRequest.findOneById(
      CostRequest.getId(costrequest)
    ).populateAll();

    const chain = await StateChain.findOrCreate({
      costcode: cr.costcode,
      entity: 'costrequest'
    });

    cr.previous = StateChain.getId(await chain.lastState());
    cr.status = status;
    cr.signature = await cr.signRequest();
    cr.consumed = true;
    await CostRequest.saveAsync(cr);
    if (this.isApprovedWithValidModel(cr)) {
      try {
        const model = await sails.models[cr.model];
        if (model && model.setRequestApprovalAsValid) {
          await model.setRequestApprovalAsValid(cr);
        }
      } catch (e) {
        sails.log.error(e);
      }
    } else if (this.isNotApprovedWithValidModel(cr)) {
      try {
        const model = await sails.models[cr.model];
        if (model && model.setRequestApprovalAsValid) {
          await model.setRequestApprovalAsInvalid(cr);
        }
      } catch (e) {
        sails.log.error(e);
      }
    }
    /*
      SEND THE APPROVAL STUFF
    */
    await chain.addState(cr);
    cr = await CostRequest.findOneById(CostRequest.getId(cr)).populateAll();

    if (cr.coms) {
      const templates = this.getEmailMessageTemplates(cr);
      Email.setUserComs(
        templates.mail,
        templates.emailElements,
        cr.approval_files
      );
    }

    return cr;
  },

  checkCredentials: async function(cr, params, domain) {
    const station = await Station.findOne({
      station_id: cr.costcode
    });

    if (!station) {
      throw new Error({
        error: 'A valid costcode is required before we can process this request'
      });
    }

    const user = await User.findOneById(params.approved_by);
    const requisition = await Requisition.findOne({
      station: Station.getId(station),
      user: params.approved_by
    });
    const domainRole = await User.getRole(user, domain);
    const role = (requisition || {}).role || domainRole;
    const clone = _.clone(user);
    clone.role = role;

    if (User.is(clone, Roles.MANAGER)) {
      return;
    }
    throw new Error({
      error: 'This user is not authorized to sign transactions'
    });
  },

  issueApprovalToken: async function(costrequest) {
    Utils.itsRequired(costrequest)(Utils.setErrorCode(Const.code.BAD_REQUEST));
    const cr = await CostRequest.findOneById(
      CostRequest.getId(costrequest)
    ).populate('state_key');
    const token = cr.issue();
    if (!token) {
      throw new Error(Const.err.TOKEN_ISSUE_FAILURE);
    }
    cr.request_signature = token;
    await CostRequest.saveAsync(cr);
    return cr.request_signature;
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
    const sk = await StateKeys.findOne({
      public_key: verified.approval,
      entity: 'costrequest'
    });
    return await CostRequest.destroy(sk.target);
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

    // [sg] if (moment(verified.exp).isAfter(moment())) { throw new Error(Const.err.APPROVAL_TOKEN_REQUIRED); }
    if (TimeUtils.date(verified.exp).isAfter(now_)) {
      throw new Error(Const.err.APPROVAL_TOKEN_REQUIRED);
    }

    const sk = await StateKeys.findOne({
      public_key: verified.approval,
      entity: 'costrequest'
    });

    if (!sk) {
      throw new Error(Const.err.APPROVAL_TOKEN_NOT_VERIFIED);
    }

    let cr;
    try {
      cr = await CostRequest.findOneById(sk.target).populateAll();
    } catch (e) {
      sails.log.error(e);
    }

    if (cr.request_signature !== token) {
      throw new Error(Const.err.APPROVAL_TOKEN_NOT_VERIFIED);
    }

    return cr;
  },

  beforeUpdate: async function(values, next) {
    /*
     * Doesn't protect everything
     */
    if (values.id) {
      const cr = await CostRequest.findOneById(values.id);
      if (cr.signature) {
        return next(Const.err.IMMUTABLE_DATA);
      }
    }
    next();
  },

  applyEmailTemplate: async function(values) {
    const station = await Station.findOne({
      station_id: values.costcode
    });
    const requisitions = await Requisition.find({
      station: Station.getId(station),
      role: Roles.MANAGER
    });

    const users = _.pluck(requisitions, 'user');
    const requested_by = User.getId(values.requested_by);

    for (let i = 0; i < _.size(users); i++) {
      const u = users[i];
      const mail = {
        user_type: 'user',
        user: u,
        costcode: values.costcode
      };

      const emailElements = {
        key: 'point_of_sale_mananger_request',
        subject: 'point_of_sale_request_subject',
        body: 'point_of_sale_request_body'
      };
      Email.setUserComs(mail, emailElements);
    }

    const mail = {
      user_type: 'user',
      user: requested_by,
      costcode: values.costcode
    };
    const emailElements = {
      key: 'point_of_sale_request',
      subject: 'point_of_sale_request_subject',
      body: 'point_of_sale_request_body'
    };
    Email.setUserComs(mail, emailElements);
  },

  afterCreate: async function(values, next) {
    await StateKeys.registerState(values, 'costrequest');
    if (!values.coms) {
      return next();
    }
    await CostRequest.applyEmailTemplate(values);
    next();
  },

  status: () => {
    return {
      ...{
        APPROVED: 1,
        PENDING: 0,
        REJECTED: -1
      }
    };
  }
};
