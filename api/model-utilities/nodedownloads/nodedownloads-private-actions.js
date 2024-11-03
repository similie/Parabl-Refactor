const { ExcelStream } = require('../common/excel-stream');
const { FileDetails } = require('../sysfiles/file-detail');
const { FileStream } = require('../sysfiles/file-stream');
const { NodeParamTransformer } = require('./node-param-tranformer');
const { TimeUtils } = require('similie-api-services');
const { FileProtocolManager } = require('../sysfiles/file-protocol-manager');
const { FileZip } = require('../sysfiles/file-zip');

class NodeDownloadActionsPrivate {
  _download;
  _socket;
  _tracking_id;
  _skip;
  _count = 0;
  _every = 100;
  _runningBuffer = false;
  _job;
  _paramStore = [];
  _states = {
    '-1': 'ERROR',
    0: 'PENDING',
    1: 'BUILDING',
    2: 'PROCESSING',
    3: 'FINISHED'
  };

  _stateKeys = {
    ERROR: -1,
    PENDING: 0,
    BUILDING: 1,
    PROCESSING: 2,
    FINISHED: 3
  };

  constructor(download, job) {
    this._download = download;
    this.socket = download.socket;
    this.tracking_id = download.tracking_id;
    this.lang = download.language;
    this._skip = 0;
    this._job = job;
  }

  get socket() {
    return this._socket;
  }

  set socket(socket) {
    this._socket = socket;
  }

  get lang() {
    return this._lang;
  }

  set lang(lang) {
    this._lang = lang;
  }

  get tracking_id() {
    return this._tracking_id;
  }

  set tracking_id(tracking_id) {
    this._tracking_id = tracking_id;
  }

  get download() {
    return this._download;
  }

  set download(download) {
    this._download = download;
  }

  getQuery() {
    const query = {
      ...this.download.query,
      skip: this._skip
    };
    return query;
  }

  getWhere() {
    return this.download.where;
  }

  async setSchema() {
    if (typeof this.download.schema === 'object') {
      this.schema = this.download.schema;
    } else {
      this.schema = await NodeSchema.findOneById(
        Model.getId(this.download.schema)
      );
    }
  }

  setStream() {
    this.client = Node.getNodeStream(this.download);
  }

  iterateBroadcast(data) {
    this.sockets.forEach(s => {
      sails.sockets.broadcast(s, this.tracking_id, data);
    });
  }

  get getId() {
    return this.download.id;
  }

  async setCount() {
    await NodeDownload.update({ id: this.getId }, { skip: this.count });
  }

  async broadcast(data) {
    if (this.sockets && this.sockets.length) {
      this.iterateBroadcast(data);
    } else {
      sails.sockets.broadcast(this.socket, this.tracking_id, data);
    }
  }

  get count() {
    return this._count;
  }

  get job() {
    return this._job;
  }

  get params() {
    return this.transformer.params;
  }

  incrementCount() {
    this._count++;
  }

  decrementCount() {
    this._count--;
  }

  packagePrimary() {
    return {
      count: this.count,
      download: this.download.id,
      tracking_id: this.tracking_id
    };
  }

  packageErrorPayload(e = {}) {
    return {
      ...this.packagePrimary(),
      message: e.message || 'errors.UNKNOW_ERROR_OCCURRED',
      state: this._stateKeys.ERROR,
      stateName: this._states[this._stateKeys.ERROR]
    };
  }

  packagePendingPayload() {
    return {
      ...this.packagePrimary(),
      state: this._stateKeys.PENDING,
      stateName: this._states[this._stateKeys.PENDING]
    };
  }

  packageBuildingPayload() {
    return {
      ...this.packagePrimary(),
      state: this._stateKeys.BUILDING,
      stateName: this._states[this._stateKeys.BUILDING]
    };
  }

  packageProcessingPayload() {
    return {
      ...this.packagePrimary(),
      state: this._stateKeys.PROCESSING,
      stateName: this._states[this._stateKeys.PROCESSING]
    };
  }

  packageFinishedPayload() {
    return {
      ...this.packagePrimary(),
      state: this._stateKeys.FINISHED,
      stateName: this._states[this._stateKeys.FINISHED],
      file: {
        ...this._sysfile
      }
    };
  }

  broadcastPending() {
    this.broadcast(this.packagePendingPayload());
  }

  broadcastProcessing() {
    this.broadcast(this.packageProcessingPayload());
  }

  broadcastBuilding() {
    sails.log.debug('STREAMING DOWNLOAD DATA', this.count);
    this.broadcast(this.packageBuildingPayload());
  }

  broadcastFinished() {
    sails.log.debug('FINISHED PROCESSING FILE DOWNLOAD', this.count);
    this.broadcast(this.packageFinishedPayload());
  }

  broadcastError(e) {
    sails.log.error(
      'NODE_DOWNLOAD_STREAMING_ERROR',
      e,
      this.download.id,
      e.message
    );
    this.broadcast(this.packageErrorPayload(e));
  }

  isReadyToSend() {
    return this.count % this._every === 0;
  }

  async buildPayload() {
    if (this.isReadyToSend()) {
      this.broadcastBuilding();
      await this.setCount();
    }
  }

  getRowElementArray(data) {
    this.transformer.row = data;
    const row = this.transformer.preProcess();
    for (let i = 0; i < this.params.length; i++) {
      const param = this.params[i];
      // this transformation must be fast. All elements should be cached
      const value = this.transformer.convert(param);
      row.push(value);
    }
    return row;
  }

