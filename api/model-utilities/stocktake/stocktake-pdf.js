const { TimeUtils, Pdf } = require('similie-api-services');
const Formats = TimeUtils.constants.formats;
const _lo = require('lodash');

class StocktakePDF {
  _content = [];
  _schemaSc = {};
  _schemaCache = {};
  _schemaVars = [
    ...[
      'labels.VARIANCE_TOTAL',
      'labels.APPROVED_BY',
      'labels.APPROVED_ON',
      'labels.RECONCILED',
      'labels.STATUS',
      'labels.AWAITING_RECONCILIATION',
      'labels.TOTAL_TIME',
      'labels.FIRST_NAME',
      'labels.LAST_NAME',
      'labels.CONTRIBUTORS',
      'labels.ITEM_NAME',
      'labels.ITEM_SKU',
      'labels.ITEM_QUANTITY',
      'labels.ITEM_VARIANCE',
      'labels.ITEM_TOTAL_VALUE',
      'labels.VARIANT_ITEMS'
    ]
  ];

  constructor(
    stocktake = {},
    config = {},
    language = Translates.fallbackLanguage
  ) {
    this.st = stocktake;
    this.config = config;
    this.language = language;
    this.schemaCacheInit();
  }

  get content() {
    return this._content;
  }

  get config() {
    return this._config;
  }

  set config(config) {
    this._config = config;
  }

  get language() {
    return this._language;
  }

  set language(language) {
    this._language = language;
  }

  get st() {
    return this._stocktake;
  }

  set st(stocktake) {
    this._stocktake = stocktake;
  }

  get schemas() {
    return this.st.schemas || [];
  }

  get varCache() {
    return this._varCache;
  }

  set varCache(varCache) {
    this._varCache = varCache;
  }

  get station() {
    return this.st.station || {};
  }

  get stationId() {
    return this.getId(this.station);
  }

  get stationName() {
    return this.station.local_name;
  }

  get paramHelp() {
    return Module._helpers.logistics();
  }

  get currency() {
    return this.config.currency || Const.DEFAULT_CURRENCY;
  }

  get startDate() {
    return TimeUtils.formattedDate(this.st.start_date, Formats.Date.full);
  }

  get endDate() {
    return TimeUtils.formattedDate(this.st.end_date, Formats.Date.full);
  }

  get fileName() {
    return this.varCache.inventory_list_doc_name || 'Inventory List';
  }

  get headingName() {
    return this.varCache.stocktake_heading || 'Stocktake:';
  }

  get head() {
    return `${this.headingName} ${this.startDate} - ${this.endDate}`;
  }

  get query() {
    return StockTake.varianceQuery(this.st);
  }

  get schemaSc() {
    return this._schemaSc;
  }

  set schemaSc(schemaSc) {
    this._schemaSc = schemaSc;
  }

  get pdfContent() {
    return this._pdfContent;
  }

  set pdfContent(pdfContent) {
    this._pdfContent = pdfContent;
  }

  get reconciled() {
    return this.st.reconciled;
  }

  get downloadHeader() {
    const headers = {};
    headers[
      'Content-Disposition'
    ] = `attachment; filename="${this.fileName} ${this.startDate} - ${this.endDate}".pdf`;
    return headers;
  }

  getId(values) {
    return Model.getId(values);
  }

  async pdfContentInit() {
    if (this.pdfContent) {
      return this.pdfContent;
    }
    this.pdfContent = await Utils.basicPDFPage(this.config, this.head, []);
    return this.pdfContent;
  }

  getStockCounts() {
    return StockCount.queryAsync(this.query);
  }

  schemaCacheInit() {
    for (let i = 0; i < this.schemas.length; i++) {
      const nodeschema = this.schemas[i];
      const schema = nodeschema.schema || [];
      for (let j = 0; j < schema.length; j++) {
        const params = schema[j];
        const name = params.label || params.name;
        this._schemaCache[params.name] = name;
        this._schemaVars.push(name);
      }
    }
  }

  async appyVariaibleCache() {
    this.varCache = Variable.varCache(
      await Variable.find({
        or: [
          { key: 'pdf_utils_stocktake' },
          { key: Translates.translateIdentity, identity: this._schemaVars }
        ]
      }),
      this.language
    );
  }

  async applySchemaGroups() {
    const sc = await this.getStockCounts();
    this.schemaSc = _lo.groupBy(sc.rows, 'schema');
  }

  getParamMap(logParams) {
    const qParam = logParams('quantity');
    const skuParam = logParams('sku');
    const descParam = logParams('name');
    const service_item = logParams('service_item');
    return {
      qParam,
      skuParam,
      descParam,
      service_item
    };
  }

