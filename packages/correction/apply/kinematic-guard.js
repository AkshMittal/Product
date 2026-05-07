'use strict';

/**
 * packages/correction/apply/kinematic-guard.js
 *
 * Shared kinematic guard primitive. ADR-correction-0015.
 *
 * Computes speedPrevKph, speedNextKph, score = sp² + sn², and pass/fail status.
 * Threshold: lenientMaxImpliedSpeedKph (default 80 kph) applied per-speed.
 *
 * A candidate PASSES if BOTH bracket speeds ≤ threshold.
 * A candidate FAILS if EITHER speed exceeds the threshold.
 * Missing bracket (null anchor) → that side vacuously passes.
 *
 * Returns a KinematicCheck object (ADR-correction-0015 §6):
 * {
 *   speedPrevKph: number | null,
 *   speedNextKph: number | null,
 *   score: number | null,
 *   thresholdKph: number,
 *   passed: boolean,
 *   failReason?: 'speed_prev_exceeded' | 'speed_next_exceeded' | 'both_exceeded' | 'no_bracket'
 * }
 */

var haversine = require('../../shared/geo/haversine');

/**
 * @param {{ lat: number, lon: number, timeMs: number }|null} prevAnchor
 * @param {{ lat: number, lon: number, timeMs: number }}       candidate
 * @param {{ lat: number, lon: number, timeMs: number }|null} nextAnchor
 * @param {number} thresholdKph
 * @returns {Object} KinematicCheck
 */
function computeKinematicCheck(prevAnchor, candidate, nextAnchor, thresholdKph) {
  if (thresholdKph === undefined) thresholdKph = 80;

  var speedPrevKph = null;
  var speedNextKph = null;

  if (prevAnchor !== null && prevAnchor !== undefined) {
    var dtPrev = candidate.timeMs - prevAnchor.timeMs;
    if (dtPrev <= 0) {
      // Zero or negative delta — kinematically degenerate
      speedPrevKph = dtPrev === 0 ? Infinity : NaN;
    } else {
      var distPrevM = haversine.haversineMeters(prevAnchor.lat, prevAnchor.lon, candidate.lat, candidate.lon);
      speedPrevKph = (distPrevM / dtPrev) * 3600000 / 1000;
    }
  }

  if (nextAnchor !== null && nextAnchor !== undefined) {
    var dtNext = nextAnchor.timeMs - candidate.timeMs;
    if (dtNext <= 0) {
      speedNextKph = dtNext === 0 ? Infinity : NaN;
    } else {
      var distNextM = haversine.haversineMeters(candidate.lat, candidate.lon, nextAnchor.lat, nextAnchor.lon);
      speedNextKph = (distNextM / dtNext) * 3600000 / 1000;
    }
  }

  // Pass/fail: only check available sides
  var prevFails = speedPrevKph !== null && speedPrevKph > thresholdKph;
  var nextFails = speedNextKph !== null && speedNextKph > thresholdKph;

  var passed;
  var failReason;

  if (speedPrevKph === null && speedNextKph === null) {
    // No bracket on either side
    passed = false;
    failReason = 'no_bracket';
  } else {
    passed = !prevFails && !nextFails;
    if (!passed) {
      if (prevFails && nextFails) failReason = 'both_exceeded';
      else if (prevFails)         failReason = 'speed_prev_exceeded';
      else                        failReason = 'speed_next_exceeded';
    }
  }

  var score = null;
  if (speedPrevKph !== null && speedNextKph !== null) {
    score = speedPrevKph * speedPrevKph + speedNextKph * speedNextKph;
  } else if (speedPrevKph !== null) {
    score = speedPrevKph * speedPrevKph;
  } else if (speedNextKph !== null) {
    score = speedNextKph * speedNextKph;
  }

  var result = {
    speedPrevKph: speedPrevKph,
    speedNextKph: speedNextKph,
    score:        score,
    thresholdKph: thresholdKph,
    passed:       passed
  };
  if (failReason) result.failReason = failReason;
  return result;
}

module.exports = { computeKinematicCheck };
