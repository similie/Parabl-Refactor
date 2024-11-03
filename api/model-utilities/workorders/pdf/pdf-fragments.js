const { CommonUtils } = require('similie-api-services');
const { Pdf } = require('similie-api-services');
const { PDFStyles } = require('./workorder-pdf-styles');

const throwError = true;
/**
 * @throws Do not use. This is not functional or tested code
 * @description [AS] maintaining this code to provide an example for when
 *   we revisit PDF generation in WO
 * @todo: strip out a refactor when PDF generation is revisited
 * @param {*} workorder_id
 * @param {*} res
 * @returns {pdfBinary}
 */
async function workorderPdfFragment(workorder_id, res) {
  if (throwError) {
    throw new Error('Do not use. This is not functional or tested code');
  }

  let config;
  const workorder_q = await WorkOrder.find({
    id: workorder_id
  }).populate('tasks');
  const workorder = workorder_q[0];

  if (res) {
    config = await Site.thisSiteAsync(res.locals.domain);
  } else {
    const station = await Station.findOne({
      station_id: workorder.service_station
    });

    const stationType = StationSchema.findOneById(
      StationSchema.getId(station.station_type)
    );
    const dId = Domain.getId(stationType.domain);
    config = await Site.thisSiteAsync(dId);
  }

  const logo = config.logos.navbar;
  const imagePath = _.contains(logo, 'http')
    ? logo
    : `${sails.config.__parentDir}/assets${logo}`;
  const bslogo = await CommonUtils.imaging.encodeImage(imagePath);

  const bs64logo = 'data:image/png;base64,' + bslogo;
  let station_manager_name = 'No manager';

  const to_station = await Station.findOne({
    station_id: workorder.service_station
  });
  if (to_station) {
    const to_requisitions = await Requisition.find({
      role: Roles.MANAGER,
      station: to_station.id
    }).populate('user');

    const station_manager = (to_requisitions[0] || {}).user;
    if (station_manager) {
      station_manager_name =
        station_manager.first_name + ' ' + station_manager.last_name;
    }
  }

  let activities = ['\n'];
  const watchers = [];
  const wo_watchers = workorder.watchers || [];
  const wo_tasks = workorder.tasks || [];

  for (let l = 0; l < wo_watchers.length; l++) {
    const user = wo_watchers[l];

    watchers.push({
      text: user.first_name + ' ' + user.last_name,
      style: 'woSubValue'
    });
  }

  if (!workorder.meta.nodeserial) {
    return;
  }
  const [item] = workorder.items;
  const serial = workorder.meta.nodeserial[item.sku].scan;
  const serial_name = workorder.meta.nodeserial[item.sku].param_name;

  for (let i = 0; i < wo_tasks.length; i++) {
    const activity = wo_tasks[i];
    const parts = ['\n'];

    for (let k = 0; k < (activity.parts || []).length; k++) {
      const part = activity.parts[k];
      parts.push({
        text: '• ' + part,
        style: 'woSubValue'
      });
    }

    if (!parts.length) {
      parts.push({
        text: '',
        style: 'woSubValue'
      });
    }

    activities.push({
      text: activity.name,
      style: 'invoiceBillingTitle',
      fontSize: 12,
      color: 'black'
    });

    const steps = ['\n'];

    activities = [
      ...activities,
      ...[
        {
          columns: [
            {
              text: 'Activity Type',
              style: 'woSubTitle',
              width: '30%'
            },
            {
              text: activity.type,
              style: 'woSubValue',
              width: '*'
            }
          ]
        },
        {
          columns: [
            {
              text: 'Template',
              style: 'woSubTitle',
              width: '30%'
            },
            {
              text: activity.name,
              style: 'woSubValue',
              width: '*'
            }
          ]
        },
        {
          columns: [
            {
              text: 'EST Time',
              style: 'woSubTitle',
              width: '30%'
            },
            {
              text: activity.hours + ' Hours' + activity.minutes + ' Minutes',
              style: 'woSubValue',
              width: '*'
            }
          ]
        },
        '\n',

        {
          columns: [
            {
              text: 'Parts Needed',
              style: 'woSubTitle',
              width: '30%'
            },
            [...parts]
          ]
        },
        '\n'
      ]
    ];

    const activity_steps = activity.steps || [];

    for (let j = 0; j < activity_steps.length; j++) {
      steps.push({
        text: '• ' + activity_steps[j].name,
        style: 'woSubValue'
      });
    }

    activities = [
      ...activities,
      {
        columns: [
          {
            text: '',
            style: 'woSubTitle',
            width: '30%'
          },

          [...steps]
        ]
      },

      {
        columns: [
          {
            text: 'Notes',
            style: 'woSubTitle',
            width: '30%'
          },
          {
            text: workorder.notes,
            style: 'woSubValue',
            width: '*'
          }
        ]
      },
      {
        columns: [
          {
            text: 'Notes',
            style: 'woSubTitle',
            width: '30%'
          },
          {
            table: {
              widths: [200, 100],

              body: [
                [
                  {
                    text: '  ',
                    border: [true, true, false, false],
                    margin: [0, 10, 0, 10]
                  },
                  {
                    text: '   ',
                    border: [false, true, true, false],
                    margin: [0, 5, 0, 5]
                  }
                ],
                [
                  {
                    text: '  ',
                    border: [true, false, false, true],
                    margin: [0, 5, 0, 5]
                  },
                  {
                    text: '  ',
                    border: [false, false, true, true],
                    margin: [0, 5, 0, 5]
                  }
                ]
              ]
            }
          }
        ]
      },

      '\n\n',

      {
        columns: [
          {
            text: 'Parts Used',
            style: 'woSubTitle',
            width: '30%'
          },
          {
            table: {
              // headers are automatically repeated if the table spans over multiple pages
              // you can declare how many rows should be treated as headers
              headerRows: 1,
              widths: ['auto', 40, '*'],

              body: [
                // Table Header
                [
                  {
                    text: 'Quantity',
                    style: 'itemsHeader'
                  },
                  {
                    text: 'SKU',
                    style: ['itemsHeader', 'center']
                  },
                  {
                    text: 'Description',
                    style: ['itemsHeader', 'center']
                  }
                ],
                // Items
                // Item 1
                [
                  {
                    text: '',
                    style: 'itemTitle'
                  },

                  {
                    text: '',
                    style: 'itemNumber'
                  },
                  {
                    text: '',
                    style: 'itemNumber'
                  }
                ],
                [
                  {
                    text: '',
                    style: 'itemTitle'
                  },

                  {
                    text: '',
                    style: 'itemNumber'
                  },
                  {
                    text: '',
                    style: 'itemNumber'
                  }
                ],
                [
                  {
                    text: '',
                    style: 'itemTitle'
                  },

                  {
                    text: '',
                    style: 'itemNumber'
                  },
                  {
                    text: '',
                    style: 'itemNumber'
                  }
                ]

                // END Items
              ]
            }
          }
        ]
      },
      '\n\n',

      {
        columns: [
          {
            text: 'EST TIME',
            style: 'woSubTitle',
            width: '30%'
          },

          {
            columns: [
              {
                table: {
                  widths: [80],

                  body: [
                    [
                      {
                        text: ' ',
                        border: [true, true, true, true],
                        margin: [0, 5, 0, 5]
                      }
                    ]
                  ]
                }
              },
              {
                text: 'Hours',
                style: 'woSubTitle',
                width: '20%'
              },
              {
                table: {
                  widths: [80],

                  body: [
                    [
                      {
                        text: ' ',
                        border: [true, true, true, true],
                        margin: [0, 5, 0, 5]
                      }
                    ]
                  ]
                }
              },
              {
                text: 'Minutes',
                style: 'woSubTitle',
                width: '20%'
              }
            ]
          }
        ]
      }
    ];
  }

  // const item = workorder.items[0];

  const meta = workorder.meta || {};

  const pdfContent = {
    content: [
      // Header
      {
        columns: [
          {
            image: bs64logo,
            width: 150
          },

          [
            {
              text: 'Work Order',
              style: 'invoiceTitle',
              width: '*'
            },
            {
              stack: [
                {
                  text: 'Internal use Only',
                  style: 'invoiceSubTitle',
                  width: '*'
                }
              ]
            }
          ]
        ]
      },
      {
        text: workorder.name,
        style: 'invoiceBillingTitle',
        width: '*'
      },

      {
        stack: [
          {
            columns: [
              {
                text: 'Scheduled on',
                style: 'woSubTitle',
                width: '30%'
              },
              {
                text: meta.scheduled_start,
                style: 'woSubValue',
                width: '*'
              }
            ]
          },
          {
            columns: [
              {
                text: 'Manager Name',
                style: 'woSubTitle',
                width: '30%'
              },
              {
                text: station_manager_name,
                style: 'woSubValue',
                width: '*'
              }
            ]
          },

          {
            columns: [
              {
                text: 'Assigned To',
                style: 'woSubTitle',
                width: '30%'
              },
              [...watchers]
            ]
          },

          '\n',
          {
            columns: [
              {
                text: 'Name',
                style: 'woItemTitle',
                width: '30%'
              },
              {
                text: item.description,
                style: 'woSubValue'
              }
            ]
          },
          {
            columns: [
              {
                text: 'SKU',
                style: 'woItemTitle',
                width: '30%'
              },
              {
                text: item.sku,
                style: 'woSubValue',
                width: '30%'
              }
            ]
          },
          {
            columns: [
              {
                text: 'Year',
                style: 'woItemTitle',
                width: '30%'
              },
              {
                text: item.year,
                style: 'woSubValue',
                width: '*'
              }
            ]
          },

          {
            columns: [
              {
                text: serial_name,
                style: 'woSubTitle',
                width: '30%'
              },
              {
                text: serial,
                style: 'woSubValue'
              }
            ]
          }
        ]
      },

      {
        text: '___________________________________________________',
        style: 'horLine',
        width: '*'
      },

      {
        text: 'Activities',
        style: 'invoiceBillingTitle',
        fontSize: 16
      },
      '\n',

      ...activities
    ],
    styles: {
      // Invoice Title
      invoiceTitle: {
        fontSize: 22,
        bold: true,
        alignment: 'right',
        margin: [0, 0, 0, 15]
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
    },
    defaultStyle: {
      columnGap: 20
    }
  };

  const generated = await Pdf.Helper.print(
    pdfContent,
    Pdf.Layouts.basic,
    PDFStyles.styleFonts
  );

  return generated;
}

module.exports = { workorderPdfFragment };