  getNameMap(pMap = {}, schema = {}) {
    const descTrans =
      this.varCache[this._schemaCache[pMap.descParam]] ||
      this._schemaCache[pMap.descParam];
    const skuTrans =
      this.varCache[this._schemaCache[pMap.skuParam]] ||
      this._schemaCache[pMap.skuParam];
    const quantTrans =
      this.varCache[this._schemaCache[pMap.qParam]] ||
      this._schemaCache[pMap.qParam];
    const schemaName = schema.title || schema.name;

    return {
      descTrans,
      skuTrans,
      quantTrans,
      schemaName
    };
  }

  getNodeQuery(pMap = {}) {
    const service_item = pMap.service_item;
    const qParam = pMap.qParam;
    const query = {
      where: {
        station: this.stationId,
        [qParam]: { '>': 0 }
      }
    };
    if (service_item) {
      query.or = [{ [service_item]: null }, { [service_item]: false }];
    }
    return query;
  }

  findNodes(schema, pMap) {
    const query = this.getNodeQuery(pMap);
    return Node.findNodes(query, schema);
  }

  getHeader(schema, pMap) {
    const nMap = this.getNameMap(pMap, schema);
    return [nMap.descTrans, nMap.skuTrans, nMap.quantTrans];
  }

  async getBody(schema, pMap) {
    const nodes = await this.findNodes(schema, pMap);
    return nodes.map(node => [node[pMap.descParam], node[pMap.skuParam], '']);
  }

  get qrBlock() {
    return {
      width: 'auto',
      qr: this.st.scannable_id,
      fit: 70,
      alignment: 'right',
      margin: [0, -20, 5, 0]
    };
  }

  getTitleBlock(schema, isFirstPage = true) {
    const schemaName = schema.title || schema.name;
    const [title] = Pdf.Components.basic.column([
      {
        width: '90%',
        margin: [0, 25, 0, 0],
        columns: [
          Pdf.Components.basic.section(
            `${this.varCache.inventory_list_items ||
              'Inventory count list for'} ${schemaName} - ${this.stationName}`,
            {
              border: false
            }
          )
        ]
      },
      isFirstPage ? this.qrBlock : {}
    ]);
    return title;
  }

  getInventoryListBlock(schema) {
    const schemaName = schema.title || schema.name;
    return Pdf.Components.basic.section(
      `${this.varCache.inventory_list_items ||
        'Inventory count list for'} ${schemaName} - ${this.stationName}`,
      {
        bold: false,
        border: false,
        margin: [0, 20, 0, 0]
      }
    );
  }

  buildTableBlock(header, body) {
    return Pdf.Components.basic.basicTable(header, body, {
      autoHeader: true,
      layout: 'lightHorizontalLines'
    });
  }

  get variantBlock() {
    return Pdf.Components.basic.section(
      `${this.varCache['labels.VARIANT_ITEMS'] || 'Variant Items'}`,
      { border: false, margin: [0, 20, 0, 0] }
    );
  }

  get getDateBlock() {
    return Pdf.Components.basic.section(`${this.startDate} - ${this.endDate}`, {
      border: false,
      margin: [0, 0, 0, 10]
    });
  }

  logParams(nodeschema) {
    const helpers = this.paramHelp;
    return helpers.logParams(nodeschema.schema);
  }

  async setNotCountedValues(schema, isFirstPage = true) {
    const pMap = this.getParamMap(this.logParams(schema));
    const header = this.getHeader(schema, pMap);
    const body = await this.getBody(schema, pMap);
    const title = this.getTitleBlock(schema, isFirstPage);
    const table = this.buildTableBlock(header, body);
    this.content.push(...[title, table]);
  }

  get variantFileName() {
    return this.varCache.inventory_variance_doc_name || 'Variance Report';
  }

