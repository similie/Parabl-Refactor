/**
 * IconController
 *
 * @description :: Server-side logic for managing Icons
 * @help        :: See http://sailsjs.org/#!/documentation/concepts/Controllers
 */

module.exports = {
  view: function(req, res) {
    res.view({
      layout: 'basic'
    });
  }
};
