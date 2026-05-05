'use strict';

/**
 * packages/correction/params/defaults.js
 *
 * Default parameter values for the correction layer. All values are versioned;
 * override by passing a params object to runCorrection().
 *
 * References:
 *   ADR-correction-0002 / ADR-correction-0007: minTimestampPairCoverageRatio
 *   ADR-correction-0011: multipassMaxIterations
 *   ADR-correction-0013: timezoneShiftTolerance
 *   ADR-correction-0015: lenientMaxImpliedSpeedKph
 */

module.exports = {
  /** Lenient kinematic speed ceiling for insert/block-reorder guard (km/h). ADR-0015. */
  lenientMaxImpliedSpeedKph: 80,

  /** Maximum multipass iterations per segment before forced max-iterations exit. ADR-0011. */
  multipassMaxIterations: 500,

  /** Global / per-segment minimum coverage ratio for full participation. ADR-0002 / 0007. */
  minTimestampPairCoverageRatio: 0.8,

  /** Round-hour boundary detection tolerance (fraction of an hour). ADR-0013. */
  timezoneShiftTolerance: 0.1,

  /** Elevation valid range floor (metres). Matches motion-audit default. */
  validEleFloorM: -500,

  /** Elevation valid range ceiling (metres). Matches motion-audit default. */
  validEleCeilingM: 9500
};
