'use strict';

/**
 * packages/correction/pre-segment/participation-check.js
 *
 * Filters points that can participate in the correction pipeline:
 *   - Must have valid, finite lat + lon (guaranteed by ingestion, but verified here)
 *   - May or may not have timeMs (points without timeMs are non-participants for
 *     kinematic proposals but still occupy gpxIndex slots)
 *
 * Returns participation flags per point — does not mutate or drop.
 * Dropping (for non-participation) happens in the relevant proposal module.
 *
 * @param {Array<Object>} points - accepted GPX points
 * @returns {{ participatingGpxIndexes: Set<number>, nonParticipatingGpxIndexes: Set<number> }}
 */
function checkParticipation(points) {
  var participating    = new Set();
  var nonParticipating = new Set();

  for (var i = 0; i < points.length; i++) {
    var pt = points[i];
    var hasCoords = (
      typeof pt.lat === 'number' && isFinite(pt.lat) &&
      typeof pt.lon === 'number' && isFinite(pt.lon)
    );
    if (hasCoords) {
      participating.add(pt.gpxIndex);
    } else {
      nonParticipating.add(pt.gpxIndex);
    }
  }

  return { participatingGpxIndexes: participating, nonParticipatingGpxIndexes: nonParticipating };
}

module.exports = { checkParticipation };
