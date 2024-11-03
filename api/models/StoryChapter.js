/**
 * StoryChapter.js
 *
 * @description :: A model definition represents a database table/collection.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */
const _lo = require("lodash");
module.exports = {
  migrate: process.env.MIGRATION || "safe",
  attributes: {
    story: {
      model: "nodestory"
    },
    sizeX: {
      type: "integer",
      min: 0
    },
    sizeY: {
      type: "integer",
      min: 0
    },
    col: {
      type: "integer",
      min: 0
    },
    row: {
      type: "integer",
      min: 0
    },
    context: {
      type: "json"
    }
  },

  sortChapters: function(stories) {
    const groups = _lo.groupBy(stories, "row");
    const hold = [];
    _.each(_.sortBy(groups, "row"), group => {
      hold.push(..._.sortBy(group, "col"));
    });

    return hold;
  }
};
