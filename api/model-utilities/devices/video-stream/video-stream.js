const { FileStoreManager } = require('../../sysfiles/file-protocol-manager');

class VideoStream {
  _req;
  _res;
  _video;
  constructor(req, res) {
    this.req = req;
    this.res = res;
  }

  get req() {
    return this._req;
  }

  set req(req) {
    this._req = req;
  }

  get res() {
    return this._res;
  }

  set res(res) {
    this._res = res;
  }

  get video() {
    return this._video;
  }

  set video(video) {
    this._video = video;
  }

  async setVideo() {
    const params = this.req.params.all();
    this.video = await VideoCapture.findOneById(params.id);
  }

  get posterName() {
    const split = this.video.poster.split('/');
    return split[split.length - 1];
  }

  async poster() {
    await this.setVideo();
    if (!Model.getId(this.video)) {
      return this.res.badRequest({
        error: 'There is no playable video content'
      });
    }
    const fsm = new FileStoreManager(this.video.bucket, this.video.poster);
    const stat = await fsm.statObject();
    const headers = {
      // attachment;
      'Content-Disposition': `inline; filename="${this.posterName}"`,
      'Cache-Control': 'max-age=86400',
      'Transfer-Encoding': 'chunked',
      'Content-Length': stat.size,
      'Content-Type': 'image/jpg'
    };
    this.res.set(headers);
    const stream = await fsm.streamFile();
    stream.pipe(this.res);
  }

  async play() {
    await this.setVideo();
    if (!Model.getId(this.video)) {
      return this.res.badRequest({
        error: 'There is no playable video content'
      });
    }
    const range = this.req.headers.range;
    if (!range) {
      return this.res.badRequest({ error: 'Requires Range header' });
    }
    const fsm = new FileStoreManager(this.video.bucket, this.video.path);
    const stat = await fsm.statObject();
    const CHUNK_SIZE = 10 ** 6; // 1MB
    const start = Number(range.replace(/\D/g, ''));
    const end = Math.min(start + CHUNK_SIZE, stat.size - 1);
    const contentLength = end - start + 1;
    const headers = {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': contentLength,
      'Content-Type': 'video/mp4'
    };
    this.res.writeHead(206, headers);
    const stream = await fsm.streamVideo(start, end);
    stream.pipe(this.res);
  }
}

module.exports = { VideoStream };
