const {
  NodeDownloadActionsPrivate
} = require('./nodedownloads-private-actions');

class NodeDownloadActions {
  _action;
  constructor(nodedownload, job) {
    this._action = new NodeDownloadActionsPrivate(nodedownload, job);
  }

  build() {
    return this._action.build();
  }

  get nodedownload() {
    return this._action.nodedownload;
  }

  sendError(err) {
    return this._action.broadcastError(err);
  }
}

module.exports = { NodeDownloadActions };
