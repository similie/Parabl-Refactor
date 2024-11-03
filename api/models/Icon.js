/**
 * Icon.js
 *
 * @description :: TODO: You might write a short summary of how this model works and what it represents here.
 * @docs        :: http://sailsjs.org/documentation/concepts/models-and-orm/models
 */

module.exports = {
  attributes: {
    class_name: 'string',
    glyph: {
      type: 'string',
      maxLength: 6
    },
    package: {
      type: 'string',
      defaultsTo: 'un'
    },
    category: {
      type: 'string'
    }
  }
};
