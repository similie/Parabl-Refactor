const headerSplitOnDot = (key = '', row) => {
  const split = key.split('.');
  return (row[split[0]] || {})[split[1]] || '';
};

const splitKeyAgainstCell = (key, row, params = { var_cache: {} }) => {
  const value = headerSplitOnDot(key, row);
  let cell = '';
  if (_.isBoolean(value)) {
    cell = value ? params.var_cache.YES : params.var_cache.NO;
  } else if (_.isUndefined(value) || value === null) {
    cell = ((params || {}).var_cache || {}).NULL || 'NULL';
  } else {
    cell = value;
  }
  return cell || '';
};

const setNullCell = (key, row, params = { var_cache: {} }) => {
  const value = headerSplitOnDot(key, row);
  let cell = value;
  if (typeof value === 'undefined' || value === null) {
    cell = params.var_cache.NULL;
  }
  return cell;
};

module.exports = {
  splitKeyAgainstCell,
  headerSplitOnDot,
  setNullCell
};
