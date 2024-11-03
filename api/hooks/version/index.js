const pkg = require('../../../package.json')

module.exports = function (sails) {
  return {
    initialize(done) {
      sails.config.ONE_VERSION = pkg.version
      done()
    }
  }
}
