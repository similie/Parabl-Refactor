/**
 * File.js
 *
 * @description :: Manages files and their associated properties
 * @docs        :: http://sailsjs.org/#!documentation/models
 */

const SkipperAdapter = sails.config.skipper.adapter;
const fileAdapter = SkipperAdapter(sails.config.skipper);
const { Readable } = require('stream');
const { Base64Encode } = require('base64-stream');

const fileAdapterDB = sails.config.fileProtos.db.adapter(
  sails.config.fileProtos.db
);
// const fileWrite = promisify(fileAdapter.receive).bind(fileAdapter);

module.exports = {
  migrate: process.env.MIGRATION || 'safe', // set to 'alter' to have sails create the table
  attributes: {
    title: {
      type: 'string'
    },

    description: {
      type: 'text'
    },

    owner: {
      model: 'user'
    },

    active: {
      type: 'boolean',
      defaultsTo: true
    },

    dirname: 'text',
    extra: 'json',
    field: 'string',
    size: 'integer',
    type: 'string',
    fd: 'string',
    filename: 'string',
    status: 'string',

    cloud_deployed: {
      type: 'boolean',
      defaultsTo: false
    },

    published: {
      type: 'boolean'
    },

    tags: {
      collection: 'tag'
    },

    domain: {
      model: 'domain'
    },

    restrictions: {
      type: 'json'
    },

    rotting: {
      type: 'boolean',
      defaultsTo: false
    },

    upload_identifier: {
      type: 'string'
    },

    target: {
      type: 'integer'
    },

    target_model: {
      type: 'string'
    },

    meta: {
      type: 'json'
    },

    minio: {
      type: 'integer',
      defaultsTo: 0
    },

    strip: function() {
      const file = this.toObject();

      delete file.data;

      return file;
    }
  },

  _timers: [
    {
      interval: Const.timers.MINUTE, // Const.timers.THIRTY_MINUTE,
      name: 'push_rotten',
      action: function() {
        return {
          do: function() {
            if (
              !process.env.LOCAL_OVERRIDE_URL ||
              !process.env.CLOUD_DEPLOYMENT
            ) {
              return;
            }
            Jobs.pushTheRotten.add();
          }
        };
      }
    }
  ],

  _processors: [
    {
      name: 'pushTheRotten',
      process: async function() {
        const rotten = await sails.models[sails.config.skipper.fileTable].find({
          rotting: true,
          upload_identifier: process.env.SITE_IDENTITY || 'SINGLE_DEPLOYMENT'
        });
        for (let i = 0; i < _.size(rotten); i++) {
          const online = await Site.isOnline();
          if (!online) {
            break;
          }
          const file = rotten[i];
          try {
            const fileStream = await new Promise((resolve, reject) => {
              fileAdapterDB.read(file, (err, stream) => {
                if (err) {
                  return reject(err);
                }
                resolve(stream);
              });
            });

            const status = await sails.config.fileProtos.streamFile(
              fileStream,
              file
            );

            if (!status.Location && !status.etag) {
              continue;
            }
            file.extra = {
              ...file.extra,
              ...status
            };
            file.rotting = false;
            await SysFile.saveAsync(file);
          } catch (e) {
            sails.log.error(e);
            continue;
          }
        }
      },

      stats: Utils.stats({
        completed: function() {
          //
        },
        failed: function(job, err) {
          console.error('JOB pushTheRotten ERROR::', err);
          // Utils.sendexcelMessage(err, job.data);
        }
      })
    }
  ],

  getThumbsNailSizes: function() {
    const thumbnailsSize = [
      {
        name: 'desktop',
        size: 184
      },
      {
        name: 'thumb',
        size: 92
      },
      {
        name: 'tiny',
        size: 46
      }
    ];
    return [...thumbnailsSize];
  },

  fileStream: function(file) {
    return new Promise((resolve, reject) => {
      if (file.cloud_deployed && !file.rotting) {
        const stream = sails.config.fileProtos.cloudGetObject(file);

        resolve(stream);
      } else {
        fileAdapter.read(file, (err, buffer) => {
          if (err) {
            sails.log.error(err);
            return reject(err);
          }

          const readableStream = new Readable({
            read() {
              this.push(buffer);
              this.push(null);
            }
          });

          resolve(readableStream);
        });
      }
    });
  },

  headersForStreamDownload: function(
    file,
    download = false,
    fileCache = '86400'
  ) {
    const headers = {
      'Content-Type': file.type,
      'Content-Disposition': (
        'inline; filename="' +
        (file.filename || '').trim() +
        '"'
      ).trim(),
      'Content-Length': file.size,
      // 'Transfer-Encoding': 'chunked',
      // we want the browser to cache our files
      'Cache-Control': 'max-age=' + fileCache
    };

    if (download) {
      headers['Content-Disposition'] =
        'attachment; filename="' + file.filename + '"';
    }
    return headers;
  },

  convertLocalFileToBase64: async function(file) {
    const storedFile = await this.findOneById(this.getId(file));
    const stream = await this.getStream(fileAdapter, storedFile);
    const readable = Readable.from(
      stream.data.pipe(
        new Base64Encode({ prefix: `data:${storedFile.type};base64,` })
      )
    );

    return new Promise(resolve => {
      let base64 = '';
      readable.on('data', chunk => {
        base64 += chunk;
      });

      readable.on('end', () => {
        resolve(base64);
      });
    });
  },

  findRange: function(headers, file, range = 0) {
    if (!range) {
      return 0;
    }
    delete headers['Content-Disposition'];
    const positions = range.replace(/bytes=/, '').split('-');
    const start = parseInt(positions[0], 10);
    const end = positions[1] ? parseInt(positions[1], 10) : file.size - 1;
    const chunksize = end - start + 1;
    headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + file.size;
    headers['Content-Length'] = chunksize;
    return 206;
  },

  async createFileAccess(user, file) {
    if (!user) {
      return;
    }
    const fileAccess = await FileAccess.create({
      user: user.id,
      file: file.id
    });
    return fileAccess;
  },

  setHeaders: function(req, res) {
    const params = req.params.all();
    const fileCache = (res.locals.siteData || {}).file_cache;
    return file => {
      if (!file) {
        throw new Error('errors.FILE_NOT_FOUND');
      }
      this.createFileAccess(req.user, file);
      const range = req.headers.range;
      const headers = this.headersForStreamDownload(
        file,
        params.download,
        fileCache
      );
      const status = this.findRange(headers, range);
      if (status) {
        res.status(206);
      }
      res.set(headers);
      return range ? true : null;
    };
  },

  findSpecificFileQuery: function(req) {
    const params = req.params.all();
    const find = {
      id: params.id,
      active: true
    };

    if (process.env.CLOUD_DEPLOYMENT) {
      find.cloud_deployed = true;
    }
    return find;
  },

  getStream: function(adapter, file) {
    return new Promise(resolve =>
      adapter.read(file.fd, (err, buffer) => {
        if (err) {
          sails.log.error(err);
          return resolve({ error: err });
        }

        const readableStream = new Readable({
          read() {
            this.push(buffer);
            this.push(null);
          }
        });

        resolve({
          status: true,
          data: readableStream
        });
      })
    );
  },

  streamFile: function(req, res) {
    const setHeaders = this.setHeaders(req, res);
    return async (stream, file) => {
      const streamData = stream.data;
      if (!streamData) {
        return res.badRequest({ error: 'error.NO_FILE_FOUND' });
      }
      const isSetHeader = setHeaders(file);
      if (isSetHeader) {
        try {
          await sails.config.fileProtos.cloudGetObject(file).pipe(res);
        } catch (e) {
          sails.log.error('FILE-READ-ERROR::', e);
          res.serverError(e);
        }
      } else {
        streamData.pipe(res);
      }
    };
  }
};
