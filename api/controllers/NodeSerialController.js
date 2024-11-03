/**
 * NodeSerialController
 *
 * @description :: Server-side actions for handling incoming requests.
 * @help        :: See https://sailsjs.com/docs/concepts/actions
 */

const SailsExtensions = require('../services/SailsExtensions');

module.exports = {
  decrement: async function(req, res) {
    const params = req.params.all();

    if (!params.id) {
      return res.badRequest({ error: 'This route requires an id' });
    }

    const ns = await NodeSerial.findOneById(params.id);

    if (!ns) {
      return res.badRequest({ error: 'Serial not found' });
    }

    if (!ns.possessed_by_node) {
      return res.serverError({ error: 'We cannot find a valid node' });
    }

    const schema = await NodeSchema.findOneById(ns.possessed_by_schema);
    if (!schema) {
      return res.serverError({ error: 'Undefined Serial Schema' });
    }

    const node = await Node.findOneById(ns.possessed_by_node, schema);
    const send = { count: 0 };
    if (!node) {
      return res.send(send);
    }
    const currentQuantity = ns.quantity;
    const helpers = Module._helpers.logistics();
    const serialParams = helpers.logParams(schema.schema);
    const subtract = params.all ? currentQuantity : 1;
    const quantity = currentQuantity - subtract;

    send.count = quantity;
    ns.quantity = quantity;

    node[serialParams('quantity')] -= subtract;
    const suicide = async () => {
      const nsId = NodeSerial.getId(ns);
      StationAsset.destroy({ serial_bind: nsId }, err => {
        if (err) {
          sails.log.error(err);
        }
      });
      try {
        await NodeSerial.destroy({ id: NodeSerial.getId(ns) });
        if (node[serialParams('quantity')] <= 0) {
          await Node.updateOrCreate()({
            params: { id: node.id, __available__: false },
            schema: schema
          });
        }
      } catch (e) {
        sails.log.error(e);
      }
    };

    const pSchema = await NodeSchema.findOneById(
      NodeSchema.getId(ns.owned_by_schema)
    );
    if (!pSchema) {
      await suicide();
    } else {
      const pNode = await Node.findOneById(ns.owned_by_node, pSchema);
      if (!pNode) {
        await suicide();
      } else {
        pNode[ns.via_param].count -= quantity;
        await Node.updateOrCreate()({
          params: pNode,
          schema: pSchema
        });
        await Node.updateOrCreate()({
          params: node,
          schema: schema
        });

        if (ns.quantity <= 0 || !ns.via_param) {
          await suicide();
        } else {
          await NodeSerial.saveAsync(ns);
        }
      }
    }
    res.send(send);
  },

  reference: async function(req, res) {
    const method = req.method;
    if (_.indexOf(['POST', 'DELETE'], method) === -1) {
      return res.badRequest({ error: 'Invalid Request Method' });
    }
    const params = req.params.all();
    if (!params.serials) {
      return res.badRequest({
        error: 'Serials required'
      });
    }

    if (!params.identity) {
      return res.badRequest({
        error: 'Identity required'
      });
    }

    try {
      const nSerials = await NodeSerial.iterateSerializeItems(params, method);
      res.send(nSerials);
    } catch (e) {
      sails.log.error('SERIAL_REFERENCING_ERROR::Reference', e);
      return res.serverError({ error: e.message });
    }
  },

  validate: async function(req, res) {
    const params = req.params.all();
    if (!params.sku) {
      return res.badRequest({
        error: 'SKU required'
      });
    }
    if (!params.identity) {
      return res.badRequest({
        error: 'Identity required'
      });
    }
    try {
      const valid = await NodeSerial.isUnique(params);
      return res.send({ valid: valid });
    } catch (e) {
      return res.serverError({ error: e.message });
    }
  },

  findOne: function(req, res) {
    SailsExtensions.findOne(req, res, async model => {
      const response = await NodeSerial.pullNodes(model);
      res.send(response);
    });
  },

  find: function(req, res) {
    SailsExtensions.getParser(req, res, async models => {
      const response = await NodeSerial.pullNodes(models);
      res.send(response);
    });
  }
};
