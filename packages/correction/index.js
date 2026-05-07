'use strict';

/**
 * packages/correction/index.js
 *
 * Public entry point for the correction layer.
 * Exports runCorrection(auditJson, acceptedPoints, params?) → correctionPayload
 *
 * See packages/correction/runner/correction-runner.js for implementation details.
 * See implementation_plan.md for full pipeline design.
 * See docs/adr/correction/0011–0015 for architectural decisions.
 */

var runner = require('./runner/correction-runner');

module.exports = {
  runCorrection: runner.runCorrection
};
