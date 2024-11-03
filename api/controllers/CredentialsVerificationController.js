/**
 * CredentialsVerificationController
 *
 * @description :: Server-side actions for handling incoming requests.
 * @help        :: See https://sailsjs.com/docs/concepts/actions
 */

module.exports = {
  verify: async function(req, res) {
    if (req.method !== 'POST') {
      return res.notFound();
    }
    const params = req.params.all();
    const target = params.target;
    const token = params.token;
    if (!target) {
      return res.badRequest({ error: 'Target Not Valid' });
    }

    if (!token) {
      return res.badRequest({ error: 'A match pattern is required' });
    }

    const credential = await CredentialsVerification.findRelevantCredentials(
      target
    );
    if (!credential) {
      return res.badRequest({
        error: 'There are no valid verification credentials'
      });
    }
    try {
      const valid = await credential.verifyMatch(token);
      valid && (await credential.consume());
      return res.send({ valid });
    } catch (e) {
      sails.log.error('CredentialsVerificationController.verify::', e.message);
      return res.badRequest({ error: e.message });
    }
  }
};
