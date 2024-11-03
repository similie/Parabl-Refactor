const { FileDetails } = require('./file-detail');
const { FileProtocolManager } = require('./file-protocol-manager');
class FileStream {
  _filename;
  _readableName;
  _client;
  _manager;

  constructor(fileName) {
    if (!fileName) {
      throw new Error('Filename required to instantiate this service');
    }
    this.filename = fileName;
    this._manager = new FileProtocolManager();
  }

  setDeets() {
    this.fd = new FileDetails(this._filename);
  }

  destroyFile() {
    return this.fd.destroy();
  }

  get fileDetails() {
    return this.fd;
  }

  get filename() {
    return this._filename;
  }

  set filename(filename) {
    this._filename = filename;
    this.setDeets();
  }

  async upload() {
    try {
      return this._manager.stream(this.fd);
    } catch (e) {
      sails.log.debug('FileStream:::: FILE STAT ERROR', e);
      throw new Error('File is not available');
    }
  }
}

module.exports = { FileStream };
