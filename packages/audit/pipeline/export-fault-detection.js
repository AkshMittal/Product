/**
 * Export Fault Detection Module
 *
 * @deprecated This module is superseded by the correction layer's
 * `deterministic-export-fix.js` (packages/correction/pre-segment/deterministic-export-fix.js).
 * It continues to run during the audit phase for backwards compatibility and diagnostics.
 * Removal is scheduled after correction's deterministic-export-fix passes equivalent fixtures
 * (Phase J cleanup).
 *
 * Analyses GPX <trkseg> structure for export-time faults. Runs on the parsed XML
 * document before trkpt gpxIndex assignment — it operates at the XML/segment level,
 * not the point level. Called from parseGPX (gpx-ingestion-module.js) and results
 * are forwarded as audit.exportFaults[] and audit.ingestion.segmentSummaries[].
 *
 * Export faults are distinct from kinematic faults (GPS noise, belowAnchor backtracks):
 * they are structural anomalies introduced by the export/transfer process — chunk
 * ordering errors, buffer re-flushes, timezone conversion bugs, or data loss between
 * the device buffer and file. The primary signal is trkSegIndex: anomalies that align
 * with <trkseg> boundaries are export-chunk faults; anomalies within a single <trkseg>
 * are recording-level (device pause, signal loss, genuine backtrack).
 *
 * Fault types detected:
 *   chunk_ordering_fault          — segments in wrong chronological order (confidence 1.0)
 *   duplicate_chunk_fault         — consecutive segments have overlapping time ranges (0.95)
 *   missing_chunk_fault           — large positive gap between segments (0.85; flag only)
 *   timestamp_discontinuity_fault — backward jump ≈ N whole hours at boundary (0.90)
 *   intra_segment_timestamp_violation — backward timestamp within one segment (1.0)
 *
 * All faults reference globalSegIndex (= trkSegIndex as assigned by gpx-ingestion-module)
 * so fault entries map directly to the trkSegIndex field on accepted trkpt points.
 */

/**
 * Default parameters (versioned in profile).
 * missingChunkThresholdMs: gap larger than this → flag missing_chunk_fault (default 30 min).
 * timezoneShiftTolerance: fraction of one hour within which a backward jump is treated
 *   as a round-hour timezone/DST shift rather than a segment ordering error (default 0.1 ≈ 6 min).
 */
const DEFAULT_MISSING_CHUNK_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_TIMEZONE_SHIFT_TOLERANCE   = 0.1;            // fraction of one hour

// ─── Segment summaries ──────────────────────────────────────────────────────

/**
 * Builds one SegmentSummary per <trkseg> element across all tracks.
 * globalSegIndex matches the trkSegIndex assigned by gpx-ingestion-module.js to each trkpt.
 *
 * @param {Document} xmlDoc
 * @returns {SegmentSummary[]}
 *
 * SegmentSummary shape:
 * {
 *   trackIndex:    number,   // 0-based index of the parent <trk>
 *   segIndex:      number,   // 0-based index within that track
 *   globalSegIndex: number,  // 0-based index across all tracks (= trkSegIndex in ingestion)
 *   pointCount:    number,   // total <trkpt> elements in this segment
 *   usableTimeCount: number, // how many trkpt have a parseable timeMs
 *   firstTimeMs:   number | null,  // timeMs of first parseable timestamp
 *   lastTimeMs:    number | null,  // timeMs of last parseable timestamp
 *   minTimeMs:     number | null,  // minimum timeMs over segment
 *   maxTimeMs:     number | null,  // maximum timeMs over segment
 * }
 */
function buildSegmentSummaries(xmlDoc) {
  const summaries = [];
  const tracks = xmlDoc.querySelectorAll('trk');
  let globalSegIndex = 0;

  tracks.forEach((trk, trackIndex) => {
    const segments = trk.querySelectorAll('trkseg');

    segments.forEach((seg, segIndex) => {
      const trkpts = seg.querySelectorAll('trkpt');
      const usableTimesMs = [];

      trkpts.forEach(pt => {
        const timeEl = pt.querySelector('time');
        if (timeEl) {
          const raw = timeEl.textContent.trim();
          if (raw) {
            const ms = Date.parse(raw);
            if (!isNaN(ms)) usableTimesMs.push(ms);
          }
        }
      });

      summaries.push({
        trackIndex,
        segIndex,
        globalSegIndex,
        pointCount: trkpts.length,
        usableTimeCount: usableTimesMs.length,
        firstTimeMs:  usableTimesMs.length > 0 ? usableTimesMs[0]                       : null,
        lastTimeMs:   usableTimesMs.length > 0 ? usableTimesMs[usableTimesMs.length - 1] : null,
        minTimeMs:    usableTimesMs.length > 0 ? Math.min(...usableTimesMs)              : null,
        maxTimeMs:    usableTimesMs.length > 0 ? Math.max(...usableTimesMs)              : null
      });

      globalSegIndex++;
    });
  });

  return summaries;
}

