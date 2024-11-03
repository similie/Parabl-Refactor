/**
 * AssetAssignment.js
 *
 * @description :: A model definition represents a database table/collection.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

const { TimeUtils } = require('similie-api-services');
const now_ = TimeUtils.constants.now_;

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    user: {
      model: 'user',
      required: true
    },
    asset: {
      model: 'station',
      required: true
    },

    active: {
      type: 'boolean',
      defaultsTo: true
    },

    alternatives: {
      collection: 'user'
    },

    returned: {
      type: 'boolean',
      defaultsTo: false
    },

    returned_date: {
      type: 'datetime'
    },

    transaction: {
      model: 'postransaction'
    },

    serial_bind: {
      model: 'nodeserial'
    },

    out_pos: {
      model: 'pointofsale'
    },

    in_pos: {
      model: 'pointofsale'
    },

    meta: {
      type: 'jsonb'
    }
  },

  returnAsset: async function(transaction) {
    const aa = await AssetAssignment.findOneById(
      AssetAssignment.getId(transaction.assignment)
    );
    // [SG]const moment = Time.getMoment();
    aa.returned = true;
    aa.returned_date = TimeUtils.isoFormattedDate(now_); // [SG]moment.format();
    aa.active = false;
    aa.out_pos = PointOfSale.getId(transaction.pointofsale);
    await AssetAssignment.saveAsync(aa);
    return aa;
  }
};
