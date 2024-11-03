const { PDFStyles } = require('./workorder-pdf-styles');
const { WOProcessModel } = require('../workorder-process-model');

class WorkOrderPDF {
  constructor(workorder = {}) {
    this.workorder = workorder;
    this.process = new WOProcessModel(workorder);
    this.requestStyles = new PDFWORequestStyle(workorder, this.process);
    this.woStyles = new PDFWOStyles(workorder, this.process);
  }

  get process() {
    return this._process;
  }

  set process(process) {
    this._process = process;
  }

  get workorder() {
    return this._workorder;
  }

  set workorder(workorder) {
    this._workorder = workorder;
  }

  get requestStyles() {
    return this._requestStyles;
  }

  set requestStyles(requestStyles) {
    this._requestStyles = requestStyles;
  }

  get woStyles() {
    return this._woStyles;
  }

  set woStyles(woStyles) {
    this._woStyles = woStyles;
  }

  async downloadWOPdf(domain = undefined) {
    // do it
    await this.process.pullSiteLogo(domain);
    await this.process.getFacilityManagerName();
    await this.process.getRequestManagerName();
    await this.requestStyles.pullVariables();
  }

  async downloadWORequestPdf() {
    await this.process.buildQRCode();
    await this.process.getFacilityManagerName();
    await this.process.getRequestManagerName();
    await this.requestStyles.pullVariables();
    const generated = await this.requestStyles.generatePdf();
    return generated;
  }
}

class PDFWOStyles extends PDFStyles {
  constructor(workorder = {}, pdfProcess) {
    super(workorder, pdfProcess);
  }

  async pullVariables() {
    // we need the translatons
  }
}

class PDFWORequestStyle extends PDFStyles {
  constructor(workorder = {}, pdfProcess) {
    super(workorder, pdfProcess);
  }

  async pullVariables() {
    // we need the translatons
  }

  get itemWoSubTitle() {
    const buildItems = [];
    const width = this.calculateItemWidth();
    this.iterateItems(item => {
      buildItems.push({
        text: 'Model',
        style: 'woSubTitle',
        width: `${width}%`
      });
      buildItems.push({
        text: item.model || this.meta.item_serial || '',
        style: 'woSubValue'
      });
    });
    return buildItems;
  }

  get itemDescription() {
    const buildItems = [];
    const width = this.calculateItemWidth();
    this.iterateItems(item => {
      buildItems.push({
        text: 'Name',
        style: 'woItemTitle',
        width: `${width}%`
      });
      buildItems.push({
        text: item.description,
        style: 'woSubValue'
      });
    });
    return buildItems;
  }

  get content() {
    return {
      content: [
        {
          text: 'Work Order',
          style: 'title',
          width: '*'
        },
        {
          text: '___________________________________________________',
          style: 'horLine',
          width: '*'
        },
        '\n',

        {
          stack: [
            {
              columns: [
                {
                  text: 'Id',
                  style: 'woSubTitle',
                  width: '30%'
                },
                {
                  text: this.workorder.workorder_id,
                  style: 'woSubValue',
                  width: '*'
                }
              ]
            },
            {
              columns: [
                {
                  text: '',
                  style: 'woSubTitle',
                  width: '30%'
                },
                {
                  image: this.qrcode,
                  width: 100
                }
              ]
            },
            {
              columns: [
                {
                  text: 'Status',
                  style: 'woSubTitle',
                  width: '30%'
                },
                {
                  text: this.workorder.state,
                  style: 'woSubValue',
                  width: '*'
                }
              ]
            },
            {
              columns: [
                {
                  text: 'Message',
                  style: 'woSubTitle',
                  width: '30%'
                },
                {
                  text: this.workorder.notes,
                  style: 'woSubValue',
                  width: '*'
                }
              ]
            },

            {
              columns: [
                {
                  text: 'Schedule',
                  style: 'woSubTitle',
                  width: '30%'
                },
                [
                  {
                    text: 'Start: ' + this.meta.scheduled_start || 'Not set',
                    style: 'woSubValue'
                  },
                  {
                    text: 'Finish: ' + this.meta.scheduled_end || 'Not set',
                    style: 'woSubValue'
                  }
                ]
              ]
            },

            '\n'
          ]
        },

        {
          text: 'Asset Information',
          style: 'invoiceBillingTitle'
        },
        '\n',

        {
          columns: this.itemDescription
        },
        // {
        //   columns: [
        //     {
        //       text: serial_name,
        //       style: 'woItemTitle',
        //       width: '30%'
        //     },
        //     {
        //       text: serial,
        //       style: 'woSubValue',
        //       width: '30%'
        //     }
        //   ]
        // },
        // {
        //   columns: [
        //     {
        //       text: 'Year',
        //       style: 'woItemTitle',
        //       width: '30%'
        //     },
        //     {
        //       text: item.year || '',
        //       style: 'woSubValue',
        //       width: '*'
        //     }
        //   ]
        // },

        {
          columns: this.itemWoSubTitle
        },
        {
          text: 'Service Station Info',
          style: 'invoiceBillingTitle'
        },
        {
          columns: [
            {
              text: 'Manager',
              style: 'woSubTitle',
              width: '30%'
            },
            {
              text: this.facilityManager,
              style: 'woSubValue',
              width: '*'
            }
          ]
        },
        {
          columns: [
            {
              text: 'Station Id',
              style: 'woSubTitle',
              width: '30%'
            },
            {
              text: this.workorder.service_station || 'Not set',
              style: 'woSubValue',
              width: '*'
            }
          ]
        },

        {
          text: 'Requesting Station Info',
          style: 'invoiceBillingTitle'
        },
        {
          columns: [
            {
              text: 'Manager',
              style: 'woSubTitle',
              width: '30%'
            },
            {
              text: this.requestManager,
              style: 'woSubValue',
              width: '*'
            }
          ]
        },

        {
          columns: [
            {
              text: 'Station Id',
              style: 'woSubTitle',
              width: '30%'
            },
            {
              text: this.workorder.from,
              style: 'woSubValue',
              width: '*'
            }
          ]
        }
      ],
      styles: {
        ...this.commonStyles
      }
    };
  }
}

module.exports = { WorkOrderPDF };
