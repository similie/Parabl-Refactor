/**
 * StoryBoard.js
 *
 * @description :: A model definition.  Represents a database table/collection/etc.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

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

  setStories: async function(models) {
    if (!_.size(models)) {
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

    if (_.isArray(models)) {
      _.each(models, m => {
        m.stories = StoryChapter.sortChapters(m.stories);
        _.each(m.stories, setModel(m));
      });
    } else {
      models.stories = StoryChapter.sortChapters(models.stories);
      _.each(models.stories, setModel(models));
      array = false;
    }

    if (!_.size(storyIds)) {
      return models;
    }

    const stories = await NodeStory.find()
      .where({ id: storyIds })
      .populateAll();
    const storyHold = storyCache(stories);

    if (array) {
      _.each(models, m => {
        const chapter = _.clone(m.__chapters);
        _.each(chapter, (value, id) => {
          if (value) {
            m.__chapters[id] = storyHold[id];
          }
        });
      });
    } else {
      models.__chapters = storyHold;
    }
    return models;
  }
};

// function storyObject(stories, nodeStories) {
//   const cache = storyCache(nodeStories);
//   const arr = [];
//   _.each(stories, function(s) {
//     arr.push(cache[s]);
//   });
//   return arr;
// }

function storyCache(nodeStories) {
  const cache = {};
  _.each(nodeStories, function(ns) {
    cache[ns.id] = ns;
  });
  return cache;
}
