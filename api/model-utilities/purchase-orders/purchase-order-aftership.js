class POAfterShip {
  constructor(po, params, site, domain) {
    this._po = po;
    this._params = params;
    this._site = site;
    this._domain = domain;
    this.Aftership = require('aftership')(this.integrations);
  }

  static hasNoAfterShipIntegration(site) {
    return !site || !(site.integrations || {}).after_ship;
  }

  get integrations() {
    return (this._site.integrations || {}).after_ship;
  }

  get afterShipTitle() {
    const title = `${this._site.site_name}-${Domain.getId(this._domain) ||
      'similie'}-${(this._po || {}).transaction_id || 'return'}`;
    return title;
  }

  get slug() {
    const slug = this._params.slug.replaceAll('_', '-');
    return slug;
  }

  get tracking() {
    return this._params.tracking;
  }

  get existingTrackings() {
    let trackings =
      this._params.tracking_payload ||
      ((this.meta || {}).shipment || {}).trackings ||
      [];

    if (_.isString(trackings)) {
      trackings = JSON.parse(trackings);
    }
    return trackings;
  }

  get transaction_id() {
    return (this._po || {}).transaction_id;
  }

  get id() {
    return this._params.id;
  }

  get meta() {
    return this._po.meta;
  }

  get afterShipBody() {
    const title = this.afterShipTitle;
    const tracking_number = this.tracking;
    const slug = this.slug;
    const body = {
      tracking: {
        slug: `${slug}`,
        tracking_number: `${tracking_number}`,
        title: title,
        // smses: ["+18555072509", "+18555072501"],
        // emails: ["email@yourdomain.com", "another_email@yourdomain.com"],
        order_id: this.transaction_id
        // order_id_path: "http://www.aftership.com/order_id=1234",
        // custom_fields: {
        //   product_name: "iPhone Case",
        //   product_price: "USD19.99"
        // }
      }
    };
    return body;
  }

  savePowithMeta(meta) {
    this._po.meta = meta;
    return PurchaseOrder.saveAsync(this._po);
  }

  async processDeleteMessage() {
    this.checkSlugAndTracking();
    const results = await this.Aftership.call(
      'DELETE',
      `/trackings/${this.slug}/${this.tracking}`
    );
    if (!this.id) {
      return results;
    }
    _.remove(
      this.meta.shipment.trackings,
      s => s.slug === this._params.slug && s.tracking === this.tracking
    );

    await this.savePowithMeta(this.meta);
    return results;
  }

  async processGetMessage() {
    const results = [];
    for (let i = 0; i < _.size(this.existingTrackings); i++) {
      const tracking = this.existingTrackings[i];
      results.push(
        await this.Aftership.call(
          'GET',
          `/trackings/${tracking.slug}/${tracking.tracking}`
        )
      );
    }
    return results;
  }

  checkSlugAndTracking() {
    if (!this.slug || !this.tracking) {
      throw new Error('errors.TRACKING_DETAILS_INVALID');
    }
  }

  async processPostMessage() {
    this.checkSlugAndTracking();
    const tracking_number = this.tracking;
    const slug = this.slug;
    const body = this.afterShipBody;
    const _res = await this.Aftership.call('POST', '/trackings', {
      body: body
    });
    if (_res && (_res.meta || {}).code !== 201) {
      return _res;
    }
    const results = await this.Aftership.call(
      'GET',
      `/trackings/${slug}/${tracking_number}`
    );

    if (!this.id) {
      return results;
    }
    const title = this.afterShipTitle;
    const meta = this.meta;
    meta.shipment = meta.shipment || {};
    meta.shipment.trackings = meta.shipment.trackings || [];
    meta.shipment.trackings.push({
      slug: slug,
      tracking: tracking_number,
      title: title
    });

    await this.savePowithMeta(meta);
    results.object_meta = meta;
    return results;
  }
}

module.exports = { POAfterShip };
