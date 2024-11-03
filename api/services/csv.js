const {
  headers,
  placeData,
  buildStationExcel,
  setNodeHeaders,
  putData,
  stripRows,
  setObjects,
  buildGenericNodeExcel,
  parseModel,
  parse,
  buildCSV,
  processModel,
  syncVariables,
  process
} = require('../model-utilities/csv/csv-legacy-func');

module.exports = {
  headers,

  placeData,

  putData,

  stripRows,

  buildStationExcel,

  setObjects,

  setNodeHeaders,

  buildGenericNodeExcel,

  /*
   * We make a decision on how to
   * Manage this based in the request method
   */
  parseModel,

  /*
   * We make a decision on how to
   * Manage this based in the request method
   */
  parse,

  buildCSV,

  /*
   * This function is called by kue for the batch processing
   */
  processModel,

  syncVariables,

  /*
   * This function is called by kue for the batch processing
   */
  process
};
