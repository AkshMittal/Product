'use strict';

/**
 * packages/correction/pre-segment/objective-adjacent-dedupe.js
 *
 * Initial deduplication pass — stream-adjacent only, pre-mutation.
 * ADR-correction-0014: before any mutation, stream-adjacent === traversal-adjacent.
 * The question here is "what raw-input exact pairs exist?" — a stream-adjacency question.
 *
 * Exact duplicate predicate (ADR-correction-0004):
 *   Same timeMs (both finite) AND same lat AND same lon AND same ele (or both null/absent)
 *
 * Emits drop records for the second occurrence of each adjacent exact pair.
 * Does NOT mutate workingOrderedPoints; caller applies drops via working-state.
 *
 * @param {Array<Object>} points - accepted GPX points in stream order (gpxIndex monotone)
 * @returns {Array<{keepGpxIndex: number, dropGpxIndex: number, reason: string}>}
 */
function findObjectiveAdjacentDuplicates(points) {
  var drops = [];

  for (var i = 1; i < points.length; i++) {
    var prev = points[i - 1];
    var curr = points[i];

    // Stream-adjacent check
    if (curr.gpxIndex !== prev.gpxIndex + 1) continue;

    // Exact duplicate predicate
    var sameTime = (
      typeof prev.timeMs === 'number' && isFinite(prev.timeMs) &&
      typeof curr.timeMs === 'number' && isFinite(curr.timeMs) &&
      prev.timeMs === curr.timeMs
    );
    if (!sameTime) continue;
    if (prev.lat !== curr.lat || prev.lon !== curr.lon) continue;

    // ele: both absent/null counts as equal; otherwise must match
    var prevEle = (prev.eleAbsent === true || prev.ele === null) ? null : prev.ele;
    var currEle = (curr.eleAbsent === true || curr.ele === null) ? null : curr.ele;
    if (prevEle !== currEle) continue;

    drops.push({
      keepGpxIndex: prev.gpxIndex,
      dropGpxIndex: curr.gpxIndex,
      reason: 'objective_adjacent_exact_duplicate'
    });
  }

  return drops;
}

module.exports = { findObjectiveAdjacentDuplicates };