// ─── Intra-segment violations ───────────────────────────────────────────────

/**
 * Detects backward timestamps within a single <trkseg>. Confidence is 1.0 (deterministic).
 *
 * Diagnostic note: intra-segment violations are also detected by the temporal audit
 * as belowPrevValid / belowAnchor tags on individual trkpt points. The trkSegIndex
 * field on accepted points allows the correction layer to distinguish:
 *   - Same trkSegIndex on both sides of an anomaly → intra-segment → recording-level
 *     (device GPS glitch, signal loss, pause/resume within one recording session).
 *   - Different trkSegIndex at a segment boundary → inter-segment → export-chunk fault
 *     candidate (chunk_ordering_fault or timestamp_discontinuity_fault detected below).
 * This distinction guides whether block-proposal should flag a finding as an export
 * chunk reorder candidate vs a genuine kinematic backtrack.
 *
 * @param {SegmentSummary[]} summaries - From buildSegmentSummaries()
 * @returns {ExportFault[]}
 */
function detectIntraSegmentViolations(summaries) {
  const faults = [];

  summaries.forEach(seg => {
    // We need the raw time sequence, not just min/max — re-read from summary
    // NOTE: summaries only store boundary/aggregate times, not the full sequence.
    // Full violation scanning on the time sequence is handled here by delegating
    // to the caller which passes the raw timesMs from buildSegmentSummaries.
    // See implementation note: buildSegmentSummaries stores usableTimesMs internally;
    // to scan it here we extend the summary object (see augmentedBuildSegmentSummaries).
  });

  return faults;
}

/**
 * Haversine distance in metres between two lat/lon pairs.
 * @param {number} lat1 @param {number} lon1 @param {number} lat2 @param {number} lon2
 * @returns {number}
 */
