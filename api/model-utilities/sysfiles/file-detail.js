const mime = require('mime');
const Fs = require('fs');

class FileDetails {
  _filename;
  _fullPathName;
  constructor(fullPathName) {
    this.fullPathName = fullPathName;
    this.filename = fullPathName;
  }

  get filename() {
    return this._filename;
  }

  set filename(filename) {
    const parts = filename.split('/');
    this._filename = parts[parts.length - 1];
  }

  get fullPathName() {
    return this._fullPathName;
  }

  set fullPathName(fullPathName) {
    this._fullPathName = fullPathName;
  }

  mm() {
    return mime.getType(this.fullPathName);
  }

  async getStat() {
    return await new Promise((resolve, reject) => {
      Fs.stat(this.fullPathName, (e, stat) => {
        if (e) {
          return reject(e);
        }
        return resolve(stat);
      });
    });
  }

  async destroy() {
    return await new Promise((resolve, reject) => {
      Fs.unlink(this.fullPathName, (err, stats) => {
        if (err) {
          return reject(err);
        }
        resolve(stats);
      });
    });
  }

  getReadStream() {
    return Fs.createReadStream(this.fullPathName);
  }
}

module.exports = { FileDetails };
