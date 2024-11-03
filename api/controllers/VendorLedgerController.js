/**
 * VendorLedgerController
 *
 * @description :: Server-side actions for handling incoming requests.
 * @help        :: See https://sailsjs.com/docs/concepts/actions
 */
const { SqlUtils } = require('similie-api-services');

module.exports = {
  simplify: async function(req, res) {
    const params = req.params.all();
    if (!params.sku) {
      return res.badRequest({ error: 'Sku required' });
    }

    const send = {
      sku: params.sku
    };
    const excape = SqlUtils.escapeUtil();

    const query = excape(
      `SELECT
      vl.sku,
      vl.externalvendor,
      ev.company_name,
      ev.contact_name,
      ev.contact_number,
      ev.contact_email,
      ev.contact_details,
      SUM ( vl.quantity ) as quantity
    FROM
      vendorledger vl
      LEFT JOIN externalvendor ev
    ON
      ( vl.externalvendor = ev.ID )
    WHERE
      vl.sku = %L
    GROUP BY
      1,
      2,
      3,
      4,
      5,
      6,
      7
    ORDER BY
      quantity DESC `,
      params.sku
    );

    const results = await VendorLedger.queryAsync(query);
    send.vendors = results.rows;
    return res.send(send);
  }
};
