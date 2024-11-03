function getEwFromContext(res) {
  const schema = res.locals.schema;
  const ew =
    res &&
    res.locals.siteData &&
    res.locals.siteData.has_early_warning &&
    schema &&
    schema.has_early_warning;
  return ew;
}

function buildAncestory(res, node) {
  const schema = res.locals.schema;
  const domain = res.locals.domain;
  const ancestry = {
    domain: Model.getId(domain),
    schema: Model.getId(schema),
    node: Model.getId(node),
    station: Model.getId(node.station),
    device: res.locals.device
  };
  return ancestry;
}

function getLocals(res, device) {
  const schema = res.locals.schema;
  const domain = res.locals.domain;
  return {
    schema: schema,
    device: device,
    domain: domain
  };
}

module.exports = {
  node: function(_req, res) {
    return async function(node) {
      const ew = getEwFromContext(res);

      if (!ew) {
        return node;
      }

      const ancestry = buildAncestory(res, node);
      if (Site.isInTestMode()) {
        await Station.stationLineageTracker(ancestry);
      } else {
        Jobs.stationLineageTracker.add(ancestry);
      }

      const deviceId = Device.getId(res.locals.device || node.__device__);
      const device = deviceId ? await Device.findOneById(deviceId) : null;
      const locals = getLocals(res, device);
      const results = await EarlyWarning.process(node, locals);
      return results.node;
    };
  }
};
