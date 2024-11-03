// https://www.npmjs.com/package/exceljs#writing-csv
const ExcelJS = require('exceljs');
const os = require('os');
class ExcelStream {
  _workbook;
  _filename;
  _baseFileName;
  _worksheets = {};
  constructor(filename, options = {}) {
    this.baseFileName = filename;
    this.filename = filename ? this.buildFileName() : this.buildTempFileName();
    options.filename = this.filename;
    this._workbook = new ExcelJS.stream.xlsx.WorkbookWriter(options);
  }

  buildFileName() {
    return `${os.tmpdir()}/${this.baseFileName}`;
  }

  buildTempFileName() {
    return `${os.tmpdir()}/${Tracker.buildRandomId('uuid')}.xlsx`;
  }

  addSheet(name, options) {
    this._worksheets[name] = this.workbook.addWorksheet(name, {
      options
    });
    return this._worksheets[name];
  }

  addRowToWorkSheet(name, row) {
    return this._worksheets[name].addRow(row);
  }

  addRowToWorkSheetAndCommit(name, row) {
    return this._worksheets[name].addRow(row).commit();
  }

  commitWorkbook() {
    return this._workbook.commit();
  }

  commitWorkSheet(name) {
    return this._worksheets[name].commit();
  }

  get workbook() {
    return this._workbook;
  }

  get filename() {
    return this._filename;
  }

  set filename(filename) {
    this._filename = filename;
  }

  get baseFileName() {
    return this._baseFileName;
  }

  set baseFileName(baseFileName) {
    this._baseFileName = `${baseFileName}.xlsx`;
  }
}

module.exports = { ExcelStream };
