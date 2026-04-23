'use strict';

/**
 * packages/correction/params/defaults.js
 *
 * Default parameter values for the correction layer.
 * All values are versioned; override by passing a params object to runCorrection().
 *
 * References:
 *   ADR-correction-0015: lenientMaxImpliedSpeedKph = 80
 *   ADR-correction-0011: multipassMaxIterations = 500
 */

module.exports = {
  /** Lenient kinematic speed ceiling for insert/block-reorder guard (km/h). ADR-correction-0015. */
  lenientMaxImpliedSpeedKph: 80,

  /** Maximum multipass iterations per segment before forced stalemate exit. ADR-correction-0011. */
  multipassMaxIterations: 500,

  /** Elevation valid range floor (metres). Matches motion-audit default. */
  validEleFloorM: -500,

  /** Elevation valid range ceiling (metres). Matches motion-audit default. */
  validEleCeilingM: 9500,
};
