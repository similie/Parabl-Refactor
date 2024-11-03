/**
 * HearbeatController
 *
 * @description :: Server-side logic for managing Hearbeats
 * @help        :: See http://sailsjs.org/#!/documentation/concepts/Controllers
 */

const SailsHelper = require('../services/SailsExtensions');
const { TimeUtils } = require('similie-api-services');
const now_ = TimeUtils.constants.now_;

const sendBlast = async params => {
  if (!params.device) {
    return;
  }
  const device = await Device.findOne({ serial_number: params.device });
  if (!device) {
    return;
  }
  sails.sockets.blast(`realtime-device-creation-${Device.getId(device)}`, {
    id: Model.getId(device),
    source: 'Heartbeat',
    data: params,
    time: TimeUtils.isoFormattedDate(now_)
  });
};

module.exports = {
  create: async function(req, res) {
    const params = req.params.all();
    await sendBlast(params);
    return SailsHelper.bluePrints.create(req, res);
  }
};
