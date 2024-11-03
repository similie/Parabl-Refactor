/**
 * EventDependents.js
 *
 * @description :: A model for ensuring events are trigger based on other dependent events.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

const { SqlUtils } = require('similie-api-services');

module.exports = {
  migrate: process.env.MIGRATION || 'safe',
  attributes: {
    event: {
      model: 'earlywarning',
      required: true
    },

    depends_on: {
      model: 'earlywarning',
      required: true
    },
    // time in minutes, time to wait before triggering the event
    // the event time must be lessthan the parent timeout
    delay: {
      type: 'integer',
      defaultsTo: 0
    },

    event_category: {
      type: 'string',
      in: ['earlywarning', 'eventcluster'],
      defaultsTo: 'earlywarning'
    }
  },

  /**
   * @description we do this recursive query so we do not create a dependency whereby and event cannot
   * trigger becaue it depends on itself somewhere in the chain of dependencies
   * @param {EarlyWarning} event
   * @returns
   */
  selectInvalidDependentsQuery: function(event) {
    const escape = SqlUtils.escapeUtil();
    const query = `	with recursive rel_tree as (
      SELECT "ed".*, 1 as level, array["ed"."depends_on"] as "path_info" FROM "eventdependent" "ed" WHERE "ed"."depends_on" = %s
      UNION ALL 
      SELECT "ed2".*, "p".level + 1, "p".path_info||"ed2"."depends_on" FROM "eventdependent" "ed2"
      join rel_tree "p"  
      on ((ARRAY[]::int[] || p.event::int) @> (ARRAY[]::int[] || "ed2".depends_on::int) )
      WHERE "p"."depends_on" <> "ed2"."depends_on" AND "p".level < 20
)
      select *
      from rel_tree
      order by "id" ASC;`;
    return escape(query, this.getId(event));
  },

  /**
   * @description wraps the recursive parents query
   * @param {EarlyWarning} event
   * @returns {number[]}
   */
  pullInvalidParents: async function(event) {
    const query = this.selectInvalidDependentsQuery(event);
    const results = await this.queryAsync(query);
    return results.rows.map(e => this.getId(e.event));
  },

  /**
   * @description this tells us what events are already set
   * @param {EarlyWarning} event
   * @returns
   */
  alreadySetIDQuery: function(event) {
    const escape = SqlUtils.escapeUtil();
    const query = `SELECT "depends_on" FROM "eventdependent" WHERE "event" = %s`;
    return escape(query, this.getId(event));
  },

  /**
   * @description wraps already set ID query
   * @param {EarlyWarning} event
   * @returns {number[]}
   */
  alreadySetID: async function(event) {
    const query = this.alreadySetIDQuery(event);
    const results = await this.queryAsync(query);
    return results.rows.map(r => this.getId(r.depends_on));
  },

  /**
   * @description we are trying to avoid circular dependencies. We don't want our
   * events to fail-to-trigger due to invalid configuration
   * @param {Station} station
   * @param {EarlyWarning} event
   * @returns
   */
  selectInvalidDependents: async function(station, event) {
    const invalidIds = await this.pullInvalidParents(event);
    const alreadySet = await this.alreadySetID(event);
    const query = await this.stationBasedAvailabilityQueryPool(station, event, [
      ...invalidIds,
      ...alreadySet
    ]);
    const results = await this.queryAsync(query);
    return results.rows.map(r => this.getId(r));
  },

  /**
   * @description builds a query for to pull valid events for a station
   * @param {Station} station
   * @param {EarlyWarning} event
   * @param {number[]} events
   * @returns {string}
   */
  stationBasedAvailabilityQueryPool: function(station, event, events = []) {
    let query = `SELECT
    "ew"."id"
  FROM
    "earlywarning" "ew"	
  WHERE
    "ew"."station" = %s 
    AND "ew"."id" <> %s 
    AND "ew"."active" IS TRUE `;
    if (events.length) {
      query += 'AND "ew"."id" NOT %s ';
    }
    query += 'ORDER BY "ew"."id"';
    const escape = SqlUtils.escapeUtil();
    return escape(
      query,
      this.getId(station),
      this.getId(event),
      SqlUtils.setInString(events)
    );
  }
};
