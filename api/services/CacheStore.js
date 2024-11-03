const redis = require('redis');

const connectionOptions = () => {
  const sessConnect = _.clone(sails.config.session);
  const options = {};
  const pass = sessConnect.pass;
  const prefix = sessConnect.prefix;
  if (pass) {
    options.password = pass;
  }

  if (prefix) {
    options.prefix = prefix;
  }

  if (sessConnect.db) {
    options.db = sessConnect.db;
  }

  return options;
};

const connection = () => {
  const sessConnect = _.clone(sails.config.session);
  const options = connectionOptions();

  return {
    ...sessConnect,
    options
  };
};

const getRedisConnection = () => {
  const redisConnect = connection();
  return redis.createClient(
    redisConnect.port,
    redisConnect.host,
    redisConnect.options
  );
};

const parseData = (obj = {}) => {
  const data = {};
  for (const key in obj) {
    const value = obj[key];
    try {
      data[key] = JSON.parse(value);
    } catch {
      data[key] = value;
    }
  }
  return data;
};

const client = getRedisConnection();

module.exports = {
  connection: function() {
    return connection();
  },
  hkeys: pattern => {
    return new Promise((resolve, reject) => {
      client.hkey(pattern, (err, replies) => {
        if (err) {
          return reject(err);
        }
        resolve(replies);
      });
    });
  },
  keys: pattern => {
    return new Promise((resolve, reject) => {
      client.keys(pattern, (err, replies) => {
        if (err) {
          return reject(err);
        }
        resolve(replies);
      });
    });
  },
  hexists: (key, field = '') => {
    return new Promise((resolve, reject) => {
      client.hexists(key, field, (err, value) => {
        if (err) {
          return reject(err);
        }
        resolve(value);
      });
    });
  },
  exists: key => {
    return new Promise((resolve, reject) => {
      client.exists(key, (err, value) => {
        if (err) {
          return reject(err);
        }
        resolve(value);
      });
    });
  },
  client: () => {
    return client;
  },
  destroy: async key => {
    return new Promise((resolve, reject) => {
      client.del(key, err => {
        if (err) {
          return reject(err);
        }
        resolve();
      });
    });
  },
  hset: (key, valueKey, value) => {
    return new Promise((resolve, reject) => {
      client.hset(key, valueKey, value, err => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  },
  hget: async (key, hash) => {
    if (!key) {
      throw new Error('errors.KEY_REQUIRED');
    }
    return new Promise((resolve, reject) => {
      client.hget(key, hash, (err, reply) => {
        if (err) {
          return reject(err);
        }
        try {
          const response = JSON.parse(reply);
          resolve(response);
        } catch {
          resolve(reply);
        }
      });
    });
  },
  pull: async hash => {
    return new Promise((resolve, reject) => {
      client.hgetall(hash, (err, obj) => {
        if (err) {
          return reject(err);
        }
        const data = parseData(obj);
        resolve(data);
      });
    });
  },
  add: (key, hash, content) => {
    const cString = JSON.stringify(content);
    return new Promise((resolve, reject) => {
      client.hset(key, hash, cString, (err, result) => {
        if (err) {
          return reject(err);
        }
        resolve(result);
      });
    });
  },
  set: (key, content) => {
    return new Promise((resolve, reject, ex) => {
      ex = ex || 60 * 60;
      client.set(key, content, 'EX', ex, (err, result) => {
        if (err) {
          return reject(err);
        }
        resolve(result);
      });
    });
  },
  get: key => {
    return new Promise((resolve, reject) => {
      client.get(key, (err, result) => {
        if (err) {
          return reject(err);
        }
        resolve(Utils.parseJSON(result));
      });
    });
  },
  expire(key, expire) {
    return new Promise((resolve, reject) => {
      client.expire(key, expire, err => {
        if (err) {
          return reject(err);
        }
        resolve();
      });
    });
  },
  keys(key) {
    return new Promise((resolve, reject) => {
      client.hkeys(key, (err, replies) => {
        replies.forEach((reply, i) => {
          sails.log.debug('    ' + i + ': ' + reply);
        });
        if (err) {
          reject(err);
        }
        resolve(replies);
      });
    });
  },
  shutdown() {
    return client.end(true);
  }
};
