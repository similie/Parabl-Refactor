const { resolve, isProd } = require('../../../builds/utils');

module.exports = function webpackHook(sails) {
  return {
    defaults: {
      __configKey__: {
        // Wait 15 minutes before timing out.
        // I know that I'm freaking out, but sometimes it takes longer than I expected.
        // Better safe than sorry.
        _hookTimeout: 150000
      }
    },
    /**
     * Runs when this Sails app loads/lifts.
     */
    initialize: function(done) {
      try {
        if (!isProd()) {
          done();
          return;
        }

        // We inject this variables in production to get chunk hash
        const base = require(resolve('.tmp/public/base.manifest.json'));
        const main = require(resolve('.tmp/public/main.manifest.json'));
        sails.config.webpackManifest = { isProd: isProd(), base, main };
        done();
      } catch (error) {
        done(error);
      }
    }
  };
};
