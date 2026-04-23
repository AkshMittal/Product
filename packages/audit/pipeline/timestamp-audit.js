/**
 * Timestamp Audit Module
 * Per-point observational labeling of timestamp anomalies in GPX points.
 * Does NOT mutate, reorder, or normalize timestamps.
 *
 * Each anomalous point receives only the tags that apply; nominal points produce no annotation.
 * Tags are non-exclusive: a point can carry multiple tags simultaneously (e.g. belowAnchor + adjacentDuplicate).
 * adjacentDuplicate / belowPrevValid use the accepted GPX predecessor row (gpxIndex-1) when it has finite timeMs (ADR-0013).
 *
 * Output shape:
 *   audit.temporal.tagCounts     — count per tag (quick summary / quality metrics)
 *   audit.temporal.tagIndex      — array of gpxIndexes per tag (fast set-level queries)
 *   audit.temporal.pointAnnotations — sparse per-point objects (sequential correction workflow)
 */

/**
 * Audits timestamps in an array of points using per-point labeling.
 * Expects ingestion-shaped points: `timeAbsent`, `timeMs`, optional `timeRaw` (forwarded in unparsable annotations only; never parsed here).
 * @param {Array} points - Array of point objects with gpxIndex, timeAbsent, timeMs, optional timeRaw
 * @returns {Object} Audit payload with session, tagCounts, tagIndex, pointAnnotations
 */
function auditTimestamps(points) {
  let firstValidTimestampMs = null;
  let lastValidTimestampMs = null;
  let anchorTimestampMs = null;     // monotonic high-water mark; only advances on genuine forward progress

  const pointByGpxIndex = new Map();
  for (let pi = 0; pi < points.length; pi++) {
    const p = points[pi];
    const gi = p.gpxIndex;
    if (typeof gi === 'number' && isFinite(gi)) {
      pointByGpxIndex.set(gi, p);
    }
  }

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
    const timeAbsent = point.timeAbsent;
    totalPointsEvaluated++;

    let timestampMs = null;

    // --- MISSING --- (no <time> element)
    if (timeAbsent === true) {
      tagIndex.missing.push(gpxIndex);
      pointAnnotations.push({ gpxIndex, missing: true });
      continue;
    }

    // --- <time> present: valid only if ingestion produced finite timeMs; else unparsable (timeRaw forwarded, not read)
    if (timeAbsent === false) {
      if (typeof point.timeMs === 'number' && isFinite(point.timeMs)) {
        timestampMs = point.timeMs;
      } else {
        tagIndex.unparsable.push(gpxIndex);
        const ann = { gpxIndex, unparsable: true };
        if (point.timeRaw != null) ann.timeRaw = point.timeRaw;
        pointAnnotations.push(ann);
        continue;
      }
    } else {
      // Malformed point (no timeAbsent): treat like missing unless finite timeMs is present
      if (typeof point.timeMs === 'number' && isFinite(point.timeMs)) {
        timestampMs = point.timeMs;
      } else {
        tagIndex.missing.push(gpxIndex);
        pointAnnotations.push({ gpxIndex, missing: true });
        continue;
      }
    }

    // Valid parsed timestamp from here
    parseableTimestampPointCount++;
    if (firstValidTimestampMs === null) firstValidTimestampMs = timestampMs;
    lastValidTimestampMs = timestampMs;

    // First valid point: initialize anchor and state, no comparative tags possible yet
    if (anchorTimestampMs === null) {
      anchorTimestampMs = timestampMs;
      seenTimestamps.set(timestampMs, gpxIndex);
      continue;
    }

    // --- Apply all applicable tags independently (tags are non-exclusive) ---
    const annotation = { gpxIndex, timestampMs, anchorMs: anchorTimestampMs };
    let hasTag = false;

    const predPoint = pointByGpxIndex.get(gpxIndex - 1);
    const predTimeMs =
      predPoint && typeof predPoint.timeMs === 'number' && isFinite(predPoint.timeMs)
        ? predPoint.timeMs
        : null;

    // adjacentDuplicate and nonAdjacentRepeat are mutually exclusive by definition:
    // "adjacent" means same timestamp as the GPX stream predecessor row (gpxIndex-1) when that row exists
    // in accepted points with a parseable time; "non-adjacent" means seen before but not that stream pair.
    const isAdjacentDup = predTimeMs !== null && timestampMs === predTimeMs;

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

    // BELOW PREV VALID: strictly less than the GPX stream predecessor's valid timestamp (gpxIndex-1).
    // Distinguishes locally-recovering backtracks (belowAnchor only) from actively-retreating
    // backtracks (belowAnchor + belowPrevValid). Both tags together = "digging deeper";
    // belowAnchor alone = "still in the hole but moving forward locally".
    if (predTimeMs !== null && timestampMs < predTimeMs) {
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
  }

  const rawSessionDurationSec = (firstValidTimestampMs !== null && lastValidTimestampMs !== null)
    ? (lastValidTimestampMs - firstValidTimestampMs) / 1000
    : null;

  // ── Per-segment summary ────────────────────────────────────────────────────
  // Group accepted points by trkSegIndex and compute per-segment temporal stats.
  // ADR-correction-0013: raw per-segment payloads; no classification.
  // Shape: { trkSegIndex, tagCounts, monotonicity: { hasViolation, violationCount } }
  const segMap = new Map();
  for (let i = 0; i < points.length; i++) {
    const seg = points[i].trkSegIndex;
    if (!segMap.has(seg)) {
      segMap.set(seg, {
        trkSegIndex: seg,
        tagCounts: { missing: 0, unparsable: 0, adjacentDuplicate: 0, belowAnchor: 0, belowPrevValid: 0, nonAdjacentRepeat: 0 },
        violationCount: 0
      });
    }
  }
  for (let i = 0; i < pointAnnotations.length; i++) {
    const ann = pointAnnotations[i];
    const pt  = pointByGpxIndex.get(ann.gpxIndex);
    if (!pt) continue;
    const entry = segMap.get(pt.trkSegIndex);
    if (!entry) continue;
    if (ann.missing)             entry.tagCounts.missing++;
    if (ann.unparsable)          entry.tagCounts.unparsable++;
    if (ann.adjacentDuplicate)   entry.tagCounts.adjacentDuplicate++;
    if (ann.belowAnchor)        { entry.tagCounts.belowAnchor++;  entry.violationCount++; }
    if (ann.belowPrevValid)      entry.tagCounts.belowPrevValid++;
    if (ann.nonAdjacentRepeat)   entry.tagCounts.nonAdjacentRepeat++;
  }
  const perSegment = Array.from(segMap.values())
    .sort(function(a, b) { return a.trkSegIndex - b.trkSegIndex; })
    .map(function(entry) {
      return {
        trkSegIndex: entry.trkSegIndex,
        tagCounts: entry.tagCounts,
        monotonicity: {
          hasViolation:   entry.violationCount > 0,
          violationCount: entry.violationCount
        }
      };
    });

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
        pointAnnotations,
        perSegment
      }
    }
  };
}
