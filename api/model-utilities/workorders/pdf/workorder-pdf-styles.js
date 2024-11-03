const { Pdf } = require('similie-api-services');
class PDFStyles {
  constructor(workorder = {}, pdfProcess) {
    this.workorder = workorder;
    this.pdfProcess = pdfProcess;
  }

  static get styleFonts() {
    // Define font files
    const fonts = {
      Roboto: {
        normal:
          'node_modules/similie-styles/src/fonts/Roboto/Roboto-Regular.ttf',
        bold: 'node_modules/similie-styles/src/fonts/Roboto/Roboto-Medium.ttf',
        italics:
          'node_modules/similie-styles/src/fonts/Roboto/Roboto-Italic.ttf',
        bolditalics:
          'node_modules/similie-styles/src/fonts/Roboto/Roboto-MediumItalic.ttf'
      }
    };
    return fonts;
  }

  get toStation() {
    return this.process.toStation;
  }

  get facilityManager() {
    return this.pdfProcess.facilityManagerName;
  }

  get requestManager() {
    return this.pdfProcess.requestManagerName;
  }

  get meta() {
    return this.workorder.meta || {};
  }

  get items() {
    return this.workorder.items || [];
  }

  get qrcode() {
    return this.pdfProcess.qrcode;
  }

  get pdfProcess() {
    return this._pdf;
  }

  set pdfProcess(pdf) {
    this._pdf = pdf;
  }

  get workorder() {
    return this._workorder;
  }

  set workorder(workorder) {
    this._workorder = workorder;
  }

  get fonts() {
    return PDFStyles.styleFonts;
  }

  get commonStyles() {
    return {
      invoiceTitle: {
        fontSize: 22,
        bold: true,
        alignment: 'right',
        margin: [0, 0, 0, 15]
      },
      title: {
        fontSize: 22,
        bold: true
      },
      // Invoice Details
      woSubTitle: {
        fontSize: 12,
        margin: [0, 0, 0, 15],
        color: '#ccc',

        bold: true,
        width: 200
      },
      woItemTitle: {
        fontSize: 12,

        color: '#ccc',

        bold: true
      },
      woSubValue: {
        fontSize: 12
      },
      invoiceSubTitle: {
        fontSize: 12,
        alignment: 'right',
        bold: true,
        color: 'red'
      },
      horLine: {
        fontSize: 22,
        alignment: 'right',
        bold: true,
        color: '#ccc'
      },
      table: {
        color: '#ccc'
      },
      invoiceSubValue: {
        fontSize: 12,
        alignment: 'right'
      },
      // Billing Headers
      invoiceBillingTitle: {
        fontSize: 14,
        bold: true,
        alignment: 'left',
        margin: [0, 20, 0, 5]
      },
      // Billing Details
      invoiceBillingDetails: {
        alignment: 'left'
      },
      invoiceBillingAddressTitle: {
        margin: [0, 7, 0, 3],
        bold: true
      },
      invoiceBillingAddress: {},
      // Items Header
      itemsHeader: {
        margin: [0, 5, 0, 5],
        bold: true
      },
      // Item Title
      itemTitle: {
        bold: true
      },
      itemSubTitle: {
        italics: true,
        fontSize: 11
      },
      itemNumber: {
        margin: [0, 10, 0, 10],
        alignment: 'center'
      },
      itemTotal: {
        margin: [0, 5, 0, 5],
        bold: true,
        alignment: 'center'
      },

      // Items Footer (Subtotal, Total, Tax, etc)
      itemsFooterSubTitle: {
        margin: [0, 5, 0, 5],
        bold: true,
        alignment: 'right'
      },
      itemsFooterSubValue: {
        margin: [0, 5, 0, 5],
        bold: true,
        alignment: 'center'
      },
      itemsFooterTotalTitle: {
        margin: [0, 5, 0, 5],
        bold: true,
        alignment: 'right'
      },
      itemsFooterTotalValue: {
        margin: [0, 5, 0, 5],
        bold: true,
        alignment: 'center'
      },
      signaturePlaceholder: {
        margin: [0, 70, 0, 0]
      },
      signatureName: {
        bold: true,
        alignment: 'center'
      },
      signatureJobTitle: {
        italics: true,
        fontSize: 10,
        alignment: 'center'
      },
      notesTitle: {
        fontSize: 10,
        bold: true,
        margin: [0, 50, 0, 3]
      },
      notesText: {
        fontSize: 10
      },
      center: {
        alignment: 'center'
      }
    };
  }

  async iterateItems(cb) {
    for (let i = 0; i < this.items.length; i++) {
      await cb(this.items[i]);
    }
  }

  calculateItemWidth() {
    if (!this.items.length) {
      return 30;
    }
    return 30 / this.items.length;
  }

  generatePdf() {
    return Pdf.Helper.print(this.content, Pdf.Layouts.basic, this.fonts);
  }
}

module.exports = { PDFStyles };
