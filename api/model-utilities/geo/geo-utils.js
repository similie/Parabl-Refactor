const fs = require('fs');
const zip = require('file-zip');
const Shapefile = require('shapefile');

class GeoUtils {
  static get fileBase() {
    return Geo.gets3BaseForShapes();
  }

  static async readShapeFile(shapeFile, cb) {
    let counter = 0;
    const lines = [];
    await new Promise((resolve, reject) => {
      Shapefile.open(shapeFile)
        .then(source => {
          source
            .read()
            .then(async function log(result) {
              await (cb || _.noop)(result, counter);
              if (result.done) {
                return resolve();
              } else {
                counter++;
                lines.push(result);
              }
              return source.read().then(log);
            })
            .catch(reject);
        })
        .catch(reject);
    });
    return {
      lines,
      counter
    };
  }
}

class GeoZipUtils {
  #_importBase = Site.getImportBase();
  #_fileBase = GeoUtils.fileBase;
  constructor(fileName) {
    this.fileName = fileName;
    this.zipFile = this.#_importBase + '/' + this.fileName;
    const SkipperAdapter = sails.config.skipper.adapter;
    this.fileAdapter = SkipperAdapter(sails.config.skipper);
  }

  get shapeFiles() {
    const shpFiles = [];
    const zippedFiles = fs.readdirSync(this.importFile);
    for (let i = 0; i < zippedFiles.length; i++) {
      const zippedFile = zippedFiles[i];
      if (!zippedFile.endsWith('.shp')) {
        continue;
      }
      shpFiles.push(zippedFile);
    }
    return shpFiles;
  }

  unZipBufferToShapFiles(fBuffer) {
    return new Promise((resolve, reject) => {
      zip.unzip(fBuffer, this.importFile, (err, values) => {
        if (err) {
          return reject(err);
        }
        resolve(values);
      });
    });
  }

  getFileBuffer() {
    return new Promise((resolve, reject) => {
      this.fileAdapter.read(this.baseZipFile, (err, fBuffer) => {
        if (err) {
          return reject(err);
        }
        resolve(fBuffer);
      });
    });
  }

  get baseZipFile() {
    return this.#_fileBase + this.fileName;
  }

  get fileAdapter() {
    return this._fileAdapter;
  }

  set fileAdapter(fileAdapter) {
    this._fileAdapter = fileAdapter;
  }

  get importFile() {
    return this.zipFile.replace('.zip', '');
  }

  get zipFile() {
    return this._zipFile;
  }

  set zipFile(zipFile) {
    this._zipFile = zipFile;
  }

  get fileName() {
    return this._filename;
  }

  set fileName(fileName) {
    this._filename = fileName;
  }

  async downloadZip() {
    const buffer = await this.getFileBuffer();
    await this.unZipBufferToShapFiles(buffer);
    return this.importFile;
  }
}

module.exports = { GeoUtils, GeoZipUtils };
