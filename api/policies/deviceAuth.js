/*
 *
 */

module.exports = function(req, res, next) {
  const params = req.params.all();
  if (
    params.confirmationToken &&
    params.messageType === 'DestinationConfirmation'
  ) {
    return res.ok();
  }

  if (notADevice(req)) {
    return next();
  }

  const auth = req.headers.authentication;
  const secret = req.headers.secret;
  // @todo - [AS] consider different code
  // const applyDevice = device => {
  //   if (device.ip && device.ip !== req.ip) {
  //     throw new Error('errors.IP_ADDRESS_RESTRICTED');
  //   }

  //   return new Promise((resolve, reject) => {
  //     device.validateSecret(secret, async (err, valid) => {
  //       if (err) {
  //         return reject(err);
  //       }

  //       if (!valid) {
  //         return reject(new Error('errors.INVALID_SECRET'));
  //       }
  //       await DeviceTracker.createPayloadDevice(params, device);
  //       res.locals.device = device.toJSON();
  //       if (!device.owner) {
  //         return reject(new Error('Error: Cannot Identify the device'));
  //       }

  //       req.headers.authorization =
  //         'JWT ' + jwToken.issue(device.owner.toJSON());

  //       resolve();
  //     });
  //   });
  // };
  // Device.find({ access_key: auth, active: true })
  //   .populateAll()
  //   .exec(async (err, devices) => {
  //     if (err) {
  //       return next(err);
  //     }

  //     if (!devices.length) {
  //       return res.forbidden('errors.DEVICE_NOT_FOUND');
  //     }

  //     try {
  //       for (let i = 0; i < devices.length; i++) {
  //         const device = devices[i];
  //         await applyDevice(device);
  //         if (!req.headers.authorization) {
  //           continue;
  //         }
  //         break;
  //       }
  //       next();
  //     } catch (e) {
  //       sails.log.error(e);
  //       return next(e);
  //     }
  // });

  Device.findOne({ access_key: auth })
    .populateAll()
    .exec((err, device) => {
      if (err) {
        return next(err);
      }

      if (!device) {
        return res.badRequest('errors.DEVICE_NOT_FOUND');
      }

      if (!device.active) {
        return res.badRequest('errors.DEVICE_DISABLED');
      }

      if (device.ip && device.ip !== req.ip) {
        return res.badRequest('errors.IP_ADDRESS_RESTRICTED');
      }

      device.validateSecret(secret, async (err, valid) => {
        if (err) {
          return next(err);
        }

        if (!valid) {
          return res.badRequest('errors.INVALID_SECRET');
        }
        await DeviceTracker.createPayloadDevice(params, device);
        res.locals.device = device.toJSON();
        if (!device.owner) {
          return next('Error: Cannot Identify the device');
        }

        req.headers.authorization =
          'JWT ' + jwToken.issue(device.owner.toJSON());

        next();
      });
    });
};

function notADevice(req) {
  // we will only take post and get requests from our devices
  return (
    (req.method !== 'POST' && req.method !== 'GET') ||
    !req.headers.authentication ||
    !req.headers.secret
  );
}
