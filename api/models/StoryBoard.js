/**
 * StoryBoard.js
 *
 * @description :: A model definition.  Represents a database table/collection/etc.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

const commonUtils = require('../utils/common')

module.exports = {
  migrate: process.env.MIGRATION || "safe",
  attributes: {
    name: {
      type: "string"
    },

    active: {
      type: "boolean"
    },

    stories: {
      collection: "storychapter"
    },

    tags: {
      collection: "tag"
    },

    options: {
      type: "json"
    },

    meta: {
      type: "json"
    }
  },

  /**
   * Sets the stories for the given models, organizing them by chapters.
   * @param {Object|Array} models - The model or array of models to set stories for.
   * @returns {Promise<Object|Array>} - The updated model(s) with stories set.
   */
  setStories: async function(models) {
    if (!commonUtils.size(models)) {
      return models;
    }
    let storyIds = [];
    let array = true;

    const setModel = model => {
      model.__chapters = {};
      return story => {
        const sId = NodeStory.getId(story.story);
        if (!model.__chapters[sId]) {
          storyIds.push(sId);
        }
        model.__chapters[sId] = true;
      };
    };

    if (commonUtils.isArray(models)) {
      commonUtils.each(models, m => {
        m.stories = StoryChapter.sortChapters(m.stories);
        commonUtils.each(m.stories, setModel(m));
      });
    } else {
      models.stories = StoryChapter.sortChapters(models.stories);
      commonUtils.each(models.stories, setModel(models));
      array = false;
    }

    if (!commonUtils.size(storyIds)) {
      return models;
    }

    const stories = await NodeStory.find()
      .where({ id: storyIds })
      .populateAll();
    const storyHold = storyCache(stories);

    if (array) {
      commonUtils.each(models, m => {
        const chapter = commonUtils.clone(m.__chapters);
        commonUtils.each(chapter, (value, id) => {
          if (value) {
            m.__chapters[id] = storyHold[id];
          }
        });
      });
    } else {
      models.__chapters = storyHold;
    }
    return models;
  },

  /**
   * Caches the node stories by their IDs.
   * @param {Array} nodeStories - The array of node stories to cache.
   * @returns {Object} - A cache object mapping story IDs to node stories.
   */
  storyCache: function(nodeStories) {
    const cache = {};
    commonUtils.each(nodeStories, function(ns) {
      cache[ns.id] = ns;
    });
    return cache;
  }
};

// function storyObject(stories, nodeStories) {
//   const cache = storyCache(nodeStories);
//   const arr = [];
//   commonUtils.each(stories, function(s) {
//     arr.push(cache[s]);
//   });
//   return arr;
// }
