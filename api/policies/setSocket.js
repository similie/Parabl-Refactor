/*
 * We are going to maintain track of the user socket id.
 * This will allow us some pretty great flexibility for
 * broadcasting messages to specific users.
 */

module.exports = async function(req, _res, next) {
  if (!req.user || !req.isSocket) {
    return next();
  }

  try {
    await UserSession.prune(req);
    await UserSession.reqSocket(req);
  } catch (e) {
    await UserSession.breakSessions(req);
    sails.log.error('setSocket::USERSESSION_ERROR', e.message);
  }

  next();
};
