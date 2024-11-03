const { SqlUtils, TimeUtils } = require('similie-api-services');
class Common {
  static validEmail(email = '') {
    return email.match(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/);
  }

  static timeIsNow() {
    return TimeUtils.isoFormattedDate(TimeUtils.constants.now_);
  }

  static applySqlLimiters(params = {}) {
    const escape = SqlUtils.escapeUtil();
    let limitQuery = '';
    if (params.sort) {
      limitQuery = escape(` %s`, SqlUtils.buildSort(params.sort));
      delete params.sort;
    }

    if (params.skip) {
      limitQuery += escape(` OFFSET %s`, params.skip);
      delete params.skip;
    }

    if (params.limit) {
      limitQuery += escape(' LIMIT %s', params.limit);
      delete params.limit;
    }
    return limitQuery;
  }

  static noop(cb, ...args) {
    return (cb || _.noop)(...args);
  }

  static objectify(potentialObject, key) {
    return (potentialObject || {})[key];
  }

  static keyLength(obj) {
    const keys = Object.keys(obj);
    return keys.length;
  }

  static splitSqlJoinString(on, queryString = '', replaceWith) {
    const split = queryString.split(on);
    let joined = '';
    for (let i = 0; i < split.length; i++) {
      let chunk = split[i];
      if (chunk.startsWith('.')) {
        chunk = chunk.replace('.', `${replaceWith}"."`);
      }
      joined += chunk;
    }
    return joined;
  }

  static objectValuesToArray(obj) {
    const arr = [];
    for (const key in obj) {
      const value = obj[key];
      arr.push(value);
    }
    return arr;
  }

  static returnItemIds(items = []) {
    const ids = [];
    const idHold = {};
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const id = Model.getId(item);
      if (id && !idHold[id]) {
        ids.push(id);
        idHold[id] = true;
      }
    }
    return ids;
  }

  static returnItemIdsOnParam(items = [], param = 'id') {
    const ids = [];
    const idHold = {};
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const id = Model.getId(item[param]);
      if (id && !idHold[id]) {
        ids.push(id);
        idHold[id] = true;
      }
    }
    return ids;
  }

  static buildBasicItemCache(items = [], param = 'id') {
    const iCache = {};
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      iCache[item[param]] = item;
    }
    return iCache;
  }

  static buildBasicItemCacheFor(items = [], param = 'id', forParam = 'id') {
    const iCache = {};
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      iCache[item[param]] = item[forParam];
    }
    return iCache;
  }

  static getIdArrayFromObjectCache(cache) {
    const send = [];
    for (const key in cache) {
      const obj = cache[key];
      const id = Model.getId(obj);
      if (id) {
        send.push(id);
      }
    }
    return send;
  }

  static hasBeenTouched(value) {
    return value != null;
  }

  static safeJSONparse(value, defaultValue) {
    try {
      return JSON.parse(value);
    } catch (error) {
      return defaultValue || { error: `JSON schema error` };
    }
  }
}

module.exports = { Common };
