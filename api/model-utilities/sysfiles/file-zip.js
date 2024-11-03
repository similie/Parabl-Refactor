const Fs = require('fs');
const archiver = require('archiver');

class FileZip {
  _zipname;
  _name;
  _fd;
  constructor(name, fileDetails) {
    this._fd = fileDetails;
    this.zipname = `${fileDetails.fullPathName}.zip`;
    this.archive = archiver('zip', {
      zlib: { level: 9 } // Sets the compression level.
    });
    this.name = name;
  }

  get name() {
    return this._name;
  }

  set name(name) {
    this._name = name;
  }

  get zipname() {
    return this._zipname;
  }

  set zipname(zipname) {
    this._zipname = zipname;
  }

  end() {
    sails.log.debug('Data has been drained');
  }

  warning(err) {
    if (err.code === 'ENOENT') {
      sails.log.error(err);
    } else {
      // throw error
      throw err;
    }
  }

  zip() {
    const output = Fs.createWriteStream(this._zipname);

    return new Promise((resolve, reject) => {
      output.on('close', () => {
        resolve(this.zipname);
      });
      output.on('end', this.end.bind(this));
      this.archive.append(this._fd.getReadStream(), { name: this.name });
      this.archive.on('warning', this.warning.bind(this));
      this.archive.on('error', reject);
      this.archive.pipe(output);
      this.archive.finalize();
    });
  }
}

module.exports = { FileZip };
