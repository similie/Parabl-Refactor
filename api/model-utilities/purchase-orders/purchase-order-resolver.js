const { TimeUtils, SqlUtils } = require('similie-api-services');
const { poStates } = require('./purchase-order-states');
const tz = TimeUtils.constants.timeZone;
const now_ = TimeUtils.constants.now_;
const TimePeriod = TimeUtils.constants.ENUMS.timePeriods;

class PurchaseOrderResolver {
  constructor(queryParams = {}) {
    this.params = queryParams;
    this.escape = SqlUtils.escapeUtil();
  }

  get escape() {
    return this._escape;
  }

  set escape(escape) {
    this._escape = escape;
  }

  get params() {
    return this._queryParams || {};
  }

  set params(queryParams) {
    this._queryParams = queryParams;
  }

  get search() {
    return this.params.transaction_id;
  }

  get states() {
    return this.params.state || [];
  }

  get identity() {
    return this.params.identity;
  }

  get dayStart() {
    return this.params.dayStart;
  }

  get dayEnd() {
    return this.params.dayEnd;
  }

  get nodes() {
    return this.params.queryNodes;
  }

  get from() {
    return this.params.from;
  }

  get to() {
    return this.params.to;
  }

  get thirtyDays() {
    const dateNow = TimeUtils.date(now_).tz(tz);
    return dateNow.minus('30', TimePeriod.days).toISO;
  }

  get stateOjectMap() {
    const obj = {};
    for (let i = 0; i < this.states.length; i++) {
      const state = this.states[i];
      obj[state] = true;
    }
    return obj;
  }

  get notStates() {
    const states = [];
    const stateMap = this.stateOjectMap;
    const allStates = poStates();
    for (const key in allStates) {
      const thisState = allStates[key];
      if (stateMap[thisState]) {
        continue;
      }
      states.push(thisState);
    }
    return states;
  }

  stateQuery(not = false) {
    if (!this.states.length) {
      return '';
    }
    const states = not ? this.notStates : this.states;
    return this.escape(`"state" IN (%s)`, states.map(m => `'${m}'`).join(', '));
  }

  get searchConditionQuery() {
    if (!this.search) {
      return '';
    }
    return [
      '(' + this.escape(`"from" ILIKE '%%%s%%'`, this.search),
      this.escape(`"name" ILIKE '%%%s%%'`, this.search),
      this.escape(`"transaction_id" ILIKE '%%%s%%'`, this.search) + ')'
    ]
      .filter(f => f)
      .join(' OR ');
  }

  get initialStateConditions() {
    return [
      this.identity ? this.escape(`"identity" = '%s'`, this.identity) : '',
      this.dayStart ? this.escape(`"updatedAt" >= '%s'`, this.dayStart) : '',
      this.dayEnd ? this.escape(`"updatedAt" <= '%s'`, this.dayEnd) : '',
      this.nodes && this.nodes.length
        ? this.escape(
            `"schema" IN (%s)`,
            this.nodes.map(m => `'${m}'`).join(', ')
          )
        : '',
      this.to ? this.escape(`"to" = '%s'`, this.to) : '',
      this.from ? this.escape(`"from" = '%s'`, this.from) : '',
      this.searchConditionQuery
    ]
      .filter(f => f)
      .join(' AND ');
  }

  get thirtyDayQuery() {
    return this.escape(`"updatedAt" >= '%s'`, this.thirtyDays);
  }

  get buildDefaultQuery() {
    if (this.dayStart || this.dayEnd) {
      return '';
    }

    const states = this.stateQuery();
    if (!states) {
      return this.thirtyDayQuery;
    }
    const statesNot = this.stateQuery(true);
    const include = ['(' + this.thirtyDayQuery, statesNot + ')']
      .filter(f => f)
      .join(' AND ');
    return ['(' + include, states + ')'].filter(f => f).join(' OR ');
  }

  get mergeQueryValues() {
    const primaryConditions = this.initialStateConditions;
    const defaultQuery = this.buildDefaultQuery;
    return [primaryConditions, defaultQuery].filter(f => f).join(' AND ');
  }

  get buldFullQuery() {
    const select = 'SELECT "id" from purchaseorder ';
    const where = `WHERE ${this.mergeQueryValues}`;
    const orderBy = `ORDER BY "weight" ASC, "updatedAt" DESC`;
    return [select, where, orderBy].filter(f => f).join(' ');
  }

  async resolve() {
    const query = this.buldFullQuery;
    // sails.log.debug('PurchaseOrderController::get_po: Search Query', query);
    const po = await PurchaseOrder.queryAsync(query);
    const results = po.rows;
    const purchaseOrder = await PurchaseOrder.find({
      id: results.map(po => Model.getId(po))
    }).populateAll();
    return purchaseOrder;
  }
}

module.exports = { PurchaseOrderResolver };