function haversineM(lat1, lon1, lat2, lon2) {
  const R  = 6371000;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a  = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Extended segment summary builder that retains the full usable time sequence for
 * intra-segment violation scanning, and captures boundary coordinates for the
 * missing_chunk_fault implied-speed metric. Used internally; summaries exposed in
 * the output use the compact shape (no _timesMs array).
 *
 * @param {Document} xmlDoc
 * @returns {{ summaries: SegmentSummary[], timelines: number[][], coords: Array<{lastLat,lastLon,firstLat,firstLon}> }}
 */
function buildSegmentSummariesWithTimeline(xmlDoc) {
  const summaries = [];
  const timelines  = [];     // parallel array: timelines[i] = usable timeMs array for summaries[i]
  const coords     = [];     // parallel array: boundary lat/lon for missing_chunk metric
  const tracks = xmlDoc.querySelectorAll('trk');
  let globalSegIndex = 0;

  tracks.forEach((trk, trackIndex) => {
    const segments = trk.querySelectorAll('trkseg');

    segments.forEach((seg, segIndex) => {
      const trkpts = seg.querySelectorAll('trkpt');
      const usableTimesMs = [];
      let firstLat = null, firstLon = null, lastLat = null, lastLon = null;

      trkpts.forEach(pt => {
        const lat = parseFloat(pt.getAttribute('lat'));
        const lon = parseFloat(pt.getAttribute('lon'));
        const coordOk = isFinite(lat) && isFinite(lon) &&
          lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;

        const timeEl = pt.querySelector('time');
        if (timeEl) {
          const raw = timeEl.textContent.trim();
          if (raw) {
            const ms = Date.parse(raw);
            if (!isNaN(ms)) {
              usableTimesMs.push(ms);
              if (coordOk) {
                if (firstLat === null) { firstLat = lat; firstLon = lon; }
                lastLat = lat; lastLon = lon;
              }
            }
          }
        }
      });

      summaries.push({
        trackIndex,
        segIndex,
        globalSegIndex,
        pointCount: trkpts.length,
        usableTimeCount: usableTimesMs.length,
        firstTimeMs:  usableTimesMs.length > 0 ? usableTimesMs[0]                       : null,
        lastTimeMs:   usableTimesMs.length > 0 ? usableTimesMs[usableTimesMs.length - 1] : null,
        minTimeMs:    usableTimesMs.length > 0 ? Math.min(...usableTimesMs)              : null,
        maxTimeMs:    usableTimesMs.length > 0 ? Math.max(...usableTimesMs)              : null
      });

      timelines.push(usableTimesMs);
      coords.push({ firstLat, firstLon, lastLat, lastLon });
      globalSegIndex++;
    });
  });

  return { summaries, timelines, coords };
}

// ─── Inter-segment faults ────────────────────────────────────────────────────

/**
 * Detects fault conditions at boundaries between consecutive <trkseg> elements
 * within the same <trk>. Cross-track comparisons are out of scope (different
 * recording sessions may legitimately be in any order).
 *
 * Detection priority at each boundary (applied in order; multiple may fire):
 *   1. gapMs < 0 AND ≈ round-hour backward jump  → timestamp_discontinuity_fault
 *   2. gapMs < 0 AND consecutive ranges overlap  → duplicate_chunk_fault
 *   3. gapMs < 0 AND no overlap                  → chunk_ordering_fault
 *   4. gapMs > missingChunkThresholdMs            → missing_chunk_fault (flag only)
 *
 * @param {SegmentSummary[]} summaries
 * @param {Array} coords - Parallel boundary-coord array from buildSegmentSummariesWithTimeline
 * @param {{ missingChunkThresholdMs: number, timezoneShiftTolerance: number }} params
 * @returns {ExportFault[]}
 */
function detectInterSegmentFaults(summaries, coords, params) {
  const { missingChunkThresholdMs, timezoneShiftTolerance } = params;
  const faults = [];

  // Group by trackIndex, preserving document order within each group
  const byTrack = new Map();
  summaries.forEach((seg, i) => {
    if (!byTrack.has(seg.trackIndex)) byTrack.set(seg.trackIndex, []);
    byTrack.get(seg.trackIndex).push({ seg, coordIdx: i });
  });

  byTrack.forEach(trackEntries => {
    for (let i = 0; i < trackEntries.length - 1; i++) {
      const curr = trackEntries[i].seg;
      const next = trackEntries[i + 1].seg;
      const currCoords = coords[trackEntries[i].coordIdx];
      const nextCoords = coords[trackEntries[i + 1].coordIdx];

      // Skip if either boundary time is unavailable
      if (curr.lastTimeMs === null || next.firstTimeMs === null) continue;

      const gapMs = next.firstTimeMs - curr.lastTimeMs;

      if (gapMs < 0) {
        // Backward time across segment boundary
        const hoursBack = Math.abs(gapMs) / 3600000;
        const nearestHour = Math.round(hoursBack);
        const isRoundHourShift = nearestHour >= 1 &&
          Math.abs(hoursBack - nearestHour) < timezoneShiftTolerance;

        if (isRoundHourShift) {
          // Timezone or DST conversion applied inconsistently across the file
          faults.push({
            type: 'timestamp_discontinuity_fault',
            severity: 'medium',
            confidence: 0.90,
            fromTrkSegIndex: curr.globalSegIndex,
            toTrkSegIndex:   next.globalSegIndex,
            trackIndex:      curr.trackIndex,
            gapMs,
            suspectedTimezoneOffsetHours: nearestHour,
            details: `trkseg boundary ${curr.globalSegIndex}→${next.globalSegIndex}: ` +
              `timestamp moved backward ${nearestHour} hour(s) — probable timezone/DST shift`
          });
        } else {
          // Not a round-hour shift — ordering error or buffer re-flush
          const currStart = curr.firstTimeMs;
          const nextEnd   = next.lastTimeMs;

          // Duplicate chunk: both ranges overlap in time (buffer re-flush or export retry)
          if (currStart !== null && nextEnd !== null &&
              next.firstTimeMs < curr.lastTimeMs && nextEnd > currStart) {
            faults.push({
              type: 'duplicate_chunk_fault',
              severity: 'critical',
              confidence: 0.95,
              fromTrkSegIndex: curr.globalSegIndex,
              toTrkSegIndex:   next.globalSegIndex,
              trackIndex:      curr.trackIndex,
              gapMs,
              overlapStartMs: next.firstTimeMs,
              overlapEndMs:   Math.min(curr.lastTimeMs, nextEnd),
              details: `trkseg boundary ${curr.globalSegIndex}→${next.globalSegIndex}: ` +
                `time ranges overlap — [${currStart}..${curr.lastTimeMs}] ∩ [${next.firstTimeMs}..${nextEnd}]`
            });
          } else {
            // Pure ordering fault: next segment starts before current ends, no full overlap
            faults.push({
              type: 'chunk_ordering_fault',
              severity: 'critical',
              confidence: 1.0,
              fromTrkSegIndex: curr.globalSegIndex,
              toTrkSegIndex:   next.globalSegIndex,
              trackIndex:      curr.trackIndex,
              gapMs,
              details: `trkseg boundary ${curr.globalSegIndex}→${next.globalSegIndex}: ` +
                `trkseg[${curr.globalSegIndex}] ends at ${curr.lastTimeMs}, ` +
                `trkseg[${next.globalSegIndex}] starts at ${next.firstTimeMs} — out of chronological order`
            });
          }
        }
      } else if (gapMs > missingChunkThresholdMs) {
        // Large positive gap: possible data lost during export (flag only — cannot recover)
        let impliedDistanceM = null;
        let impliedSpeedKph  = null;
        if (currCoords.lastLat !== null && nextCoords.firstLat !== null) {
          impliedDistanceM = Math.round(haversineM(
            currCoords.lastLat, currCoords.lastLon,
            nextCoords.firstLat, nextCoords.firstLon
          ));
          impliedSpeedKph = parseFloat(
            ((impliedDistanceM / 1000) / (gapMs / 3600000)).toFixed(1)
          );
        }
        faults.push({
          type: 'missing_chunk_fault',
          severity: 'high',
          confidence: 0.85,
          fromTrkSegIndex: curr.globalSegIndex,
          toTrkSegIndex:   next.globalSegIndex,
          trackIndex:      curr.trackIndex,
          gapMs,
          gapMinutes:      Math.round(gapMs / 60000),
          impliedDistanceM,
          impliedSpeedKph,
          details: `trkseg boundary ${curr.globalSegIndex}→${next.globalSegIndex}: ` +
            `${Math.round(gapMs / 60000)}-minute gap — possible missing data chunk`,
          note: 'May be a legitimate recording pause; cross-reference with activity type and device context'
        });
      }
    }
  });

  return faults;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Detects export-time faults in a parsed GPX document.
 *
 * Called by gpx-ingestion-module.js parseGPX() immediately after DOMParser succeeds
 * and before trkpt gpxIndex assignment. Results are placed at:
 *   audit.exportFaults[]         — fault records (see fault types above)
 *   audit.ingestion.segmentSummaries[] — one entry per <trkseg> (compact shape)
 *
 * @param {Document} xmlDoc - Parsed XML document (from DOMParser)
 * @param {Object}  [params] - Optional versioned parameters
 * @param {number}  [params.missingChunkThresholdMs=1800000] - Gap threshold in ms for missing_chunk_fault (default 30 min)
 * @param {number}  [params.timezoneShiftTolerance=0.1]      - Round-hour tolerance for timezone shift detection
 * @returns {{ faults: ExportFault[], segmentSummaries: SegmentSummary[] }}
 *
 * ExportFault shape (common fields):
 * {
 *   type:       string,   // fault type constant (see module header)
 *   severity:   'critical' | 'high' | 'medium' | 'low',
 *   confidence: number,   // 0–1; see per-type values above
 *   trackIndex: number,   // parent <trk> index (0-based)
 *   // For inter-segment faults:
 *   fromTrkSegIndex: number,   // globalSegIndex of the segment before the boundary
 *   toTrkSegIndex:   number,   // globalSegIndex of the segment after the boundary
 *   gapMs?:          number,   // next.firstTimeMs − curr.lastTimeMs (negative = backward)
 *   details:  string,          // human-readable description
 *   // Type-specific optional fields: suspectedTimezoneOffsetHours, overlapStartMs,
 *   //   overlapEndMs, gapMinutes, note — see per-type sections above
 *   // For intra_segment_timestamp_violation:
 *   trkSegIndex:        number,  // = globalSegIndex (which segment contains the violation)
 *   pointIndexInSegment: number, // 0-based index within the segment's usable time sequence
 *   precedingTimeMs:     number,
 *   violatingTimeMs:     number
 * }
 */
function detectExportFaults(xmlDoc, params) {
  const mergedParams = {
    missingChunkThresholdMs: (params && params.missingChunkThresholdMs != null)
      ? params.missingChunkThresholdMs
      : DEFAULT_MISSING_CHUNK_THRESHOLD_MS,
    timezoneShiftTolerance: (params && params.timezoneShiftTolerance != null)
      ? params.timezoneShiftTolerance
      : DEFAULT_TIMEZONE_SHIFT_TOLERANCE
  };

  const { summaries, timelines, coords } = buildSegmentSummariesWithTimeline(xmlDoc);

  // Intra-segment violations: scan each segment's time sequence
  const intraFaults = [];
  summaries.forEach((seg, idx) => {
    const times = timelines[idx];
    for (let i = 1; i < times.length; i++) {
      if (times[i] < times[i - 1]) {
        intraFaults.push({
          type: 'intra_segment_timestamp_violation',
          severity: 'high',
          confidence: 1.0,
          trkSegIndex: seg.globalSegIndex,
          trackIndex:  seg.trackIndex,
          pointIndexInSegment: i,
          precedingTimeMs:  times[i - 1],
          violatingTimeMs:  times[i],
          details: `trkseg[${seg.globalSegIndex}] (track ${seg.trackIndex}): ` +
            `timestamp at usable-time position ${i} (${times[i]}) precedes position ${i - 1} (${times[i - 1]})`
        });
      }
    }
  });

  const interFaults = detectInterSegmentFaults(summaries, coords, mergedParams);

  return {
    faults: [...intraFaults, ...interFaults],
    segmentSummaries: summaries
  };
}
