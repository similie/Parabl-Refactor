const { SqlUtils } = require('similie-api-services');
/**
 * DomainRole.js
 *
 * @description :: A model definition.  Represents a database table/collection/etc.
 * @docs        :: https://sailsjs.com/docs/concepts/models-and-orm/models
 */

module.exports = {
  attributes: {
    user: {
      model: 'user'
    },

    domain: {
      model: 'domain'
    },

    role: {
      type: 'integer',
      min: Roles.ANONYMOUS,
      max: Roles.SIMILIE_ADMIN,
      defaultsTo: Roles.DEFAULT
    }

    //  ╔═╗╦═╗╦╔╦╗╦╔╦╗╦╦  ╦╔═╗╔═╗
    //  ╠═╝╠╦╝║║║║║ ║ ║╚╗╔╝║╣ ╚═╗
    //  ╩  ╩╚═╩╩ ╩╩ ╩ ╩ ╚╝ ╚═╝╚═╝

    //  ╔═╗╔╦╗╔╗ ╔═╗╔╦╗╔═╗
    //  ║╣ ║║║╠╩╗║╣  ║║╚═╗
    //  ╚═╝╩ ╩╚═╝╚═╝═╩╝╚═╝

    //  ╔═╗╔═╗╔═╗╔═╗╔═╗╦╔═╗╔╦╗╦╔═╗╔╗╔╔═╗
    //  ╠═╣╚═╗╚═╗║ ║║  ║╠═╣ ║ ║║ ║║║║╚═╗
    //  ╩ ╩╚═╝╚═╝╚═╝╚═╝╩╩ ╩ ╩ ╩╚═╝╝╚╝╚═╝
  },

  applyDomainIntegrationQuery: function(params, exclusive = true) {
    const query = User.generateNameSearchQuery(params).replaceAll(';', '');
    const escape = SqlUtils.escapeUtil();
    const domain = params.id;
    let domainWhere = ``;
    if (!domain || domain == null || domain === 'null') {
      domainWhere = `(("dr"."domain" `;
      domainWhere += `IS ${
        exclusive ? 'NOT ' : ''
      }NULL OR "user"."site_role" IS NULL) AND "user"."id" NOT IN ( (SELECT "user" FROM "domainrole" WHERE "domain" IS NULL )) )`;
    } else {
      domainWhere = '(COALESCE("dr"."domain", -1)';
      domainWhere += escape(
        `${
          exclusive ? 'NOT ' : ''
        }IN(%s)) AND "user"."id" NOT IN ( (SELECT "user" FROM "domainrole" WHERE "domain" = %s ) )`,
        domain,
        domain
      );
    }

    return `SELECT "user".* FROM (${query}) "user" LEFT JOIN "domainrole" "dr" ON ("dr"."user" = "user"."id")
    WHERE ${domainWhere} AND "user"."schema" IS NULL 
    AND ("user"."site_role" < ${Roles.DOMAIN_ADMIN} OR "user"."site_role" IS NULL)
    ORDER BY "user"._full_name LIMIT 50;`;
  },

  externalDomainMembers: async function(params) {
    const query = this.applyDomainIntegrationQuery(params);
    const results = await this.queryAsync(query);
    const ids = {};
    return results.rows.filter(row => {
      if (ids[row.id]) {
        return false;
      }
      ids[row.id] = true;
      return true;
    });
  },

  domainRoleUserCount: async function(criteria) {
    const where = SqlUtils.buildWhereString(criteria);
    const escape = SqlUtils.escapeUtil();
    const query = escape(
      `SELECT COUNT
    ( "dr"."id" ) 
  FROM
    ( SELECT * FROM "domainrole" WHERE %s ) "dr"
    JOIN "user" "u" ON ( "u"."id" = "dr"."user" )`,
      where
    );
    const results = await DomainRole.queryAsync(query);
    const result = results.rows.pop();
    return result.count || 0;
  }
};
