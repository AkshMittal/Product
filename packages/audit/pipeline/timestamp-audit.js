/**
 * Timestamp Audit Module
 * Per-point observational labeling of timestamp anomalies in GPX points.
 * Does NOT mutate, reorder, or normalize timestamps.
 *
 * Each anomalous point receives only the tags that apply; nominal points produce no annotation.
 * Tags are non-exclusive: a point can carry multiple tags simultaneously (e.g. belowAnchor + adjacentDuplicate).
 *
 * Output shape:
 *   audit.temporal.tagCounts     — count per tag (quick summary / quality metrics)
 *   audit.temporal.tagIndex      — array of gpxIndexes per tag (fast set-level queries)
 *   audit.temporal.pointAnnotations — sparse per-point objects (sequential correction workflow)
 */

/**
 * Audits timestamps in an array of points using per-point labeling.
 * @param {Array} points - Array of point objects with gpxIndex, timeRaw properties
 * @returns {Object} Audit payload with session, tagCounts, tagIndex, pointAnnotations
 */
function auditTimestamps(points) {
  let firstValidTimestampMs = null;
  let lastValidTimestampMs = null;
  let anchorTimestampMs = null;     // monotonic high-water mark; only advances on genuine forward progress
  let prevValidTimestampMs = null;  // previous valid parsed timestamp (adjacency + belowPrevValid checks)

  // tagIndex: sparse arrays of gpxIndexes, one per tag
  const tagIndex = {
    missing: [],
    unparsable: [],
    adjacentDuplicate: [],
    belowAnchor: [],
    belowPrevValid: [],
    nonAdjacentRepeat: []
  };

  // Sparse per-point annotations (only anomalous points emitted)
  const pointAnnotations = [];

  // Stream-wide timestamp value map for non-adjacent repeat detection: Map<timestampMs, firstGpxIndex>
  // O(1) amortized per lookup; avoids O(N^2) naive scan in tracks with no repeats
  const seenTimestamps = new Map();

  let totalPointsEvaluated = 0;
  let parseableTimestampPointCount = 0;

  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    const gpxIndex = point.gpxIndex;
    const timeRaw = point.timeRaw;
    totalPointsEvaluated++;

    // --- MISSING ---
    if (timeRaw === null) {
      tagIndex.missing.push(gpxIndex);
      pointAnnotations.push({ gpxIndex, missing: true });
      continue;
    }

    // --- UNPARSABLE ---
    const timestampMs = Date.parse(timeRaw);
    if (isNaN(timestampMs)) {
      tagIndex.unparsable.push(gpxIndex);
      pointAnnotations.push({ gpxIndex, unparsable: true });
      continue;
    }

    // Valid parsed timestamp from here
    parseableTimestampPointCount++;
    if (firstValidTimestampMs === null) firstValidTimestampMs = timestampMs;
    lastValidTimestampMs = timestampMs;

    // First valid point: initialize anchor and state, no comparative tags possible yet
    if (anchorTimestampMs === null) {
      anchorTimestampMs = timestampMs;
      prevValidTimestampMs = timestampMs;
      seenTimestamps.set(timestampMs, gpxIndex);
      continue;
    }

    // --- Apply all applicable tags independently (tags are non-exclusive) ---
    const annotation = { gpxIndex, timestampMs, anchorMs: anchorTimestampMs };
    let hasTag = false;

    // adjacentDuplicate and nonAdjacentRepeat are mutually exclusive by definition:
    // "adjacent" means immediately preceding valid point; "non-adjacent" means seen before but not immediately.
    const isAdjacentDup = (timestampMs === prevValidTimestampMs);

    // NON-ADJACENT REPEAT: value seen before in stream AND not the immediately preceding valid point
    if (!isAdjacentDup && seenTimestamps.has(timestampMs)) {
      annotation.nonAdjacentRepeat = true;
      annotation.firstOccurrenceGpxIndex = seenTimestamps.get(timestampMs);
      tagIndex.nonAdjacentRepeat.push(gpxIndex);
      hasTag = true;
    }

    // Register first occurrence only (subsequent occurrences are repeats, not re-registered)
    if (!seenTimestamps.has(timestampMs)) {
      seenTimestamps.set(timestampMs, gpxIndex);
    }

    // ADJACENT DUPLICATE: equal to the immediately preceding valid timestamp
    if (isAdjacentDup) {
      annotation.adjacentDuplicate = true;
      tagIndex.adjacentDuplicate.push(gpxIndex);
      hasTag = true;
    }

    // BELOW ANCHOR: behind the monotonic high-water mark at this position in the stream
    // Note: the anchor is the running maximum of all valid timestamps seen so far.
    // "First occurrence" of a timestamp value is never assumed correct — the anchor
    // is a mechanical maximum, not a truth claim about which occurrences are valid.
    if (timestampMs < anchorTimestampMs) {
      annotation.belowAnchor = true;
      annotation.depthFromAnchorMs = anchorTimestampMs - timestampMs;
      tagIndex.belowAnchor.push(gpxIndex);
      hasTag = true;
    }

    // BELOW PREV VALID: strictly less than the immediately preceding valid timestamp.
    // Distinguishes locally-recovering backtracks (belowAnchor only) from actively-retreating
    // backtracks (belowAnchor + belowPrevValid). Both tags together = "digging deeper";
    // belowAnchor alone = "still in the hole but moving forward locally".
    if (timestampMs < prevValidTimestampMs) {
      annotation.belowPrevValid = true;
      tagIndex.belowPrevValid.push(gpxIndex);
      hasTag = true;
    }

    if (hasTag) {
      pointAnnotations.push(annotation);
    }

    // Advance anchor only on genuine forward progress (not on duplicates or belowAnchor points)
    if (timestampMs > anchorTimestampMs) {
      anchorTimestampMs = timestampMs;
    }

    // prevValidTimestampMs always tracks the most recent valid parsed timestamp
    prevValidTimestampMs = timestampMs;
  }

  const rawSessionDurationSec = (firstValidTimestampMs !== null && lastValidTimestampMs !== null)
    ? (lastValidTimestampMs - firstValidTimestampMs) / 1000
    : null;

  return {
    audit: {
      temporal: {
        totalPointsEvaluated,
        session: {
          rawSessionDurationSec,
          parseableTimestampPointCount
        },
        tagCounts: {
          missing: tagIndex.missing.length,
          unparsable: tagIndex.unparsable.length,
          adjacentDuplicate: tagIndex.adjacentDuplicate.length,
          belowAnchor: tagIndex.belowAnchor.length,
          belowPrevValid: tagIndex.belowPrevValid.length,
          nonAdjacentRepeat: tagIndex.nonAdjacentRepeat.length
        },
        tagIndex,
        pointAnnotations
      }
    }
  };
}
