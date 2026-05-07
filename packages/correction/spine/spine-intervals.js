'use strict';

/**
 * packages/correction/spine/spine-intervals.js
 *
 * Computes per-segment spine points and the segment spine envelope.
 *
 * Two public entry-points:
 *   computeSpineIntervals(points)  → Map<trkSegIndex, spinePoints[]>
 *   computeSpineResult(points)     → { spinePointsBySegment, envelopeBySegment,
 *                                      duplicateTimeMembersBySegment }
 *
 * Spine point definition (per segment, ADR-correction-0010 / ADR-correction-0014):
 *   1. timeMs is finite, numeric, and strictly > 0.
 *   2. Forward-monotonic: each accepted spine point's timeMs > previous spine point's.
 *   3. NOT a member of a duplicate-time cluster within the segment.
 *
 * Segment boundary is a hard wall: computation does not cross trkSegIndex boundaries.
 */

function _computeSpine(points) {
  var bySegment = new Map();
  for (var i = 0; i < points.length; i++) {
    var pt = points[i];
    if (!bySegment.has(pt.trkSegIndex)) bySegment.set(pt.trkSegIndex, []);
    bySegment.get(pt.trkSegIndex).push(pt);
  }

  var spinePointsBySegment = new Map();
  var envelopeBySegment    = new Map();
  var duplicateTimeMembersBySegment = new Map();

  bySegment.forEach(function(segPoints, trkSegIndex) {
    // Identify duplicate-time clusters.
    var timeCounts = new Map();
    for (var j = 0; j < segPoints.length; j++) {
      var sp = segPoints[j];
      if (typeof sp.timeMs !== 'number' || !isFinite(sp.timeMs) || sp.timeMs <= 0) continue;
      timeCounts.set(sp.timeMs, (timeCounts.get(sp.timeMs) || 0) + 1);
    }
    var duplicateTimesMs = new Set();
    timeCounts.forEach(function(count, timeMs) {
      if (count > 1) duplicateTimesMs.add(timeMs);
    });

    var dupMembers = new Set();
    if (duplicateTimesMs.size > 0) {
      for (var dm = 0; dm < segPoints.length; dm++) {
        var dp = segPoints[dm];
        if (typeof dp.timeMs !== 'number' || !isFinite(dp.timeMs) || dp.timeMs <= 0) continue;
        if (duplicateTimesMs.has(dp.timeMs)) dupMembers.add(dp.gpxIndex);
      }
    }
    duplicateTimeMembersBySegment.set(trkSegIndex, dupMembers);

    // Walk segment in stream order; greedily accept forward-monotonic, non-cluster points.
    var spinePoints = [];
    var prevSpineTimeMs = -Infinity;
    for (var k = 0; k < segPoints.length; k++) {
      var spt = segPoints[k];
      if (typeof spt.timeMs !== 'number' || !isFinite(spt.timeMs) || spt.timeMs <= 0) continue;
      if (duplicateTimesMs.has(spt.timeMs)) continue;
      if (spt.timeMs <= prevSpineTimeMs) continue;
      spinePoints.push(spt);
      prevSpineTimeMs = spt.timeMs;
    }
    spinePointsBySegment.set(trkSegIndex, spinePoints);

    // Compute envelope from spine points only.
    if (spinePoints.length === 0) {
      envelopeBySegment.set(trkSegIndex, { minTimeMs: null, maxTimeMs: null });
    } else {
      var minT = spinePoints[0].timeMs;
      var maxT = spinePoints[0].timeMs;
      for (var e = 1; e < spinePoints.length; e++) {
        var t = spinePoints[e].timeMs;
        if (t < minT) minT = t;
        if (t > maxT) maxT = t;
      }
      envelopeBySegment.set(trkSegIndex, { minTimeMs: minT, maxTimeMs: maxT });
    }
  });

  return {
    spinePointsBySegment:           spinePointsBySegment,
    envelopeBySegment:              envelopeBySegment,
    duplicateTimeMembersBySegment:  duplicateTimeMembersBySegment
  };
}

/**
 * Returns the spinePointsBySegment Map<trkSegIndex, spinePoints[]> only.
 * Use this when callers only need the spine points (e.g. tests, detectOverlap).
 */
function computeSpineIntervals(points) {
  return _computeSpine(points).spinePointsBySegment;
}

/**
 * Returns the full result object needed by the runner and phase1-loop:
 *   { spinePointsBySegment, envelopeBySegment, duplicateTimeMembersBySegment }
 */
function computeSpineResult(points) {
  return _computeSpine(points);
}

/**
 * Convenience: write each profile's `spineEnvelope` from the envelope map.
 */
function attachSpineEnvelopes(segmentProfiles, envelopeBySegment) {
  for (var i = 0; i < segmentProfiles.length; i++) {
    var prof = segmentProfiles[i];
    var env = envelopeBySegment.get(prof.trkSegIndex);
    if (env) prof.spineEnvelope = { minTimeMs: env.minTimeMs, maxTimeMs: env.maxTimeMs };
  }
}

module.exports = {
  computeSpineIntervals: computeSpineIntervals,
  computeSpineResult:    computeSpineResult,
  attachSpineEnvelopes:  attachSpineEnvelopes
};
