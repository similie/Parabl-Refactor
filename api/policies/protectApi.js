const isStation = async (req, model) => {
  const actionUtil = Utils.actionUtil();

  try {
    const where =
      req.method === 'GET'
        ? actionUtil.parseCriteria(req)
        : actionUtil.parseValues(req);
    // might need to put this one else where
    if (req.headers.station && !_.isNaN(req.headers.station)) {
      return parseInt(req.headers.station);
    }
    // if it is specifically in the model
    if (where.station || (req.options.model === 'station' && where.id)) {
      return where.station || where.id;
    }

    const referer = req.headers.referer;
    // perhaps even the referer
    if (referer && _.contains(referer, 'stations')) {
      const split = referer.split('/');
      const stationIndex = _.indexOf(split, 'stations');
      for (let i = stationIndex; i < _.size(split); i++) {
        const word = split[i];
        const int = parseInt(word);
        if (!_.isNaN(int)) {
          return int;
        }
      }
    }
    // might have it in a a from and where param
    if (where.to || where.from) {
      const q = {};
      if (where.to) {
        q[_.isString(where.to) ? 'station_id' : 'id'] = where.to;
      } else if (where.from) {
        q[_.isString(where.from) ? 'station_id' : 'id'] = where.from;
      }
      const _station = await Station.findOne().where(q);
      if (_station) {
        return Station.getId(_station);
      }
    }

    const attrs = model._attributes;
    // lastly, look for it it the model with the id param
    if (where.id && Utils.containsValue(attrs, 'station', 'model')) {
      const element = await model.findOneById(where.id);
      if (element && element.station) {
        return Station.getId(element.station);
      }
    }
  } catch {}

  return null;
};

module.exports = async function(req, res, next) {
  const site =
    res.locals.siteData || (await Site.thisSiteAsync(res.locals.domain));
  const actionUtil = Utils.actionUtil();
  let Model;
  try {
    Model = actionUtil.parseModel(req);
  } catch (e) {
    return next();
  }
  let user = req.user;
  if (User.getId(req.user) !== -1) {
    user = await User.findOneById(User.getId(req.user));
  }
  let userRole = user.role || Roles.ANONYMOUS;
  const controller = req.options.controller;
  const permit = (site.permits || {})[controller];
  if (permit == null) {
    return next();
  }

  const stationContents = await isStation(req, Model);
  if (stationContents) {
    userRole = await Station.getRoleForStation(stationContents, user);
  }
  // const model = req.options.model;
  // const method = req.method.toLowerCase();
  const action = Utils.transformPermitActions(req.options.action);
  const permitted = permit[action];
  if (permitted == null) {
    return next();
  }

  const _user = _.clone(user);
  _user.role = userRole;
  if (User.is(_user, permitted)) {
    return next();
  } else {
    sails.log.error(
      'USER HAS FORBIDDEN ACCESS',
      action,
      controller || req.options.model,
      permit
    );
    return res.forbidden({
      error: 'errors.FORBIDDEN_ACCESS',
      model: req.options.model
    });
  }
};
