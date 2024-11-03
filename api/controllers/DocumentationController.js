/**
 * DocumentationController
 *
 * @description :: Server-side actions for handling incoming requests.
 * @help        :: See https://sailsjs.com/docs/concepts/actions
 */

const { SqlUtils } = require('similie-api-services');

module.exports = {
  tips: async function(req, res) {
    const params = req.params.all();
    const language = Translates.getLanguage(req, res);
    const start_tag = `<!--${params.tip}-->`;
    const end_tag = `<!--END_${params.tip}-->`;
    const full_tag = `${start_tag}(.*?)${end_tag}`;
    const escape = SqlUtils.escapeUtil();
    const query = escape(
      `
    SELECT SUBSTRING
    ( "text"->>'${language}' FROM %L ) as "tip",
    "title"->>'${language}' as "title",
    "id" as "id",
    "role" as "role"
FROM
	documentation 
WHERE
	"text"->>'${language}' LIKE '%%%s%%'
	AND "text"->>'${language}' LIKE '%%%s%%' 
ORDER BY
	"id" ASC, "weight" ASC`,
      full_tag,
      start_tag,
      end_tag
    );
    const results = await Documentation.queryAsync(query);
    res.send(results.rows);
  }
};
