const { TimeUtils } = require('similie-api-services');
const CacheStore = require('./CacheStore');
const now_ = TimeUtils.constants.now_;

class Session {
  constructor(req, ttl, session_id) {
    this.data = {};
    this.user = req.user;
    this.ttlRaw = +ttl || sails.config.session.ttl || 86400;
    this.ttl = this.ttlRaw * 1000;
    this.expire = this.ttl / 1000;
    this.checkBuffer = 5000;
    this.activity = req.activity;
    this.cookie = req.is_cookie;
    this.lastSeenKey = 'lastseen';
    if (this.cookie) {
      this.session_id = session_id || req.session_id;
      this.user.lightSession(this.session_id);
      return;
    }
    if (session_id) {
      this.session_id = session_id;
    } else if ((this.user || {}).api_session) {
      this.session_id = (this.user || {}).api_session;
    } else {
      this.session_id = Utils.buildToken();
      this.user.lightSession(this.session_id, 'api');
    }
    this.open = true;
  }

  get activityId() {
    return Model.getId(this.activity);
  }

  updateActivity(user) {
    if (this.activityId) {
      return UserActivity.update(
        { id: this.activityId },
        { resolution: UserActivity.EXPIRED_SESSION }
      );
    }
    return UserActivity.create({
      user: user.id,
      event: UserActivity.EXPIRED_SESSION
    });
  }

  async pop() {
    try {
      const user = await User.findOneById(this.user.id).populateAll();
      if (!user.online) {
        return;
      }

      user.online = false;
      await User.saveAsync(user);
      await this.destroy();
      await user.socketMessage(Const.sockets.SESSION_EXPIRED, user);
      return this.updateActivity();
    } catch (e) {
      sails.log.error('SESSION_POP_ERROR', e);
    }
    return null;
  }

  getSessionTimestamp() {
    return CacheStore.hget(this.touchSession, this.lastSeenKey);
  }

  async findLastSeen() {
    const timestamp = await this.getSessionTimestamp();
    if (!timestamp) {
      return this.pop();
    }
    const d = this.delta(this.ttlRaw, timestamp);
    return this.cycle(d);
  }

  startJob() {
    Jobs.sessionPrune.add(
      {
        user: this.user,
        sessionID: this.session_id,
        activity: this.activity,
        ttl: this.ttlRaw
      },
      { delay: this.ttl + this.checkBuffer } // this.ttl }
    );
  }

  cycle(wait = 1) {
    if (!this.session_id) {
      return;
    }
    if (Site.isInTestMode()) {
      return setTimeout(this.findLastSeen.bind(this), Utils.timeoutVal(wait));
    }
    this.startJob();
  }

  del(key) {
    return CacheStore.destroy(key);
  }

  async destroy(next) {
    if (this.user) {
      this.user.torchSession(this.session_id);
    }
    const sessions = [this.touchSession, this.session_id];
    try {
      for (const session of sessions) {
        await this.del(session);
      }
    } catch (e) {
      return this.noop(next, e);
    }
    this.noop(next);
  }

  async online() {
    this.user.online = true;
    await User.saveAsync(this.user);
    return this.user;
  }

  async track() {
    await this.touch();
    return this.cycle(this.ttlRaw);
  }

  getData() {
    return this.data;
  }

  async pull(next) {
    try {
      this.data = await CacheStore.pull(this.touchSession);
      this.noop(next, null, this.data);
      return this.data;
    } catch (e) {
      return this.noop(next, e);
    }
  }

  noop(fn, ...args) {
    return (fn || _.noop)(...args);
  }

  set(key = '', valueKey = this.lastSeenKey, value) {
    return CacheStore.hset(key, valueKey, value);
  }

  expireKey(key, expire) {
    return CacheStore.expire(key, expire);
  }

  async setExpire() {
    const sessions = [this.touchSession, this.session_id];
    try {
      for (const session of sessions) {
        await this.expireKey(session, this.expire);
      }
    } catch (e) {
      return sails.log.error(e);
    }
  }

  get lastSeen() {
    return `${TimeUtils.date(now_).toMillis.toString()}`;
  }

  get touchSession() {
    return `${this.session_id}::api:v1`;
  }

  async touch(next) {
    try {
      await this.set(this.touchSession, this.lastSeenKey, this.lastSeen);
      await this.setExpire();
    } catch (e) {
      sails.log.error(e);
      return this.noop(next, e.message);
    }
    return this.noop(next);
  }

  async getAll(cb) {
    try {
      const keys = await CacheStore.keys(this.touchSession);
      this.noop(cb, null, keys);
      return keys;
    } catch (e) {
      this.noop(cb, e);
    }
  }

  async get(name, cb) {
    if (!this.session_id) {
      throw new Error('errors.SESSION_ID_REQUIRED');
    }
    try {
      const response = await CacheStore.hget(this.touchSession, name);
      this.noop(cb, null, response);
      return response;
    } catch (err) {
      this.noop(cb, err);
    }
  }

  async add(name, content, cb) {
    if (!this.session_id) {
      throw new Error('errors.SESSION_ID_REQUIRED');
    }

    if (name === this.lastSeenKey) {
      throw new Error('errors.RESERVED_KEY');
    }

    try {
      const cString = JSON.stringify(content);
      const values = await this.set(this.touchSession, name, cString);
      this.noop(cb, values);
      return values;
    } catch (e) {
      return this.noop(cb, e);
    }
  }

  delta(ttl, timestamp) {
    if (_.isString(timestamp)) timestamp = parseInt(timestamp);

    const now = TimeUtils.date(now_).toMillis;
    const deltaMillis = ttl - (now - timestamp);
    // ensures the value is always positive
    return Math.abs(deltaMillis, 1);
  }

  static setEphemeral(key, value, ttl = 1) {
    return new Promise((resolve, reject) => {
      return Session.client.set(key, value, (err, value) => {
        if (err) {
          return reject(err);
        }
        Session.client.expire(key, ttl, err => {
          if (err) {
            return reject(err);
          }
          resolve(value);
        });
      });
    });
  }

  static getEphemeral(key) {
    return new Promise((resolve, reject) => {
      Session.client.get(key, (err, value) => {
        if (err) {
          return reject(err);
        }
        resolve(value);
      });
    });
  }

  static buildFormattedDate() {
    const fmt = TimeUtils.constants.formats.Time.UnixMillis;
    return TimeUtils.formattedDate('', fmt);
  }

  static setSessionTimestamp(req) {
    req.session.timestamp = Session.buildFormattedDate();
  }

  static async getSessionDetails(req, activity) {
    const key = await User.assignSessionKey(req);
    return {
      user: req.user,
      session_id: key,
      activity: activity,
      is_cookie: true
    };
  }

  static get client() {
    return CacheStore.client();
  }
}

module.exports = Session;