  get firstPageStatusBody() {
    return [
      {
        width: '*',
        stack: [
          // second column consists of paragraphs
          {
            text: `${this.varCache['labels.VARIANCE_TOTAL'] ||
              'Variance total'}`,
            bold: true
          },
          {
            text: `${this.currency} ${Utils.fixValue(
              this.st.variance,
              false,
              2
            )}`,
            style: ['brandHighlight']
          },
          {
            text: `${this.varCache['labels.APPROVED_BY'] || 'Approved by'}`,
            bold: true
          },
          {
            text: `${(this.st.approved_by || {}).first_name || ''} ${(
              this.st.approved_by || {}
            ).last_name || ''}`,
            style: ['brandHighlight']
          },
          {
            text: `${this.varCache['labels.APPROVED_ON'] || 'Approved on'}`,
            bold: true
          },
          {
            /* [sg] text: `${moment(st.snapshot.reconciled_time).tz(tz).format("LL")}`, */
            text: `${TimeUtils.formattedDate(
              this.st.snapshot.reconciled_time,
              Formats.Date.full
            )}`,
            style: ['brandHighlight']
          }
        ]
      },
      {
        width: '*',
        stack: [
          // second column consists of paragraphs
          {
            text: `${this.varCache['labels.STATUS'] || 'Status'}`,
            bold: true
          },
          {
            text: this.st.reconciled
              ? this.varCache['labels.RECONCILED'] || 'Reconciled'
              : this.varCache['labels.AWAITING_RECONCILIATION'] ||
                'Waiting for reconcilation',
            style: ['brandHighlight']
          }
        ]
      }
    ];
  }

  get getReconcidedStatusBody() {
    return {
      width: '*',
      stack: [
        {
          text: `${this.varCache['labels.TOTAL_TIME'] || 'Total time'}`,
          bold: true
        },
        {
          text: TimeUtils.timeFormatFromSeconds(
            this.st.snapshot.total_time / 1000
          ),
          style: ['brandHighlight']
        },
        {
          layout: 'noBorders',
          table: {
            // headers are automatically repeated if the table spans over multiple pages
            // you can declare how many rows should be treated as headers
            headerRows: 1,
            widths: ['*'],
            // ${(this.varCache['labels.LAST_NAME'] || 'Last name')}
            body: [
              [`${this.varCache['labels.CONTRIBUTORS'] || 'Contributors'}`],
              ..._.map(this.st.contributors, c => [
                `${c.first_name} ${c.last_name}`
              ])
            ]
          }
        }
      ]
    };
  }

  getVariantTableBlock(schema) {
    const sc = this.schemaSc[this.getId(schema)] || [];
    const table = Pdf.Components.basic.basicTable(
      [
        `${this.varCache['labels.ITEM_NAME'] || 'Name'}`,
        `${this.varCache['labels.ITEM_SKU'] || 'SKU'}`,
        `${this.varCache['labels.ITEM_QUANTITY'] || 'Quantity'}`,
        `${this.varCache['labels.ITEM_VARIANCE'] || 'Variance'}`,
        `${this.varCache['labels.ITEM_TOTAL_VALUE'] || 'Total Value'}`
      ],
      sc.map(c => [
        c.item_name,
        c.sku,
        c.count,
        c.delta,
        `${this.currency} ${CostCode.parseValue(
          parseInt(c.delta_cost || 0),
          this.currency
        )}`
      ]),
      {
        autoHeader: true
      }
    );

    return table;
  }

  async setCountedValues(schema, isFirstPage = true) {
    const statusBody = [];
    if (isFirstPage) {
      //   this.content.push(listBlock);
      this.content.push(this.getDateBlock);
      statusBody.push(...this.firstPageStatusBody);
    }

    if (this.reconciled && isFirstPage) {
      statusBody.push(this.getReconcidedStatusBody);
    }
    if (statusBody.length) {
      this.content.push(Pdf.Components.basic.column(statusBody));
    }

    const listBlock = this.getInventoryListBlock(schema);
    this.content.push(listBlock);
    this.content.push(this.variantBlock);
    const table = this.getVariantTableBlock(schema);
    this.content.push(table);
  }

  async iterateSchema() {
    for (let i = 0; i < this.schemas.length; i++) {
      const schema = this.schemas[i];
      const firstPage = i === 0;
      if (!this.st.counted) {
        await this.setNotCountedValues(schema, firstPage);
      } else {
        await this.setCountedValues(schema, firstPage);
      }
    }
  }

  getPdfImagePath() {
    const fallBack = `${sails.config.__parentDir}/assets/images/logo.png`;
    const pdfImage = this.config.logos.navbar || fallBack;
    return PdfHelper.generateImageBase64(pdfImage);
  }

  async buildPDFDoc() {
    const content = { content: this.content };
    const image = await this.getPdfImagePath();
    const layout = Pdf.Layouts.stocktake(
      image,
      this.config.site_name,
      this.head
    );
    const pdfDoc = await Pdf.Helper.print(content, layout, PdfHelper.fonts);
    return pdfDoc;
  }

  async build() {
    await this.appyVariaibleCache();
    await this.applySchemaGroups();
    await this.iterateSchema();
    const pdfDoc = await this.buildPDFDoc();
    return pdfDoc;
  }
}

module.exports = { StocktakePDF };
