/**
 * Sub_file.js
 *
 * @description :: A model definition.  Represents a database table/collection/etc.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

module.exports = {
  migrate: (process.env.MIGRATION || 'safe'),
  attributes: {

    sysfile: {
        model: 'sysfile'
    },

    costrequest: {
        model: 'costrequest'
    }
  },

};