  transform(data) {
    const row = this.getRowElementArray(data);
    this.excelStream.addRowToWorkSheetAndCommit(this.worksheetname, row);
  }

  writeStream(data) {
    this.incrementCount();
    this.transform(data);
    this.buildPayload();
  }

  async endStream() {
    this.excelStream.commitWorkSheet(this.worksheetname);
    await this.excelStream.commitWorkbook();
    this.broadcastBuilding();
    this.broadcastProcessing();
  }

  async buildStream() {
    try {
      await new Promise((resolve, reject) => {
        this.stream = this.client.stream();
        this.stream.on('data', this.writeStream.bind(this));
        this.stream.on('end', resolve);
        this.stream.on('error', reject);
      });
      await this.endStream();
    } catch (e) {
      this.broadcastError(e);
    }
  }

  doesNotHaveSocket() {
    const has = true;
    for (let i = 0; i < this.sockets.length; i++) {
      const socket = this.sockets[i];
      if (socket === this.socket) {
        return false;
      }
    }
    return has;
  }

  async getNewSocket() {
    const user = this.download.user;
    if (!user) {
      return;
    }
    this.sockets = await UserSession.getSockets(user);
    if (this.doesNotHaveSocket()) {
      this.sockets.push(this.socket);
    }
  }

  async pullUser() {
    const user = this.download.user;
    if (!user) {
      return;
    }
    this.user = await User.findOneById(User.getId(user));
  }

  refreshSkip() {
    if (this._skip) {
      return;
    }
    this._skip = this.download.skip || 0;
  }

  setMeta(key, value) {
    this.download.meta = this.download.meta || {};
    this.download.meta[key] = value;
  }

  async saveDownloadData() {
    return NodeDownload.saveAsync(this.download).then(nd => {
      return NodeDownload.findOneById(NodeDownload.getId(nd))
        .populateAll()
        .then(nd => {
          this.download = nd;
          return nd;
        });
    });
  }

  async setJobId() {
    if (!this.job) {
      return;
    }
    this.setMeta('job', this.job.id);
    return this.saveDownloadData();
  }

  async getSchemaName() {
    return this.schema.name;
  }

  async addSheet() {
    this.worksheetname = await this.getSchemaName();
    this.excelStream.addSheet(this.worksheetname, {
      pageSetup: { paperSize: 9, orientation: 'landscape' }
    });
    this.labels = this.transformer.getLabels();
    this.excelStream.addRowToWorkSheetAndCommit(
      this.worksheetname,
      this.labels
    );
  }

  async createWorkBook() {
    const filename = this.download.fileId;
    const options = {
      useStyles: true,
      useSharedStrings: true
      // zip: true // doesn't seem to work. I implemented an archive function
    };

    this.excelStream = new ExcelStream(filename, options);
    await this.addSheet();
  }

  async addTransformer() {
    // Get translation
    const varCache =
      Variable.varCache(
        await Variable.find({
          or: [{ key: 'system_translations' }]
        }),
        this.lang
      ) || {};

    this.transformer = new NodeParamTransformer(
      this.schema,
      varCache,
      this.lang,
      this.download.selected_params
    );
    await this.transformer.buldSchemaVars();
    await this.transformer.applyPreProcessorCache(this.getWhere());
  }

  async getSysFileParmas(filename) {
    const fd = new FileDetails(filename);
    const deets = this._uploadDetails;
    const title = this.schema.title || this.schema.name;
    const stat = await fd.getStat();
    return {
      title: `${title} data ${this.transformer.getFullDate(
        TimeUtils.constants.now_
      )}`,
      description: `Downloaded by ${User.fullName(this.owner)} `,
      owner: User.getId(this.owner),
      fd: fd.filename,
      filename: `${this.download.name}.zip`,
      cloud_deployed: FileProtocolManager.isCloudBase(),
      status: 'excel_download',
      field: 'file',
      size: stat.size,
      type: fd.mm(),
      target_model: 'user',
      target: Model.getId(this.owner),
      extra: {
        ...deets
      }
    };
  }

  async buildSysFile(filename) {
    const sysfileTemplate = await this.getSysFileParmas(filename);
    this._sysfile = await SysFile.create(sysfileTemplate);
  }

  zipFile(fs) {
    const fz = new FileZip(this.download.name, fs.fileDetails);
    return fz.zip();
  }

  finalize() {
    this.download.file = SysFile.getId(this._sysfile);
    this.download.finished = true;
    return this.saveDownloadData();
  }

  async sendFile() {
    try {
      const fs = new FileStream(this.excelStream.filename);
      const filename = await this.zipFile(fs);
      await fs.destroyFile();
      fs.filename = filename;
      this._uploadDetails = await fs.upload();
      await this.buildSysFile(filename);
      await fs.destroyFile();
      await this.finalize();
      this.broadcastFinished();
    } catch (e) {
      this.broadcastError(e);
    }
  }

  async getOwner() {
    if (typeof this.download.user === 'object') {
      this.owner = this.download.user;
    } else {
      const uId = User.getId(this.download.user);
      this.owner = await User.findOneById(uId);
    }
  }

  async build() {
    sails.log.debug(
      'STARTING DOWNLOAD',
      this.download.id,
      this.download.fileId
    );
    await this.getNewSocket();
    this.broadcastPending();
    await this.setSchema();
    await this.getOwner();
    await this.addTransformer();
    await this.createWorkBook();
    await this.setJobId();

    this.refreshSkip();
    this.setStream();
    await this.buildStream();
    await this.sendFile();
  }
}

module.exports = { NodeDownloadActionsPrivate };
