/**
 * WorkOrderTemplateController
 *
 * @description :: Server-side actions for handling incoming requests.
 * @help        :: See https://sailsjs.com/docs/concepts/actions
 */

const SailsExtensions = require('../services/SailsExtensions');

module.exports = {
  clone: async function(req, res) {
    if (req.method !== 'POST') {
      return res.notFound();
    }

    const params = req.params.all();

    if (!params.id) {
      return res.badRequest({ error: 'An ID param is required' });
    }

    const woT = await WorkOrderTemplate.findOneById(params.id).populate(
      'tasks'
    );
    if (!woT) {
      return res.badRequest({ error: 'Work order not found' });
    }

    const buildClone = WorkOrderTemplate.clone(woT, req.user);
    const created = await WorkOrderTemplate.create(buildClone);
    const createdPopulated = await WorkOrderTemplate.findOneById(
      created.id
    ).populateAll();

    res.send(createdPopulated);
  },

  timeEstimate: async function(req, res) {
    const params = SailsExtensions.params(req);
    if (!params.id) {
      return res.badRequest({ error: 'An ID param is required' });
    }

    if (!params.user) {
      return res.badRequest({ error: 'An user ID param is required' });
    }

    const wo = await WorkOrder.findOneById(params.id);

    if (!wo) {
      return res.badRequest({ error: 'Work order not found' });
    }

    const meta = wo.meta || {};
    const personnelAssignment = meta.personnelAssignment;

    if (!personnelAssignment) {
      return res.send({ estimate: 0 });
    }
    const scopedPersonnelAssignment =
      personnelAssignment[Model.getId(params.user)];
    if (!scopedPersonnelAssignment) {
      return res.send({ estimate: 0 });
    }

    const work = WorkOrderTemplate.iterateWork(scopedPersonnelAssignment);
    const estimate = await WorkOrderTemplate.getWorkEstimate(work);
    res.send({ estimate: estimate });
  }
};
