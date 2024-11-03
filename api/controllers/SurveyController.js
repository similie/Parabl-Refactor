/**
 * SurveyController
 *
 * @description :: Server-side actions for handling incoming requests.
 * @help        :: See https://sailsjs.com/docs/concepts/actions
 */

module.exports = {
  /*
   * these are functions for supporting the
   * the chatbot surveys
   */

  /*
   * This route supports an active call by the device from the domain
   * It is used for the chat bots to have all active domain-level surveys that are published
   * with the addition of the variables required for chatbot translations.
   */
  active: async function(_req, res) {
    const domain =
      res.locals.domain || (res.locals.device || {}).domain || null;
    const query = pullActiveSchemas(domain);
    const site = await Site.thisSiteAsync(domain);

    const results = await Model.queryAsync(query);
    const surveys = results.rows;
    if (!_.size(surveys)) {
      return res.send({});
    }
    const translates = Translates.translateIdentity;
    const chatbotVars = 'chatbot_variables';
    const variableKeys = [chatbotVars];

    let variables = [];
    _.each(site.language_labels, l => {
      variables.push(l);
    });

    const surveyCache = {};

    for (let i = 0; i < _.size(surveys); i++) {
      const survey = surveys[i];

      Node.filterSchema(survey);

      surveyCache[survey.name] = surveyCache[survey.name] || {
        ...survey
      };
      delete surveyCache[survey.name].station;
      delete surveyCache[survey.name].required_user_details;
      delete surveyCache[survey.name].primary;
      surveyCache[survey.name].stations =
        surveyCache[survey.name].stations || [];
      // now push the station specific details
      surveyCache[survey.name].stations.push({
        station: survey.station,
        details: survey.required_user_details,
        primary: survey.primary
      });

      variables.push(survey.title);
      for (let j = 0; j < _.size(survey.schema); j++) {
        const param = survey.schema[j];
        variables.push(param.label);
        if (param.type === 'variable') {
          variableKeys.push(param.name);
        }
      }
    }
    variables = _.uniq(variables);
    const variablesQuery = {
      where: {
        or: [{ key: variableKeys }, { key: translates, identity: variables }]
      },
      sort: {
        order: 'DESC'
      }
    };
    const vars = await Variable.find(variablesQuery);
    const varCache = {
      [translates]: {}
    };

    _.each(variableKeys, v => {
      varCache[v] = {};
    });

    for (let i = 0; i < _.size(vars); i++) {
      const v = vars[i];
      varCache[v.key][v.identity] = v.value;
      varCache[v.key][v.identity].__id__ = v.id; // a language value would never take this form
    }

    const personas = await User.personas(domain);
    const images = site.logos || {};

    const output = {
      variables: varCache,
      surveys: surveyCache,
      languages: site.languages,
      language_labels: site.language_labels,
      default_language: site.default_language,
      images: {
        banner: images.oracle_intro_banner || null
      },
      integrations: {
        open_ai: (site.integrations || {}).open_ai || null,
        user_schema: (site.integrations || {}).public_user_schema || null
      },
      personas: personas
    };

    return res.send(output);
  },
  deliver: async function(req, res) {
    if (req.method !== 'POST') {
      return res.badRequest({ errors: 'Invalid method' });
    }
    // only one, take station,
    // many, take closest if it's has geo data,
    // many, no geo, add primary attribute from ns,
    // many, no primary, take a global or the first
    const params = req.params.all();
    /*
    survey: 'chatbot_survey',
    responses: 
     { poison: 3179,
       emergency_type: { flash_flood: true },
       people_impacted: { twentyone_to_fifty: true },
       hh_impacted: { eleven_to_twenty: true },
       concern_situation: { a_little_concerned: true },
       color: 3182,
       files: [ 308 ] },
      */
    //
    const user = await User.contentDomainUser(req, res);
    const node_name = params.survey;
    const node_id = params.schema;
    const device = res.locals.device || {};
    const domain = res.locals.domain || device.domain || null;
    const responses = params.responses[node_name];
    const schema = await NodeSchema.findOneById(node_id);
    responses.observer = User.getId(user);
    responses.domain = Domain.getId(domain);
    responses.schema = node_id;

    try {
      const station = await Station.triangulate(
        (params.meta || {}).stations || [],
        responses.point
      );
      responses.station = await Station.getId(station);
      const created = await Node.create(responses, req, res);
      Node.blast(created, schema, 'created');
      res.send(created);
    } catch (e) {
      res.serverError({ error: e });
    }
  }
};

function pullActiveSchemas(domain) {
  let domainTexts = `IS NULL `;
  if (domain) {
    domainTexts = ` = ${Domain.getId(domain)} `;
  }

  return `SELECT
  nsc.ID AS node,
	nsc.NAME AS name,
  nsc.title AS title,
  nsc.has_point,
  nsc.has_files,
  nsc.schema::JSON as schema,
  ns.primary,
  ns.station,
	ns.required_user_details
FROM
	"nodesurvey" ns
	JOIN "nodeschema" nsc ON ( nsc.ID = ns.node ) 
WHERE
	ns.active = TRUE
	AND nsc.survey = TRUE 
	AND nsc.DOMAIN ${domainTexts} 
	AND ( ns.expires < now( ) OR ns.expires IS NULL );`;
}
