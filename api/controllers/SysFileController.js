const escape = require('pg-escape');
const Q = require('q');

const SkipperAdapter = sails.config.skipper.adapter;
const fileAdapter = SkipperAdapter(sails.config.skipper);
const fs = require('fs');
const GB = 1000000000;
const download = require('image-downloader');
const { promisify } = require('util');
const request = require('request');
const existsAsync = promisify(fs.exists).bind(fs);
const mkdirAsync = promisify(fs.mkdir).bind(fs);
const unlinkAsync = promisify(fs.unlink).bind(fs);
const fileAdapterDB = sails.config.fileProtos.db.adapter(
  sails.config.fileProtos.db
);

module.exports = {
  urlFile: async function(req, res) {
    const params = req.params.all();
    const urls = _.isArray(params.url) ? params.url : [params.url];
    const directory = `${sails.config.__parentDir}/temp-files`;
    const device = res.locals.device;
    if (!device) {
      res.badRequest({
        errors: 'This request must be made through an external device only'
      });
    }

    const domain = (device || {}).domain || res.locals.domain;
    const site = await Site.thisSiteAsync(domain);
    const selfURL = `${site.secure_protocol ? 'https://' : 'http://'}${
      site.site_url
    }`;

    if (!site.site_url) {
      res.badRequest({ errors: 'A site url must be configured' });
    }

    if (!(await existsAsync(directory))) {
      await mkdirAsync(directory);
    }

    const createdFiles = [];

    for (let i = 0; i < _.size(urls); i++) {
      const url = urls[i];
      const options = {
        url: url,
        dest: directory
      };

      try {
        const { filename } = await download.image(options);
        const selfOptions = {
          url: `${selfURL}${site.files.upload || '/api/v1/sysfiles/upload'}`,
          headers: {
            'Content-Type': 'multipart/form-data',
            authentication: req.headers.authentication,
            secret: req.headers.secret
          }
        };
        try {
          const files = await new Promise((resolve, reject) => {
            const r = request.post(selfOptions, function optionalCallback(
              err,
              httpResponse,
              body
            ) {
              if (err) {
                return reject(err);
              }
              const sysfiles = JSON.parse(body);
              resolve(sysfiles.files);
            });
            const form = r.form();
            form.append(
              'file', // (path.join(__dirname, "doodle.png")
              fs.createReadStream(filename)
            );
          });
          createdFiles.push(...files);
          await unlinkAsync(filename);
        } catch (e) {
          sails.log.error('SysFileController::urlFile:error', e.message);
        }
      } catch (e) {
        console.error(e);
      }
    }

    return res.send(createdFiles);
  },

  access: async function(req, res) {
    const params = req.params.all();
    if (!params.id) {
      return res.badRequest('warning.FILE_ID_REQUIRED');
    }

    let count;

    try {
      count = await FileAccess.countAsync({
        file: params.id
      });
    } catch (e) {
      sails.log.error(e);
      return res.serverError(e);
    }
    res.send({
      total: count
    });
  },

  upload: function(req, res) {
    const params = req.params.all();
    // here we are checking if the system has a file size restriction
    Q.fcall(() => {
      const deferred = Q.defer();
      // if we don't go on
      if (!res.locals.siteData || !res.locals.siteData.file_size_restriction) {
        deferred.resolve();
        return deferred.promise;
      }

      const site_restriction = res.locals.siteData.file_size_restriction * GB;

      Model.query(
        escape('select sum(size) as total from sysfile where active = TRUE;'),
        (err, res) => {
          if (err) return deferred.resolve();

          const row = (res.rows || [])[0];
          if (row && row.total && row.total >= site_restriction) {
            return deferred.reject('info.FILE_MAX_EXCEEDED');
          }

          deferred.resolve();
        }
      );

      return deferred.promise;
    })
      .then(async () => {
        let files = [];
        const isThumbnail = params.thumbnail === 'true';
        // we then upload the file
        // let's go head and store all files locally // !online;
        const rotten =
          (process.env.LOCAL_OVERRIDE_URL && process.env.CLOUD_DEPLOYMENT) ||
          params.fallback;
        const skipperS3 = isThumbnail
          ? sails.config.fileProtos.resizer
          : sails.config.skipper;
        const skipper = !rotten ? skipperS3 : sails.config.fileProtos.db;
        params.rotten = rotten;
        try {
          if (isThumbnail) {
            const thumbnailsSize = SysFile.getThumbsNailSizes();

            files = await Promise.all(
              thumbnailsSize.map(
                async thumb =>
                  await this.doUpload(
                    req,
                    res,
                    {
                      ...skipper,
                      filename: function(base, ext) {
                        return `${base}--${thumb.name}${ext}`;
                      },
                      resize: {
                        width: thumb.size,
                        height: thumb.size
                      }
                    },
                    params
                  )
              )
            );
          } else {
            files = await this.doUpload(req, res, skipper, params);
          }
        } catch (e) {
          sails.log.error(e);
          return res.serverError(e);
        }

        // we now keep track of our file in the DB
        sails.models[sails.config.skipper.fileTable]
          .create(files)
          .exec((err, fs) => {
            if (err) {
              sails.log.error(err);
              return res.negotiate(err);
            }
            res.send({
              message: fs.length + ' file(s) uploaded successfully!',
              files: fs
            });
          });
      })
      .catch(res.badRequest);
  },

  doUpload: async function(req, res, defaultAdapter, params) {
    if (!req.user) {
      return [];
    }

    const __doUpload = async adapter =>
      new Promise((resolve, reject) => {
        req.file('file').upload(adapter, (err, files) => {
          if (err || !Array.isArray(files)) {
            return reject(err);
          }
          resolve({ data: files });
        });
      });

    const upload = await __doUpload(defaultAdapter);

    if (!upload || !Array.isArray(upload.data) || !upload.data.length) {
      return [];
    }

    upload.data.forEach(r => {
      r.owner = req.user.id;
      const target = parseInt(params.target);
      if (!_.isNaN(target)) {
        r.target = target;
      }

      r.fd = (r.extra || {}).Key || r.fd;
      r.target_model = params.target_model;
      r.domain = Model.getId(res.locals.domain) || null;
      r.title = params.title || null;
      r.description = params.description || null;
      r.rotting = params.rotten;
      r.upload_identifier = process.env.SITE_IDENTITY || 'SINGLE_DEPLOYMENT';
      if (process.env.CLOUD_DEPLOYMENT) {
        r.cloud_deployed = true;
      }
    });

    return upload.data;
  },

  remove: async function(req, res) {
    const params = req.params.all();
    if (!params.id && !params.files) {
      return res.badRequest('error.ID_PARAM_REQUIRED');
    }
    const files = [];
    if (params.id) {
      files.push(
        await SysFile.findOne({
          id: params.id,
          active: true
        })
      );
    }

    if (_.size(params.files)) {
      files.push(
        ...(await SysFile.find({
          id: params.files,
          active: true
        }))
      );
    }

    for (let i = 0; i < _.size(files); i++) {
      const file = files[i];
      if (!file) {
        continue;
      }
      file.active = false;
      file.extra = file.extra || {};
      file.extra.destroyed = {
        date: new Date(),
        user: (req.user || {}).id
      };

      if (params.remove) {
        if (process.env.CLOUD_DEPLOYMENT && !file.rotting) {
          fileAdapter.rm(file.fd, err => {
            if (err) {
              sails.log.error(err);
            }
          });
        } else {
          fileAdapterDB.rm(file.extra.loid, err => {
            if (err) {
              sails.log.error(err);
            }
          });
        }
      }
      await SysFile.saveAsync(file);
    }

    if (params.id && _.size(files) === 1) {
      return res.send(files.pop());
    }
    res.send(files);
  },

  /*
   * Override to alter request based on
   * user access permissions
   */
  findOne: function(req, res) {
    Utils.findOne(req, res, files => {
      UserAccess.control(files, req.user, {
        entity: 'sysfile'
      })
        .then(file => {
          res.ok(file);
        })
        .catch(res.negotiate);
    });
  },

  find: async function(req, res) {
    const actionUtil = Utils.actionUtil();
    const params = actionUtil.parseCriteria(req);
    let membership;

    if (
      params.domain ||
      ((params.where || {}).domain &&
        params.published &&
        (res.locals.siteData || {}).survey)
    ) {
      const domain = res.locals.domain;
      membership = await Domain.commonDomainTags(domain);
      if (_.size(membership)) {
        params.domain = membership;
      }
    }
    const find = SysFile.find()
      .populateAll()
      .where(params)
      .limit(actionUtil.parseLimit(req))
      .skip(actionUtil.parseSkip(req))
      .sort(actionUtil.parseSort(req));

    find.exec((err, files) => {
      if (err) {
        return res.negotiate(err);
      }
      UserAccess.control(files, req.user, {
        entity: 'sysfile'
      })
        .then(files => {
          if (params.id && !_.isArray(params.id) && _.size(files) >= 1) {
            return res.ok(files[0]);
          }
          res.ok(files);
        })
        .catch(res.negotiate);
    });
  },

  download: async function(req, res) {
    const params = req.params.all();

    if (!params.id) {
      return res.badRequest('error.ID_PARAM_REQUIRED');
    }

    const setHeaders = SysFile.setHeaders(req, res);
    const streamFile = SysFile.streamFile(req, res);

    sails.models[sails.config.skipper.fileTable]
      .findOne(SysFile.findSpecificFileQuery(req))
      .exec(async (err, file) => {
        if (err) {
          return res.negotiate(err);
        }

        if (!file) {
          return res.badRequest('error.NO_FILE_FOUND');
        }

        if (file.cloud_deployed && !file.rotting) {
          const stream = await SysFile.getStream(fileAdapter, file);
          return streamFile(stream, file);
        } else {
          const identity = process.env.SITE_IDENTITY || 'SINGLE_DEPLOYMENT';

          if (file.rotting && file.upload_identifier !== identity) {
            return res.badRequest({
              error: 'File is not ready for download'
            });
          }

          fileAdapterDB.read(file, (err, stream) => {
            if (err) {
              return res.negotiate(err);
            }

            setHeaders(file);

            if (stream && _.propertyOf(stream)('pipe')) {
              return stream.pipe(res);
            } else {
              return res.serverError();
            }
          });
        }
      });
  }
};
