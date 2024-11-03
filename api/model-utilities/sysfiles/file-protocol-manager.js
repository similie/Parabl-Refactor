const Minio = require('minio');
class FileProtocolCredientialsManager {
  constructor() {
    this._adapter = sails.config.skipper;
  }

  get credentials() {
    const creds = {
      endPoint: this._adapter.endPoint,
      accessKey: this._adapter.accessKey,
      secretKey: this._adapter.secretKey,
      useSSL: this._adapter.useSSL,
      region: this._adapter.region,
      bucket: this._adapter.bucket
    };
    if (this._adapter.port) {
      creds.port = this._adapter.port;
    }
    return creds;
  }
}

/**
 * In typescript we'd make this an abstract class
 */
class FileProtocolManager {
  _adapter;
  _client;
  _fileDetails;

  static isCloudBase() {
    return !!process.env.CLOUD_DEPLOYMENT;
  }

  constructor() {
    this._cloud = process.env.CLOUD_DEPLOYMENT;
    this.manager = new FileProtocolCredientialsManager();
    this.setAdapter();
  }

  get client() {
    return this._client;
  }

  set client(client) {
    this._client = client;
  }

  skyClient() {
    const creds = this.manager.credentials; // this.getCloudCredentials();
    this.client = new Minio.Client(creds);
  }

  localClient() {
    // noop
  }

  setAdapter() {
    this._adapter = sails.config.skipper;
  }

  setClient() {
    if (this._cloud) {
      this.skyClient();
    } else {
      this.localClient();
    }
  }

  async localStream() {}

  cloudStreamDetails(stat) {
    return [
      this._adapter.bucket,
      this.fileDetails.filename,
      this.fileDetails.getReadStream(),
      stat.size
      // this.fileDetails.mm(),
    ];
  }

  async cloudStream() {
    const stat = await this.fileDetails.getStat();
    const details = this.cloudStreamDetails(stat);
    return new Promise((resolve, reject) => {
      this.client.putObject(...details, (e, result) => {
        if (e) {
          return reject(e);
        }
        resolve(result);
      });
    });
  }

  processStream() {
    if (this._cloud) {
      return this.cloudStream();
    } else {
      return this.localStream();
    }
  }

  async stream(fileDetails) {
    this.fileDetails = fileDetails;
    this.setClient();
    return this.processStream();
  }
}

class FileStoreManager {
  _bucket;
  _path;
  _client;
  constructor(bucket, path) {
    this._bucket = bucket;
    this._path = path;
    this.manager = new FileProtocolCredientialsManager();
    const creds = this.manager.credentials; // this.getCloudCredentials();
    creds.bucket = this._bucket;
    this._client = new Minio.Client(creds);
  }

  async statObject() {
    return new Promise((resolve, reject) => {
      this._client.statObject(this._bucket, this._path, (error, stat) => {
        if (error) {
          sails.log.error(error);
          return reject(error);
        }
        resolve(stat);
      });
    });
  }

  async streamFile() {
    return new Promise((resolve, reject) => {
      this._client.getObject(this._bucket, this._path, (error, dataStream) => {
        if (error) {
          sails.log.error(error);
          return reject(error);
        }
        resolve(dataStream);
      });
    });
  }

  async streamVideo(start, end) {
    return new Promise((resolve, reject) => {
      this._client.getPartialObject(
        this._bucket,
        this._path,
        start,
        end,
        (error, dataStream) => {
          if (error) {
            sails.log.error(error);
            return reject(error);
          }
          resolve(dataStream);
        }
      );
    });
  }
}

module.exports = { FileProtocolManager, FileStoreManager };
