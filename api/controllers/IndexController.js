/**
 * IndexController
 *
 * @description :: Server-side logic for managing indices
 * @help        :: See http://sailsjs.org/#!/documentation/concepts/Controllers
 */

module.exports = {
  post_test: function(req, res) {
    res.send('OK');
  },

  browsers: function(req, res) {
    res.locals.inSupport = true;
    res.view('extras/browsers');
  },

  restricted: function(req, res) {
    res.view();
  },

  username: function(req, res) {
    const params = req.params.all();
    if (!params.username) {
      return res.badRequest();
    }

    User.findOne({ username: params.username }).exec((err, user) => {
      if (err) {
        return res.serverError();
      }
      const send = {};
      send.valid = !user;
      res.send(send);
    });
  },

  token: function(req, res) {
    const params = req.params.all();
    if (!params.token) {
      return res.badRequest();
    }

    Invite.findOne({
      token: params.token,
      active: true
    }).exec((err, token) => {
      if (err) {
        return res.negotiate(err);
      }

      if (!token || !token.target) {
        return res.badRequest({
          error: 'errors.TOKEN_NOT_FOUND'
        });
      }

      User.findOneById(token.target).exec((err, user) => {
        if (err) {
          return res.negotiate(err);
        }

        if (!user) {
          return res.badRequest({ error: 'errors.TOKEN_NOT_VALID' });
        }

        res.send(user.toJSON());
      });
    });
  },

  track: function(req, res) {
    const params = req.params.all();
    // we set the user activity model to track their every move
    UserActivity.set(
      UserActivity.CLIENT_PAGE_EXPLORED,
      { path: params.href, useragent: params.useragent },
      req,
      err => {
        if (err) {
          sails.log.error(err);
        }
      }
    );
    res.ok();
  },

  auth: function(req, res) {
    res.view('index/index', {
      layout: 'layout'
    });
  },

  public: function(req, res) {
    res.view('index/index', {
      layout: 'layout'
    });
  },

  index: function(req, res) {
    res.view('index/index', {
      layout: 'layout'
    });
  },

  index6: function(req, res) {
    res.view('index/index6', {
      layout: 'layout6'
    });
  },

  socket: function(req, res) {
    res.send(sails.sockets.getId(req));
  },

  language: function(req, res) {
    const params = req.params.all();
    let language;
    switch (req.method) {
      case 'GET':
        // needs production testing
        if (req.headers.authorization && req.store) {
          language = req.store.getData().language;
        } else {
          language = req.session.language;
        }
        res.send({
          language: language
        });
        break;
      case 'POST':
        /*
         * HERE WE should check the headers
         * for the token
         * req.headers['authorization']
         */
        if (req.headers.authorization && req.store) {
          req.store.add('language', params.language);
        } else {
          req.session.language = params.language;
          req.session.save();
        }

        req.setLocale(params.language);
        res.send({
          language: params.language
        });
        break;
      default:
        res.send({
          action: null
        });
    }
  },

  geo: async function(req, res) {
    return res.badRequest({ error: 'Not Defined' });
    // const id = req.param('id');
    // if (!id) {
    //   return res.badRequest({ error: 'A Station ID is required' });
    // }
    // const station = await Station.findOneById(id);
    // if (!station) {
    //   return res.badRequest({ error: 'No Station Found With That ID' });
    // }

    // const geoJson = await Geo.aggregateLineChildren(
    //   station,
    //   `"s"."schema"->>'segment_id'`
    // );
    // if (!geoJson) {
    //   return res.badRequest({ error: 'Segment Details Are Empty' });
    // }

    // return res.send(geoJson);
    // // return res.badRequest({ error: 'Not Defined' });
    // // var FormulaParser = require('hot-formula-parser').Parser;
    // // var parser = new FormulaParser();
    // // var params = req.params.all();
    // // return res.badRequest();
    // // shape file imports
    // const values = {
    //   file: 'pipeline_segments.zip',
    //   entity_type: 'station',
    //   relation: 'pipesegments',
    //   variables: ['station_type'],
    //   map: {
    //     // fid: {
    //     //   selector: 'name',
    //     //   against: 'fid',
    //     //   entity: '',
    //     //   selected: ''
    //     // },
    //     DN: {
    //       case: {
    //         1: [
    //           {
    //             value: '#00ff00',
    //             selector: 'color'
    //           },
    //           {
    //             value: 'Low',
    //             selector: 'description'
    //           },
    //           {
    //             value: { en: 'Manatuto Winds Low' },
    //             selector: 'name'
    //           }
    //         ],
    //         2: [
    //           {
    //             value: '#ff8000',
    //             selector: 'color'
    //           },
    //           {
    //             value: 'Medium',
    //             selector: 'description'
    //           },
    //           {
    //             value: { en: 'Manatuto Winds Medium' },
    //             selector: 'name'
    //           }
    //         ],
    //         3: [
    //           {
    //             value: '#ff0000',
    //             selector: 'color'
    //           },
    //           {
    //             value: 'High',
    //             selector: 'description'
    //           },
    //           {
    //             value: { en: 'Manatuto Winds High' },
    //             selector: 'name'
    //           }
    //         ]
    //       }
    //       // 3: {
    //       //   against: 'feature_flood_risk_danger'
    //       // },
    //       // 1: {
    //       //   against: 'feature_risk_danger'
    //       // }
    //     }
    //   }
    //   // fills: {
    //   //   geo: {
    //   //     type: 'geometry',
    //   //     value: ''
    //   //   },
    //   //   type: {
    //   //     value: { identity: 'feature_wind_risk_danger' },
    //   //     type: 'variable'
    //   //   }
    //   //   // name: {
    //   //   //   value: 'Metinaro Floods'
    //   //   // }
    //   // }
    // };
    // const job = await Jobs.processShapeFiles.add(values);

    // return res.send({ JOB: job });
  }
};
