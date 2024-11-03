/**
 * NodeController
 *
 * @description :: Server-side logic for managing Nodes
 * @help        :: See http://sailsjs.org/#!/documentation/concepts/Controllers
 */
const escape = require('pg-escape');
const { TimeUtils } = require('similie-api-services');

module.exports = {
  serials: async function(req, res) {
    const params = req.params.all();
    if (!params.node) {
      return res.badRequest({
        error: ['errors.NODE_ID_REQUIRED']
      });
    }

    if (!params.name) {
      return res.badRequest({
        error: ['errors.PARAM_NAME_REQUIRED']
      });
    }

    if (!params.schema) {
      return res.badRequest({
        error: ['errors.SCHEMA_REQUIRED']
      });
    }

    if (!params.id) {
      return res.badRequest({
        error: ['errors.SCAN_ID_REQUIRED']
      });
    }

    const parentSchema = await NodeSchema.findOneById(params.parent);
    const schema = await NodeSchema.findOneById(params.schema);
    if (!schema || !parentSchema) {
      return res.badRequest({
        error: 'errors.NO_VALID_SCHEMA_FOUND'
      });
    }
    const helpers = Module._helpers.logistics();
    const logParentParams = helpers.logParams(parentSchema.schema);
    const logParams = helpers.logParams(schema.schema);
    const serialParam = NodeSerial.getSerialParam(parentSchema, params.name);
    const quantity = params.quantity ? parseInt(params.quantity) : 1;
    if (params.id === '__AUTO__GENERATED_PARAMETER__') {
      const param =
        _.where(schema.schema, {
          name: logParams('sku')
        })[0] || {};
      params.id = await Node.skuAutoCode(param);
    } else {
      params.id = Node.restrictValueTypesForBarcode(params.id);
    }
    const node = (await Node.findOneById(params.node, parentSchema)) || {};
    if (!node) {
      return res.badRequest({
        error: 'errors.NODE_ENTITY_NOT_FOUND'
      });
    }

    const service_item = node[logParentParams('service_item')] || false;
    const toltalAvailable = node[logParentParams('quantity')];
    // node.quantity += quantity;
    if (quantity > toltalAvailable && !service_item) {
      return res.badRequest({
        error: 'errors.SERIALS_AT_MAX_CAPACITY'
      });
    } else if (serialParam.unique_identity && quantity > 1) {
      return res.badRequest({
        error: 'errors.UNIQUE_IDENTITY_VIOLATED'
      });
    }

    if (serialParam.unique_identity) {
      try {
        await NodeSerial.buildUnique({
          schema: schema,
          sku: params.id,
          force: params.force
        });
        delete params.force;
      } catch (e) {
        const error = {
          errors: e.message,
          identity: User.is(req.user, Roles.USER_ADMIN)
            ? NodeSerial.errorCodes.UNIQUE_VALUES_VIOLATED
            : 0
        };
        return res.badRequest(error);
      }
    }

    let createdNode = (
      await Node.findNodes({ where: { [logParams('sku')]: params.id } }, schema)
    )[0] || {
      [logParams('sku')]: params.id,
      [logParams('quantity')]: 0,
      station: -1,
      observer: User.getId(req.user)
    };
    // look now we look at the serialized node
    const serials = await NodeSerial.find().where({
      owned_by_node: Model.getId(node),
      owned_by_schema: NodeSchema.getId(parentSchema),
      possessed_by_schema: NodeSchema.getId(schema),
      via_param: params.name
    });
    let currentQuantity = parseInt(quantity);
    const nIds = [];
    const count = NodeSerial.getSerialCount(serials, nIds);
    currentQuantity += count;

    if (
      !service_item &&
      (currentQuantity > toltalAvailable || toltalAvailable <= 0)
    ) {
      return res.badRequest({
        error: 'errors.SERIALS_AT_MAX_CAPACITY'
      });
    }
    const send = {
      quantity: quantity
    };

    if (_.size(nIds)) {
      const children = await Node.findNodes(
        {
          where: {
            id: NodeSerial.compress(nIds),
            __available__: true
          }
        },
        schema
      );

      const child = NodeSerial.findNodeForUpdate(
        params.id,
        logParams('sku'),
        children
      );

      if (child) {
        const cId = Model.getId(child);
        createdNode = child; // Node.clone(child);
        // createdNode[logParams("sku")] += quantity;
        // currentQuantity = createdNode[logParams("quantity")];
        // now we need to know when referece
        const currentSerial = _.where(serials, {
          possessed_by_node: cId
        });

        if (_.size(currentSerial)) {
          // currentSerial[0].quantity = createdNode[logParams("quantity")];
          const serial = currentSerial[0];
          serial.quantity += quantity;
          await NodeSerial.saveAsync(serial);
          send.serial = serial; // await NodeSerial.saveAsync(currentSerial[0]);
        }
      }
    }
    createdNode.__available__ = true;
    createdNode[logParams('quantity')] += quantity;
    send.quantity = currentQuantity;
    // here we clear out any other reference in this system to this item.
    send.node = await Node.updateOrCreate()({
      params: createdNode,
      schema: schema
    });
    // we are going to start setting counts
    node[params.name] = node[params.name] || {};
    node[params.name].count = currentQuantity;
    // Node.stripAssociations(node)(parentSchema);
    const createValues = {
      owned_by_node: Model.getId(node),
      owned_by_schema: NodeSchema.getId(parentSchema),
      possessed_by_schema: NodeSchema.getId(schema),
      via_param: params.name,
      quantity: quantity
    };
    send.serial =
      send.serial ||
      (await NodeSerial.create({
        ...createValues,
        possessed_by_node: Model.getId(send.node)
      }));

    if (service_item) {
      // const count = await NodeSerial.count().where(createValues);
      node[logParentParams('quantity')] = currentQuantity || 0;
    }

    await Node.updateOrCreate()({
      params: node,
      schema: parentSchema
    });
    res.send(send);
  },

  scanner: async function(req, res) {
    const params = req.params.all();
    const domain = res.locals.domain;

    if (!params.station) {
      return res.badRequest({
        error: ['errors.STATION_ID_REQUIRED']
      });
    }

    if (!params.schema) {
      return res.badRequest({
        error: ['errors.SCHEMA_REQUIRED']
      });
    }

    if (!params.id) {
      return res.badRequest({
        error: ['errors.SCAN_ID_REQUIRED']
      });
    }

    const schema = await NodeSchema.findOneById(params.schema);

    if (!schema) {
      return res.badRequest({
        error: ['errors.VALID_SCHEMA_ID_REQUIRED']
      });
    }

    const qParams = {};

    _.each(schema.schema, s => {
      if (s.logistics_parameter) {
        qParams[s.param_purpose] = s;
      }
    });

    if (schema.is_inventory) {
      /*
       * We find the node and we change it to our
       */

      // cccd2dee-b53c-4ffa-82b3-c9f811d5ae37
      const nodes = await Node.findNodes(
        {
          where: {
            scannable_id: params.id
          }
        },
        schema
      );

      if (_.size(nodes) > 1) {
        return res.badRequest({
          error: ['errors.DUPLICATE_ENTRIES_FOUND']
        });
      }

      const node = nodes.pop();

      if (!node) {
        return res.badRequest({
          error: ['errors.NODE_ENTITY_NOT_FOUND']
        });
      }

      const original = Node.clone(node);

      node.domain = Domain.getId(node.domain || {});
      node.observer = User.getId(node.observer || {});

      const clone = Node.clone(node);

      clone.station = parseInt(params.station);
      clone.domain = Domain.getId(domain);
      clone.observer = User.getId(req.user);
      const qParam = qParams.quantity.name;
      const skuParam = qParams.sku.name;

      if (node.station === clone.station) {
        return res.badRequest({
          error: ['errors.NODE_ENTITY_WITH_SAME_ORIGIN']
        });
      }

      node[qParam]--;

      if (node[qParam] < 0) {
        // trigger some waring.
      }

      const sku = node[skuParam];
      const existingNodes = await Node.findNodes(
        {
          where: {
            [skuParam]: sku,
            station: clone.station
          }
        },
        schema
      );

      let saved = null;

      await Node.save(node, schema);

      if (!_.size(existingNodes)) {
        delete clone.id;
        clone[qParam] = 1;
        saved = await Node.save(clone, schema);
        sails.sockets.blast(
          schema.name,
          {
            id: saved.id,
            verb: 'created',
            data: saved
          },
          req
        );
      } else {
        if (_.size(existingNodes) > 1) {
          return res.badRequest({
            error: ['errors.DUPLICATE_ENTRIES_FOUND']
          });
        }
        const existingNode = existingNodes.pop();
        existingNode[qParam]++;
        existingNode.observer = User.getId(req.user);
        existingNode.domain = clone.domain;
        saved = await Node.save(existingNode, schema);
        sails.sockets.blast(
          schema.name,
          {
            id: saved.id,
            verb: 'updated',
            data: saved
          },
          req
        );
      }

      // we store every transaction
      InventoryTransfer.create({
        schema: NodeSchema.getId(schema),
        from_station: Station.getId(original.station),
        to_station: Station.getId(saved.station),
        from_node: node.id,
        to_node: saved.id,
        approved_by: null,
        initiated_by: User.getId(saved.observer),
        from_user: User.getId(original.observer),
        from_value: saved[qParam],
        to_value: node[qParam],
        serial_from: params.id,
        serial_to: saved.scannable_id
      }).exec(err => {
        if (err) {
          sails.log.error(err);
        }
      });

      sails.sockets.blast(
        schema.name,
        {
          id: node.id,
          verb: 'updated',
          data: node
        },
        req
      );

      return res.send(saved);
    } else {
      const nodes = await Node.findNodes(
        {
          where: {
            scannable_id: params.id
          }
        },
        schema
      );

      if (_.size(nodes) > 1) {
        return res.badRequest({
          error: ['errors.DUPLICATE_ENTRIES_FOUND']
        });
      }

      const node = nodes.pop();

      if (!node) {
        return res.badRequest({
          error: ['errors.NODE_ENTITY_NOT_FOUND']
        });
      }
      const clone = _.clone(node);
      node.station = parseInt(params.station);
      node.domain = Domain.getId(domain);
      // const originalObserver = User.getId(node.observer);
      node.observer = User.getId(req.user);

      const saved = await Node.save(node, schema);

      InventoryTransfer.create({
        schema: NodeSchema.getId(schema),
        from_station: Station.getId(clone.station),
        to_station: Station.getId(node.station),
        from_node: node.id,
        to_node: saved.id,
        approved_by: null,
        initiated_by: User.getId(node.observer),
        from_user: User.getId(clone.observer),
        from_value: 1,
        to_value: 1,
        serial_from: params.id,
        serial_to: saved.scannable_id
      }).exec(err => {
        if (err) {
          sails.log.error(err);
        }
      });
      // then we save the transaction
      sails.sockets.blast(
        schema.name,
        {
          id: clone.id,
          verb: 'destroyed',
          data: clone
        },
        req
      );
      sails.sockets.blast(
        schema.name,
        {
          id: saved.id,
          verb: 'created',
          data: saved
        },
        req
      );
      res.send(node);
    }
  },

  all_counts: function(req, res) {
    const params = req.params.all();
    const schema = params.schema || process.env.SITE_SCHEMA || 'nodes';
    const query =
      "select array_to_json(array_agg(t)) from (select tablename as table, btrim(xpath('/table/row/count/text()', x)::text,'{}')::integer as rowcnt from (select tablename,query_to_xml('select count(*) from '||tablename,false,false,'') as x from pg_tables where schemaname = '%s' order by 1) as z) as t;";
    Model.query(escape(query, schema), (err, result) => {
      if (err) {
        return res.serverError(err);
      }
      res.send(
        (
          result || {
            rows: []
          }
        ).rows
      );
    });
  },

  scatteredPoints: async function(req, res) {
    const params = req.params.all();
    const nodesValues = params.nodes;
    const domain = res.locals.domain;
    if (!_.size(nodesValues)) {
      return res.badRequest('errors.NODES_IDS_REQUIRED');
    }
    const pointsPuller = Node.pullPoints(params);
    const allPoints = [];

    try {
      const nodeSchemas = await NodeSchema.find({
        id: nodesValues,
        domain: domain
      });

      for (let i = 0; i < nodeSchemas.length; i++) {
        const nodeSchema = nodeSchemas[i];
        if (!nodeSchema.has_point) {
          throw new Error('NodeSchema as no point attribute');
        }
        const pointRows = await pointsPuller(nodeSchema);
        if (!pointRows.length) {
          continue;
        }
        allPoints.push(...pointRows);
      }
      res.send(allPoints);
    } catch (e) {
      sails.log.error('NodeController.scatteredPoints::error', e.message);
      res.serverError(e.message);
    }
  },

  points: function(req, res) {
    const params = req.params.all();

    if (!params.__model) {
      return res.badRequest('errors.NODE_REQIRED');
    }

    Node.pullSchema(params, res)
      .then(schema => {
        if (!schema.has_point) {
          throw new Error('NO Point Attribute for Schema');
        }
        return schema;
      })
      .then(Node.pullPoints(params))
      .then(rows => {
        res.send(rows);
      })
      .catch(why => {
        sails.log.error('NodeController.points::error', why.message);
        res.serverError(why.message);
      });
  },
  excel: async function(req, res) {
    const params = req.params.all();
    if (!params.__model) {
      return res.badRequest('errors.NODE_REQIRED');
    }
    if (params.__mutate) {
      const mutate = params.__mutate;
      delete params.__mutate;
      const selector = (mutate.__selector || '').split(' as ');
      delete mutate.__selector;
      const __model = mutate.__model;
      delete mutate.__model;
      if (__model) {
        const _mod = sails.models[__model];
        if (_mod) {
          const models = await _mod.find().where(mutate);
          const values = _.pluck(models, selector[0]);
          if (_.size(values)) {
            params.where = params.where || {};
            params.where[selector[1]] = values;
          }
        }
      }
    }
    Jobs.generateNodeExcel.add({
      user: req.user.id,
      socket: sails.sockets.getId(req),
      query: params,
      domain: res.locals.domain,
      language: req.session.language,
      config: res.locals.siteData
    });

    res.send({
      message: 'labels.PROCESSING_EXCEL'
    });
  },

  count: function(req, res) {
    const params = req.params.all();
    const user = req.user;
    if (!User.is(user, Roles[Node.roles.count])) {
      return res.forbidden();
    }
    Node.pullSchema(params, res)
      .then(Node.countNode(req))
      .then(query => {
        const send = {};
        if (query.length) {
          send.total = query[0].count;
        }

        res.send(send);
      })
      .catch(why => {
        sails.log.error(why.message);
        res.badRequest(why.message);
      });
  },

  token: function(req, res) {
    const params = req.params.all();
    const invite = _.clone(res.locals.invite);
    delete invite.token;
    Contact.findOneById(invite.target)
      .then(contact => {
        invite.target = contact;
        return invite;
      })
      .then(invite => {
        invite.meta = invite.meta || {};
        const station = parseInt(params.station);
        if (station && station === -1) {
          return Station.global().then(station => {
            invite.meta.station = station;
            return invite;
          });
        }
        return Station.findOneById(invite.meta.station).then(station => {
          invite.meta.station = station;
          return invite;
        });
      })
      .then(invite => {
        return Variable.resolveVariables(invite.node.schema);
      })
      .then(variables => {
        invite.variables = variables;
        return invite;
      })
      .then(invite => {
        NodeSchema.stripSchema(invite.node);
        return invite;
      })
      .then(invite => {
        res.send(invite);
      })
      .catch(why => {
        sails.log.error(why);
        res.serverError(why);
      });

    // res.send(invite);
  },

  submit: function(req, res) {
    const params = req.params.all();

    if (!params.token) {
      return res.badRequest('errors.NO_TOKEN_FOUND');
    }

    if (!params.node) {
      return res.badRequest('errors.NO_NODE_FOUND');
    }

    const invite = _.clone(res.locals.invite);
    const model = (params.node.model = invite.node.name);
    Node.create(params.node, req, res)
      .then(node => {
        // return res.send(node);
        if (req._sails.hooks.pubsub && _.size(node)) {
          sails.sockets.blast(
            model,
            {
              id: node.id,
              verb: req.method === 'PUT' ? 'updated' : 'created',
              data: node
            },
            req
          );
        }

        Invite.consume(params.token, err => {
          if (err) {
            sails.log.error(err);
          }

          (
            Modules[model] ||
            function(req, res, sails, update) {
              res.send(update);
            }
          )(req, res, sails, node);
        });
      })
      .catch(why => {
        sails.log.error(why);
        res.serverError(why);
      });
  },

  index: function(req, res) {
    // var params = req.params.all();
    res.view('index/index');
  },

  invite: function(req, res) {
    const params = req.params.all();

    if (!params.contact) {
      return res.badRequest('errors.CONTACT_DETAILS_REQUIRED');
    }

    if (!params.station) {
      return res.badRequest('errors.STATION_DETAILS_REQUIRED');
    }

    Node.pullSchema(params, res)
      .then(function getSchema(schema) {
        return schema;
      })
      .then(function getVariables(schema) {
        return {
          schema: schema
        };
        // var key = Email.variables.data.key || 'contact_invite_email';
        // return Variable.find({key: key}).then(function(vars) {
        //     return {variables: vars, schema:schema};
        // });
      })
      .then(function getStation(payload) {
        const station = parseInt(params.station);
        if (station && station === -1) {
          return Station.global().then(station => {
            payload.station = station;
            return payload;
          });
        }

        return Station.findOneById(params.station).then(station => {
          payload.station = station;
          return payload;
        });
      })
      .then(function getContact(payload) {
        // preferred_language
        return Contact.findOneById(params.contact).then(contact => {
          payload.contact = contact;
          return payload;
        });
      })
      .then(function getConfig(payload) {
        // preferred_language
        return Site.findOne({
          active: true
        }).then(config => {
          const c = {
            site_url: config.site_url,
            default_language: config.default_language,
            site_name: config.site_name,
            api_route: config.api_route,
            secure_protocol: config.secure_protocol
          };

          payload.config = c;
          return payload;
        });
      })
      .then(function sendEmail(payload) {
        if (!payload.contact) {
          return res.badRequest('errors.CONTACT_NOT_FOUND');
        }

        if (!payload.schema) {
          return res.badRequest('errors.NODE_NOT_FOUND');
        }

        if (!payload.station) {
          return res.badRequest('errors.STATION_NOT_FOUND');
        }

        if (!payload.config) {
          return res.serverError('errors.SITE_CONFIG_NOT_FOUND');
        }

        payload.requestor = req.user.id;
        payload.contact.sendDataInviteEmail(payload, err => {
          if (err) {
            return res.serverError(err);
          }

          // res.send(payload);
          res.ok();
        });
      })

      .catch(why => {
        sails.log.error(why.message);
        res.serverError(why.message);
      });
  },

  alter: async function(req, res) {
    const p = req.params.all();
    if (!p.__model) {
      return res.badRequest();
    }
    const isArray = _.isArray(p) || p['0'];

    const values = isArray ? Utils.pullArray(p) : [p];
    const saved = [];
    const model = p.__model;

    for (let i = 0; i < _.size(values); i++) {
      const params = values[i];
      const user = req.user;
      if (
        !(await Requisition.requisitionRole(
          user,
          params.station,
          Node.roles.alter
        ))
      ) {
        return res.forbidden();
      }

      // we do this for the device early warning systems
      if (
        !params.observer &&
        // removing because we want this
        // to automatically add through sess
        // req.headers['authentication'] &&
        req.user &&
        req.method === 'POST'
      ) {
        params.observer = req.user.id;
      }

      if (!params.domain) {
        params.domain = Domain.getId(res.locals.domain) || null;
      }

      try {
        const updated = await Node.create(params, req, res);
        if (req._sails.hooks.pubsub && _.size(updated)) {
          sails.sockets.blast(
            `${model}-${Station.getId(updated.station)}`,
            {
              id: updated.id,
              verb: req.method === 'PUT' ? 'updated' : 'created',
              data: updated
            },
            req
          );

          sails.sockets.blast(
            `node-rendering-activity-${Station.getId(updated.station)}`,
            {
              id: updated.id,
              verb: req.method === 'PUT' ? 'updated' : 'created',
              data: {
                node: model,
                instance: updated
              }
            },
            req
          );
        }
        const _node = await new Promise(resolve => {
          (
            Modules[model] ||
            function(_req, _res, update) {
              resolve(update);
            }
          )(req, res, updated, resolve);
        });
        saved.push(_node);
      } catch (e) {
        sails.log.error(e);
        if (e.message) {
          return res.negotiate(e);
        }
        const respose = e.response || 'negotiate';
        delete e.response;
        return res[respose](e);
      }
    }
    const _node = isArray ? saved : saved[0];
    return res.send(_node);
  },

  get: async function(req, res) {
    const params = req.params.all();
    const timer = new TimeUtils.PerformanceTimer(5); // [sg] moment();
    if (!params.__model) {
      return res.badRequest();
    }
    const user = req.user;
    if (!User.is(user, Roles[Node.roles.get])) {
      return res.forbidden();
    }

    Node.pullSchema(params, res, user)
      .then(Node.getNode(req))
      .then(query => {
        let q;
        // this allows us to send the
        // one record
        if (params.id) {
          q = query.pop() || {};
        } else {
          q = query;
        }
        /*
            We need to look at only active parameters
            Node.sendNode(q); // also parse the JSON here
        */
        // [sg]const end = moment();
        // [sg]const duration = moment.duration(end - timer).asMilliseconds();
        const duration = timer.stop().milliseconds;
        sails.log.debug('NODE QUERY DURATION', duration);
        res.send(q);
      })
      .catch(err => {
        sails.log.error(err.message);
        res.negotiate(err);
      });
  },

  delete: async function(req, res) {
    const params = req.params.all();

    if (!params.__model || !params.id) {
      return res.badRequest();
    }

    // const node = await this.get(req, res);

    const model = params.__model;
    Node.pullSchema(params, res)
      .then(Node.deleteNode(req))
      .then(query => {
        if (req._sails.hooks.pubsub && _.size(query)) {
          sails.sockets.blast(
            model,
            {
              id: query.id,
              verb: 'destroyed',
              data: query
            },
            req
          );
        }

        res.send(query);
      })
      .catch(err => {
        sails.log.error(err.message);
        res.negotiate(err);
      });
  }
};
