/*
 * Bull job queue holder
 *
 * Queue will be loaded into this object in bootstrap.js
 */

const SkipperAdapter = sails.config.skipper.adapter;
const fileAdapter = SkipperAdapter(sails.config.skipper);
const Q = require('q');
const { CommonUtils } = require('similie-api-services');
const SailsExtensions = require('./SailsExtensions');
const { GeoZipUtils, GeoUtils } = require('../model-utilities/geo/geo-utils');

module.exports = {
  _processors: [
    {
      name: 'processShapeFiles',
      process: async function(job) {
        const json = job.data;

        console.log('GETTING THIS JOB STARTED', json.file);
        const stationType = await StationSchema.findOne({
          station_url: json.relation
        });
        const variables = await Variable.find().where({ key: 'station_state' });
        const [stationState] = variables.filter(
          f => f.identity === 'registered_state'
        );

        const createdStations = [];

        const stationBuilder = async (line, geoString) => {
          const lineValue = line.value || {};
          const properties = lineValue.properties || {};
          const fid = properties.fid;
          const length = await Geo.getLineLength(geoString);
          const station = {
            station_type: Model.getId(stationType),
            local_name: `FFDTL-Baucau Pipe Segment ${fid}`,
            station_state: Model.getId(stationState),
            geo: geoString,
            domain: 1,
            settings: {},
            schema: {
              segment_id: fid,
              length: length
            },
            parents: [604],
            meta: {}
          };
          const createdStation = await Station.create(station);
          createdStations.push(createdStation);
        };

        const zipUtils = new GeoZipUtils(json.file);

        try {
          await zipUtils.downloadZip();
          const shapeFiles = zipUtils.shapeFiles;
          for (let i = 0; i < shapeFiles.length; i++) {
            const shapeFile = shapeFiles[i];
            const path = `${zipUtils.importFile}/${shapeFile}`;
            await GeoUtils.readShapeFile(path, async line => {
              if (!line.value || !line.value.geometry) {
                return;
              }
              const geoString = await Geo.stringGeometryFromGeoJson(
                line.value.geometry
              );
              await stationBuilder(line, geoString);
            });
          }
        } catch (e) {
          sails.log.error(e);
        }

        // const localZip = await zipUtils.downloadZip();
        // console.log('GOT MY ZIP', localZip);
        // const file_base = Geo.gets3BaseForShapes();
        // const import_base = Site.getImportBase();
        // const createModel = sails.models[json.entity_type];
        // const SkipperAdapter = sails.config.skipper.adapter;
        // const fileAdapter = SkipperAdapter(sails.config.skipper);
        // const zip = require('file-zip');
        // const generate = require('project-name-generator');
        // const shapefile = require('shapefile');
        // /*
        //  * This local function will be responsible for
        //  * parsing the json schema
        //  * @param Object - the json schema
        //  * @return function
        //  */
        // const parse_import = function(json) {
        //   const definition = json.entity_definition;
        //   const map = json.map;
        //   const scheme = sails.models[definition];
        //   let waiting = true;
        //   const count = 0;

        //   const locals = {
        //     definition: [],
        //     variable: []
        //   };

        //   async.series(
        //     [
        //       function(cb) {
        //         if (!scheme) {
        //           return cb();
        //         }

        //         scheme.find().exec(function(err, sc) {
        //           if (err) {
        //             sails.log.error(err);
        //           }

        //           _.each(sc, function(s) {
        //             locals.definition.push(s);
        //           });

        //           cb();
        //         });
        //       },
        //       function(cb) {
        //         if (_.size(json.variables)) {
        //           Variable.find({
        //             key: json.variables
        //           }).exec(function(err, vars) {
        //             if (err) {
        //               sails.log.error(err);
        //             }
        //             _.each(vars, function(variable) {
        //               locals.variable.push(variable);
        //             });
        //             cb();
        //           });
        //         } else {
        //           return cb();
        //         }
        //       }
        //     ],
        //     function() {
        //       waiting = false;
        //     }
        //   );

        //   const elemental = function(
        //     element,
        //     selector,
        //     value,
        //     map,
        //     against,
        //     entity,
        //     selected,
        //     arrayObject,
        //     caseElement
        //   ) {
        //     // if we have a. we recurse to find the base object
        //     if (caseElement) {
        //       const caseValues = caseElement[value] || [];
        //       caseValues.forEach(caseValue => {
        //         element[caseValue.selector] = caseValue.value;
        //       });
        //     } else if (_.contains(selector, '%') && !_.isArray(element)) {
        //       const splits = selector.split('%');
        //       const key = splits[0];
        //       element[key] = element[key] || [];
        //       arrayObject[key] = arrayObject[key] || {};
        //       splits.splice(0, 1);
        //       elemental(
        //         element[key],
        //         splits.join('.'),
        //         value,
        //         map,
        //         against,
        //         entity,
        //         selected,
        //         arrayObject[key]
        //       );
        //     } else if (_.contains(selector, '.')) {
        //       const splits = selector.split('.');
        //       const key = splits[0];
        //       element[key] = element[key] || {};
        //       arrayObject[key] = arrayObject[key] || {};
        //       splits.splice(0, 1);
        //       elemental(
        //         element[key],
        //         splits.join('.'),
        //         value,
        //         map,
        //         against,
        //         entity,
        //         selected,
        //         arrayObject[key]
        //       );
        //     } else {
        //       arrayObject[selector] = arrayObject[selector] || {};

        //       if (map) {
        //         // now we need the attribute type
        //         const _attr = map[value];

        //         if (_attr == null) {
        //           arrayObject[selector] = value;
        //         } else {
        //           const search = locals[entity];
        //           const find_element = _.where(search, {
        //             [against]: _attr
        //           });
        //           if (_.size(find_element) === 1) {
        //             const found = find_element[0];
        //             selected = selected || 'id';
        //             arrayObject[selector] = found[selected];
        //           } else {
        //             arrayObject[selector] = null;
        //           }
        //         }
        //       } else {
        //         arrayObject[selector] = value;
        //       }

        //       if (!_.isArray(element)) {
        //         _.merge(element, arrayObject);
        //         delete arrayObject[selector];
        //       }
        //     }
        //   };

        //   const mergeObjects = function(element, arrayBuffer) {
        //     _.each(element, function(el, key) {
        //       if (_.isArray(el) && _.size(arrayBuffer[key])) {
        //         el.push(arrayBuffer[key]);
        //       }
        //     });
        //   };

        //   let counter = 0;

        //   return function parse(line, cb) {
        //     if (waiting && count < 20) {
        //       return setTimeout(parse, 100, line, cb);
        //     }

        //     const element = {};
        //     const stuffed = {};
        //     const props = line.properties;

        //     Object.keys(map).forEach(function(key) {
        //       const el = map[key];
        //       // this is one the one scheme side
        //       const selector = el.selector;
        //       const value = props[key];
        //       const local_map = el.selection_map;
        //       const against = el.against;
        //       const entity = el.entity;
        //       const selected = el.selected;
        //       const caseElement = el.case;
        //       elemental(
        //         element,
        //         selector,
        //         value,
        //         local_map,
        //         against,
        //         entity,
        //         selected,
        //         stuffed,
        //         caseElement
        //       );
        //     });

        //     mergeObjects(element, stuffed);
        //     /*
        //      * Fills are to stuff extra values
        //      */

        //     a_sync.forEachOf(
        //       json.fills,
        //       function(fill, key, next) {
        //         const [var_value] = _.where(locals.variable, fill.value);
        //         switch (fill.type) {
        //           // so far we only have a random name
        //           // generator support namebuilds for
        //           // required name fields
        //           case 'name_generator':
        //             element[key] = generate()[fill.prop];
        //             return next();
        //           case 'geometry':
        //             // settled the geo
        //             Geo.stringGeometryFromGeoJson(line[fill.type]).then(
        //               function(geoString) {
        //                 element[key] = geoString;
        //                 next();
        //               },
        //               Utils.errorLog(next)
        //             );
        //             break;
        //           case 'variable':
        //             if (var_value) {
        //               element[key] = Variable.getId(var_value);
        //             }
        //             return next();
        //           default:
        //             element[key] = (fill || {}).value;
        //             return next();
        //         }
        //       },
        //       function() {
        //         sails.log.debug('THIS IS THE PREBUILD', ++counter);
        //         sails.log.debug(
        //           '========================BREAK======================='
        //         );
        //         createModel.create(element, function(err, build) {
        //           if (err) {
        //             sails.log.error(err);
        //           } else {
        //             // sails.log.debug(build);
        //           }

        //           sails.log.debug(
        //             '========================BREAK======================='
        //           );

        //           cb();
        //         });
        //       }
        //     );
        //   };
        // };
        // // we build the parser
        // const parser = parse_import(json);
        // // create a promise
        // Q.fcall(function() {
        //   const file = json.file;
        //   const deferred = Q.defer();
        //   if (!file) {
        //     throw new Error({
        //       error: 'errors.FILE_FIELD_REQUIRED'
        //     });
        //   }

        //   const zipFile = import_base + '/' + file;
        //   const importFile = zipFile.replace('.zip', '');
        //   // this is the default placement
        //   if (!json.local) {
        //     try {
        //       // we kill these files if they exist
        //       Utils.clearDirectory(importFile);
        //     } catch (e) {
        //       sails.log.error(e);
        //     }
        //     // the file adapter reads the shape file

        //     fileAdapter.read(file_base + file, function(err, fBuffer) {
        //       if (err) {
        //         return deferred.reject({
        //           error: err
        //         });
        //       }

        //       zip.unzip(fBuffer, importFile, async function(err) {
        //         if (err) {
        //           return deferred.reject(err);
        //         }

        //         const shapeFiles = [];

        //         let shapeFile = '';

        //         const folderFiles = fs.readdirSync(importFile);

        //         for (let i = 0; i < folderFiles.length; i++) {
        //           const folerFile = folderFiles[i];
        //           if (!folerFile.endsWith('.shp')) {
        //             continue;
        //           }
        //           shapeFiles.push(folderFiles);
        //         }

        //         if (!shapeFiles.length) {
        //           throw new Error('Error No File');
        //         }

        //         /*
        //          * Now we are going the search for the .shp file, since
        //          * ew don't already know the name
        //          */
        //         fs.readdirSync(importFile).forEach(function(name) {
        //           if (_.contains(name, '.shp')) {
        //             shapeFile = importFile + '/' + name;
        //             return shapefile;
        //           }
        //         });
        //         console.log('BOOMO', shapeFile);
        //         if (!shapeFile) {
        //           return deferred.reject({
        //             error: 'errors.NO_SHAPE_FILE_FOUND',
        //             folder: true
        //           });
        //         }

        //         deferred.resolve({
        //           shapeFile: shapeFile,
        //           folder: importFile
        //         });
        //       });
        //     });
        //   } else {
        //     // for debugging purposes
        //     deferred.resolve({
        //       shapeFile: importFile + '/' + json.local,
        //       folder: importFile
        //     });
        //   }
        //   return deferred.promise;
        // }, Utils.errorLog(cb))
        //   .then(function(files) {
        //     const deferred = Q.defer();
        //     let counter = 0;

        //     console.log('GOT THESE FILES', files);

        //     shapefile
        //       .open(files.shapeFile)
        //       .then(function(source) {
        //         source
        //           .read()
        //           .then(function logger(line) {
        //             counter++;

        //             if (line.done || counter >= json.max_import) {
        //               return deferred.resolve();
        //             }

        //             parser(line.value, function(err) {
        //               if (err) {
        //                 return deferred.reject(err);
        //               }

        //               source
        //                 .read()
        //                 .then(logger)
        //                 .catch(deferred.reject);
        //             });
        //           })
        //           .catch(deferred.reject);
        //       }, deferred.reject)
        //       .catch(deferred.reject);

        //     return deferred.promise;
        //   })
        //   .then(cb)
        //   .catch(Utils.errorLog(cb));
      },

      stats: stats({
        completed: function(job) {
          // Utils.sendReport(null, result);
          sails.log.debug('Shape Processor::', job.id);
        },
        failed: function(job, err) {
          sails.log.error('Shape Processor ERRROR::', err);
          // Utils.sendexcelMessage(err, job.data);
        }
      })
    },

    {
      name: 'generateReport',
      process: function(_job, cb) {
        cb();
      },

      stats: stats({
        completed: function() {
          //
        },
        failed: function(_job, err) {
          console.error('REPORT GENERATION ERROR', err);
          // Utils.sendexcelMessage(err, job.data);
        }
      })
    },

    {
      name: 'sendEmail',
      process: async function(job, cb) {
        const locals = job.data.locals || {};
        const from = job.data.from;
        const to = job.data.to;
        const subject = job.data.subject;
        const template = job.data.template;
        const data = job.data.data;
        const key = job.data.variables;
        const default_language =
          job.data.default_language || Translates.fallbackLanguage;
        const tags = job.data.tags;
        const attachments = job.data.attachments || [];

        const attachedFiles = [];
        for (let i = 0; i < _.size(attachments); i++) {
          const attachment = attachments[i];
          if (attachment.encoding === 'base64') {
            attachedFiles.push({
              content: Buffer.from(attachment.content, 'base64'),
              filename: attachment.filename
            });
          } else {
            const file = {
              filename: attachment.filename,
              content: await SysFile.fileStream(attachment)
            };
            attachedFiles.push(file);
          }
        }

        try {
          const variables = await Variable.find({ key: key });
          const vars = await new Promise((resolve, reject) => {
            Email.parseEmailVars(
              template,
              variables,
              default_language,
              (err, vars) => {
                if (err) {
                  return reject(new Error(err));
                }
                resolve(vars);
              }
            );
          });
          locals.email_vars = vars;

          // get default domain to replace from.name if the payload is empty
          const defaultDomain = await Domain.getDefaultDomain();

          // if payload empty use default domain name
          const fromParamsName = (from && from.name) || defaultDomain.name;
          const name = fromParamsName
            ? `${sails.config.mail.defaultSubject ||
                'No Reply'}, ${fromParamsName}`
            : '';

          // from payload
          const fromParams = Email.fromDefault(name, from);

          // email payload
          const payload = {
            from: fromParams,
            to,
            subject: CommonUtils.parseLocals(
              subject || vars.email_subject,
              locals
            ),
            tags: tags,
            template: template,
            // attachments: attachments,
            body: CommonUtils.parseLocals(
              vars.email_body || locals.body,
              locals
            )
          };

          const email = await Email.create(payload);

          email.send(
            locals,
            data,
            function(err, res, msg) {
              if (err) {
                sails.log.error(err);
              }
              let resolution = err || res;
              if (_.isObject(resolution)) {
                resolution = JSON.stringify(resolution);
              }
              email.resolution = resolution;
              email.save(function(err) {
                cb(err, res, msg);
              });
            },
            attachedFiles
          );
        } catch (e) {
          sails.log.error(e);
          return cb(e);
        }
      },

      stats: stats({
        completed: function() {
          //
        },
        failed: function(job, err) {
          sails.log.error('EMAIL SEND FAIL::', err);
          job.remove().then(function(r) {
            sails.log.debug(r);
          });
        }
      })
    },

    {
      name: 'createStationExcel',
      process: function(job) {
        const data = job.data;
        const def = Q.defer();
        const params = data.query;
        const station_types = (params.where || {}).station_type;
        // select DISTINCT(station_type) from station where station_type IS NOT NULL
        if (!station_types) {
          return def.reject();
        }

        User.findOneById(data.user)
          .then(function(user) {
            return user;
          })
          .then(function(user) {
            return StationSchema.find({
              id: station_types,
              sort: 'createdAt'
            }).then(function(ss) {
              return {
                user: user,
                schemes: ss
              };
            });
          })
          .then(function(payload) {
            return Variable.resolveVariables(
              payload.schemes,
              ['station_state', 'station_type'],
              'schema'
            ).then(function(variables) {
              payload.variables = variables;
              return payload;
            });
          })
          .then(function(payload) {
            const schemes = [];

            _.each(payload.schemes, function(s) {
              schemes.push(s.schema);
            });
            const labels = _.pluck(_.union(Station.schema(), schemes), 'label');
            return Variable.find({
              key: Translates.translateIdentity,
              identity: labels
            }).then(function(variables) {
              payload.header_vars = variables;
              return payload;
            });
          })
          .then(function(payload) {
            const deferred = Q.defer();
            const schemes = payload.schemes;
            const where = _.clone(params || {});
            delete where.skip;
            delete where.limit;
            delete where.station_type;
            async.forEach(
              schemes,
              function(s, next) {
                where.where.station_type = s.id;
                Station.find(where)
                  .populateAll()
                  .then(function(stations) {
                    Station.set_geo_string(stations, function(err, stations) {
                      if (err) {
                        sails.log.error();
                        return next(err);
                      }

                      s.fill = stations;
                      next();
                    });
                  });
              },
              function() {
                deferred.resolve(payload);
              }
            );
            return deferred.promise;
          })
          .then(function(payload) {
            payload.config = data.config;
            payload.language = data.language;
            payload.socket = data.socket;
            // quick fix
            payload.var_cache = payload.var_cache || {};
            //  console.log('GOT THIS MASSIVE PAYLOAD', payload);
            csv.buildStationExcel(payload, function(err, result) {
              if (err) {
                return def.reject(err);
              }
              def.resolve(result);
            });
          })
          .catch(def.reject);

        return def.promise;
      },

      stats: stats({
        completed: function(_job, result) {
          SailsExtensions.broadcastSocketMessage(null, result);
        },
        failed: function(job, err) {
          SailsExtensions.broadcastSocketMessage(err, job.data);
        }
      })
    },

    {
      name: 'contactEmail',
      process: function(job, cb) {
        if (!job.data.contact) return cb(new Error('errors.NO_CONTACT_DATA'));
        const contact = new Contact._model(job.data.contact);
        if (!contact.email) return cb(new Error('errors.NO_EMAIL'));
        contact.sendContactEmail(function(err, res, msg) {
          cb(err, res, msg);
        });
      },

      stats: stats({
        failed: function(job, err) {
          sails.log.error(err.message);
        }
      })
    },

    {
      name: 'confirmDataEntryEmail',
      process: function(job, cb) {
        // if (!job.data.user) return cb(new Error("User not provided"));
        Form.sendDataInviteEmail(job.data, function(err, res, msg) {
          cb(err, res, msg);
        });
      },
      stats: stats({
        failed: function(job, err) {
          sails.log.error(err.message);
        }
      })
    },

    {
      name: 'destructor',
      process: function(job, cb) {
        const data = job.data;
        const domain = data.domain;

        if (!data.model) return cb(Error('errors.NO_MODEL'));
        data.query.model = data.model.name;
        data.query.domain = domain;

        if (!_.isArray(data.query.id)) {
          data.query.id = [data.query.id];
        }
        async.forEach(
          data.query.id,
          function(id, next) {
            Node.pullSchema(data.query)
              .then(
                Node.deleteNode({
                  id: id
                })
              )
              .then(function(query) {
                next(null, query);
              })
              .catch(next);
          },
          function(err) {
            cb(err);
          }
        );
      },
      stats: stats({
        completed: function() {
          //
        },
        stalled: function(job) {
          job.retry().then(function(r) {
            sails.log.debug(r);
          });
        },
        failed: function(job) {
          job.retry().then(function(r) {
            sails.log.debug(r);
          });
        }
      })
    },

    {
      name: 'updateOrCreateNode',
      process: async function(job) {
        const data = job.data;
        const schema = data.schema;
        const node = data.node;
        return await Node.updateOrCreate()({
          params: node,
          schema: schema
        });
      },
      stats: stats({
        completed: function(job, result) {
          sails.log.debug('updateOrCreateNode COMPLETE:::', result);
        },
        stalled: function(job, err) {
          sails.log.error('updateOrCreateNode STALLED:::', err);
        },
        failed: function(job, err) {
          sails.log.error('updateOrCreateNode FAILED:::', err);
        }
      })
    },

    {
      name: 'processCSV',
      process: function(job, cb) {
        sails.log.debug('STARTING TO PROCESS CSV');
        // if (!job.data.csv) return cb(new Error());
        if (!job.data.file) return cb(Error('errors.NO_FILE'));
        if (!job.data.model) return cb(Error('errors.NO_MODEL'));
        if (!job.data.socket) return cb(Error('errors.NO_SOCKET'));
        try {
          if (job.data.system) {
            csv.processModel(job.data, function(err, res, msg) {
              if (err) {
                return cb(Error(err));
              }
              cb(null, msg);
            });
          } else {
            csv.process(job.data, function(err, res, msg) {
              if (err) {
                return cb(Error(err));
              }
              cb(null, msg);
            });
          }
        } catch (e) {
          sails.log.error('CSV PROCESSING ERROR:::', e);
          return cb(e);
        }
      },
      stats: stats({
        stalled: function(job) {
          job.remove().then(function(r) {
            sails.log.debug(r);
          });
        },
        completed: function(job, result) {
          //  Utils.sendexcelMessage(null, result);
          const file = job.data.file;
          let f_name;

          if (process.env.CLOUD_DEPLOYMENT) {
            f_name = file.fd;
          } else {
            f_name = file.extra.loid;
          }
          fileAdapter.rm(f_name, function(err) {
            if (err) {
              sails.log.error(err);
            }
          });

          try {
            sails.sockets.broadcast(job.data.socket, 'csv-processed', {
              message: result
            });
          } catch (e) {
            sails.log.error('CSV_PROCESSING ERROR CAUGHT::', e);
          }

          Jobs.processCSV.clean(0);
        },
        failed: function(job, err) {
          const file = job.data.file;

          try {
            sails.sockets.broadcast(job.data.socket, 'csv-processed', {
              error: err.message
            });
          } catch (e) {
            sails.log.error(e);
          }

          fileAdapter.rm(file.extra.loid, function(err) {
            if (err) {
              sails.log.error(err);
            }
          });

          job.remove().then(function(r) {
            sails.log.debug(r);
          });
        },
        error: function(error) {
          sails.log.error(error);
          Jobs.processCSV.clean(0);
        },
        cleaned: function(job, type) {
          sails.log.debug('Cleaned %s %s jobs', job.length, type);
        }
      })
    },

    {
      name: 'sendPasswordResetEmail',

      process: function(job, cb) {
        if (!job.data.user) return cb(Error('User not provided'));
        const user = new User._model(job.data.user);
        user.sendPasswordResetEmail(job.data, function(err, res, msg) {
          cb(err, res, msg);
        });
      },
      stats: stats({
        failed: function(job, err) {
          sails.log.error(err.message);
        }
      })
    },

    {
      name: 'activateAccountEmail',
      process: function(job, next) {
        if (!job.data.user) return next(new Error('User not provided'));
        const user = new User._model(job.data.user);
        user.sendUserInviteEmail(job.data, function(err, res, msg) {
          next(err, msg);
        });
      },
      stats: stats({
        failed: function(_job, err) {
          sails.log.error(err.message);
        }
      })
    },

    {
      name: 'generateNodeExcel',
      // processor: null,
      process: function(job, done) {
        const data = job.data;
        const params = data.query;
        User.findOneById(data.user)
          .then(function(user) {
            return user;
          })
          .then(function(user) {
            return Node.pullSchema(
              params,
              {
                locals: {
                  domain: data.domain || null
                }
              },
              user
            ).then(function(schema) {
              //
              return {
                socket: data.socket,
                user: user,
                schema: schema,
                language: data.language,
                query: params,
                config: data
              };
            });
          })
          .then(function(payload) {
            return Variable.resolveVariables(
              [],
              ['csv_variables', 'csv_dimensions', 'tag_category']
            ).then(function(variables) {
              payload.variables = variables;
              return payload;
            });
          })
          .then(function(payload) {
            const labels = _.pluck(
              _.union(Node.schema(), payload.schema.schema),
              'label'
            );
            return Variable.find({
              key: Translates.translateIdentity,
              identity: labels
            }).then(function(variables) {
              payload.header_vars = variables;
              return payload;
            });
          })
          .then(function(payload) {
            const tags = _.pluck(
              _.where(payload.variables, {
                key: 'tag_category'
              }),
              'id'
            );
            return Tag.find({
              tag_category: tags
            }).then(function(tags) {
              payload.tags = tags;
              return payload;
            });
          })
          .then(function(payload) {
            const params = payload.query;
            const stationIDs = (params.where || {}).station || params.station;

            if (!stationIDs) {
              throw new Error('errors.STATION_ID_REQUIRED');
            }

            return Station.find({
              id: stationIDs
            })
              .populateAll()
              .then(function(stations) {
                if (stationIDs === -1 || _.contains(stationIDs, -1)) {
                  stations.push({
                    id: -1,
                    station_id: 'Globals'
                  });
                }
                payload.stations = stations;
                return payload;
              });
          })
          .then(function(payload) {
            const stations = _.clone(payload.stations);
            const promises = [];
            const deferred = Q.defer();
            async.forEach(
              stations,
              function(station, next) {
                promises.push(Node.queryNode(station, payload, next));
              },
              function() {
                Q.allSettled(promises).then(function(settled) {
                  _.each(settled, function(s) {
                    if (s.state === 'fulfilled' && s.value) {
                      const resolved = s.value;

                      _.each(resolved, function(v, key) {
                        const station = _.where(payload.stations, {
                          id: parseInt(key)
                        });
                        if (station && station.length) {
                          station[0].fill = v;
                        }
                      });
                    }
                  });

                  // /return payload;
                  deferred.resolve(payload);
                });
              }
            );

            return deferred.promise;
          })
          .then(function(payload) {
            csv.buildGenericNodeExcel(payload, done);
          })

          .catch(function(why) {
            sails.log.error(why);
            done(why);
          });
      },

      stats: stats({
        completed: function(_job, result) {
          SailsExtensions.broadcastSocketMessage(null, result);
        },
        failed: function(job, err) {
          SailsExtensions.broadcastSocketMessage(err, job.data);
        }
      })
    }
  ]
};

function stats(listeners) {
  return function(name) {
    _.each(listeners, function(listen, key) {
      Jobs[name].on(key, listen);
    });
  };
}
