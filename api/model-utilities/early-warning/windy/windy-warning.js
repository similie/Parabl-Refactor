const { WindyDomains } = require('./windy-domains');
const { WindyEvent } = require('./windy-event');
const { WindyEws } = require('./windy-ews');

class WindyWarning {
  constructor() {
    this._domainEvents = {};
    this._processedEWS = {};
    this._wd = new WindyDomains();
  }

  get processedEvents() {
    return this._processedEWS;
  }

  async setDomains() {
    this._domains = await this._wd.queryDomains();
  }

  async cycleDomains() {
    for (let i = 0; i < this._domains.length; i++) {
      const domain = this._domains[i];
      const dId = Domain.getId(domain) || '__null';
      const events = await this._wd.domainEvents(domain);
      this._domainEvents[dId] = [];
      for (let i = 0; i < events.length; i++) {
        const event = events[i];
        const we = new WindyEvent(event, domain.key);
        this._domainEvents[dId].push(we);
      }
    }
  }

  async processEvents() {
    for (const dId in this._domainEvents) {
      const windyEvents = this._domainEvents[dId];
      this._processedEWS[dId] = [];
      for (let i = 0; i < windyEvents.length; i++) {
        const we = new WindyEws(windyEvents[i]);
        const ews = await we.process();
        if (ews) {
          this._processedEWS[dId].push(ews);
        }
      }
    }
  }

  async scan() {
    await this.setDomains();
    await this.cycleDomains();
    await this.processEvents();
    return this.processedEvents;
  }
}

module.exports = { WindyWarning };
