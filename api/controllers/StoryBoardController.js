/**
 * StoryBoardController
 *
 * @description :: Server-side actions for handling incoming requests.
 * @help        :: See https://sailsjs.com/docs/concepts/actions
 */

module.exports = {
  findOne: (req, res) => {
    Utils.findOne(req, res, async model => {
      res.send(await StoryBoard.setStories(model));
    });
  },

  find: function(req, res) {
    Utils.getParser(req, res, async models => {
      res.send(await StoryBoard.setStories(models));
    });
  }
};
