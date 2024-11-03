/**
 * NodeStory.js
 *
 * @description :: A model definition.  Represents a database table/collection/etc.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

module.exports = {
  attributes: {
    name: 'string',
    backgroundColor: 'string',
    borderColor: 'string',
    imageURL: 'string',
    derivative: {
      model: 'nodeschema'
    },
    classes: 'string',
    size: 'integer',
    height: 'integer',
    context: 'json',
    content: 'text',
    report: {
      model: 'report'
    },
    domain: {
      model: 'domain'
    },
    tags: {
      collection: 'tag'
    },
    force_hide: 'boolean',
    has_table: 'boolean',
    has_chart: 'boolean',
    has_map: 'boolean',

    table: 'json',
    chart: 'json',
    map: 'json',
    sorting: 'json',
    meta: 'json',
    story_category: {
      model: 'variable'
    }
  },

  processModule: async function(ns, context) {
    const meta = ns.meta;
    if (!meta || !meta.hasModule || !meta.module) {
      throw new Error('No valid module found');
    }

    const query = meta.module.query;
    const moduleJoin = query.split('.');
    if (moduleJoin.length !== 2) {
      throw new Error('Invalid module name');
    }
    const modelName = moduleJoin[0];
    const model = sails.models[modelName];
    if (!model) {
      throw new Error('Invalid model type name');
    }
    if (!_.isFunction(model.storyModules)) {
      throw new Error(`No story modules found for ${modelName}`);
    }
    const functionName = moduleJoin[1];
    const module = model.storyModules(functionName, context);
    return await module();
  }
};
