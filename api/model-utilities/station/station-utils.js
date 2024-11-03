class StationUtils {
  static async pullStationStateVariables() {
    const variables = await Variable.find({
      key: 'station_state'
    });

    const draft =
      _.where(variables, {
        identity: 'draft_state'
      }).pop() || {};
    const registered =
      _.where(variables, {
        identity: 'registered_state'
      }).pop() || {};
    const archived =
      _.where(variables, {
        identity: 'archived_state'
      }).pop() || {};
    return { draft, registered, archived };
  }
}

module.exports = { StationUtils };
