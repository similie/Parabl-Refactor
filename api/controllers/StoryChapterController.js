/**
 * StoryChapterController
 *
 * @description :: Server-side actions for handling incoming requests.
 * @help        :: See https://sailsjs.com/docs/concepts/actions
 */

module.exports = {
  bulk: async function(req, res) {
    if (req.method !== 'PUT') {
      return res.badRequest({
        error: 'This reqest can only be a PUT request'
      });
    }
    const updates = [];
    const params = req.params.all();
    for (const id in params) {
      const values = params[id];
      const updated = await StoryChapter.update({ id: id }, values);
      updates.push(...updated);
    }
    res.send(updates);
  }
};
