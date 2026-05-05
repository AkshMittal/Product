'use strict';

/**
 * packages/correction/pre-segment/participation-check.js
 *
 * Computes the global `participation` slice and per-segment SegmentParticipationProfile[]
 * (plan §Per-segment eligibility, ADR-0002 / ADR-0007).
 *
 * Mode evaluation (global AND per-segment) — same priority order:
 *   IF parseableTimestampPointCount === 0
 *     → mode = 'geometry-only'  (no usable timeMs at all)
 *
 *   ELSE IF parseableTimestampPointCount > 0 AND hasAnyPositiveTimeDelta === false
 *     → mode = 'geometry-only'  (all usable times identical → no temporal ordering)
 *
 *   ELSE IF coverageRatio < minTimestampPairCoverageRatio (default 0.8)
 *     → mode = 'timestamp-sparse'
 *
 *   ELSE
 *     → mode = 'full'
 *
 *   isFullyReversed candidacy is computed independently when the segment has ≥ 2
 *   parseable times and every consecutive time-pair has Δt < 0 — i.e. the
 *   segment is strictly time-decreasing. The reversal-check phase decides whether
 *   to apply.
 *
 * Coverage ratio = positiveTimeDeltaCount / consecutiveTimestampPairsCount
 *   (or 0 when there are no consecutive timestamp pairs).
 *
 * This module never mutates points and never drops them — `participation` is a
 * pure read/derive over audit + points.
 */

var defaults = require('../params/defaults');

/**
 * @param {Array<Object>} points
 * @param {Object} auditJson
 * @param {Object} [params] - {minTimestampPairCoverageRatio?:number}
 * @returns {{
 *   participation: { mode:string, coverageRatio:number, reasons:string[] },
 *   segmentParticipationProfiles: Array<{
 *     trkSegIndex:number, mode:string, hasAnomalies:boolean, hasUsableTimes:boolean,
 *     coverageRatio:number, isFullyReversed:boolean,
 *     spineEnvelope:{ minTimeMs:null, maxTimeMs:null },
 *     iterationsRun:number, exitReason:string|null,
 *     correctionIdle:boolean
 *   }>,
 *   perSegmentView: { pointBySegment: Map, perSegmentTags: Map, global: Object }
 * }}
 */
function checkParticipation(points, auditJson, params) {
  var minRatio = (params && params.minTimestampPairCoverageRatio) || defaults.minTimestampPairCoverageRatio;
  var audit    = (auditJson && auditJson.audit) || {};
  var temporal = audit.temporal || {};
  var sampling = audit.sampling || {};

  // ── Build pointBySegment from points ──────────────────────────────────────
  var pointBySegment = new Map();
  for (var i = 0; i < points.length; i++) {
    var p = points[i];
    if (!pointBySegment.has(p.trkSegIndex)) pointBySegment.set(p.trkSegIndex, []);
    pointBySegment.get(p.trkSegIndex).push(p);
  }

  // ── Build perSegmentTags from audit.temporal.perSegment[] ─────────────────
  // Each entry now carries tagIndex (gpxIndex arrays) + pair counts directly
  // from the audit layer (Phase B — no adapter bridging).
  var perSegmentTags = new Map();
  var globalConsecutive = 0, globalPositive = 0, globalParseable = 0;
  var globalHasPositive = false;

  var perSegmentAudit = temporal.perSegment || [];
  for (var ai = 0; ai < perSegmentAudit.length; ai++) {
    var seg = perSegmentAudit[ai];
    var ti = seg.tagIndex || {};
    var tags = {
      belowAnchor:                    ti.belowAnchor       || [],
      belowPrevValid:                 ti.belowPrevValid     || [],
      nonAdjacentRepeat:              ti.nonAdjacentRepeat  || [],
      adjacentDuplicate:              ti.adjacentDuplicate  || [],
      missing:                        ti.missing            || [],
      unparsable:                     ti.unparsable         || [],
      consecutiveTimestampPairsCount: seg.consecutiveTimestampPairsCount || 0,
      positiveTimeDeltaCount:         seg.positiveTimeDeltaCount         || 0,
      parseableTimestampPointCount:   seg.parseableTimestampPointCount   || 0,
      hasAnyPositiveTimeDelta:        seg.hasAnyPositiveTimeDelta        || false
    };
    perSegmentTags.set(seg.trkSegIndex, tags);
    globalConsecutive += tags.consecutiveTimestampPairsCount;
    globalPositive    += tags.positiveTimeDeltaCount;
    globalParseable   += tags.parseableTimestampPointCount;
    if (tags.hasAnyPositiveTimeDelta) globalHasPositive = true;
  }

  // For segments absent from audit (no temporal data), derive counts from points.
  pointBySegment.forEach(function(segPts, segIdx) {
    if (perSegmentTags.has(segIdx)) return;
    var parseableCount = 0, consecutivePairs = 0, positiveDeltas = 0, hasPositive = false;
    var lastWasParseable = false, lastTimeMs = null;
    for (var k = 0; k < segPts.length; k++) {
      var sp = segPts[k];
      var ok = (typeof sp.timeMs === 'number' && isFinite(sp.timeMs) && sp.timeMs > 0);
      if (ok) parseableCount++;
      if (ok && lastWasParseable) {
        consecutivePairs++;
        if (sp.timeMs > lastTimeMs) { positiveDeltas++; hasPositive = true; }
      }
      lastWasParseable = ok;
      lastTimeMs = ok ? sp.timeMs : lastTimeMs;
    }
    var fb = {
      belowAnchor: [], belowPrevValid: [], nonAdjacentRepeat: [],
      adjacentDuplicate: [], missing: [], unparsable: [],
      consecutiveTimestampPairsCount: consecutivePairs,
      positiveTimeDeltaCount:         positiveDeltas,
      parseableTimestampPointCount:   parseableCount,
      hasAnyPositiveTimeDelta:        hasPositive
    };
    perSegmentTags.set(segIdx, fb);
    globalConsecutive += consecutivePairs;
    globalPositive    += positiveDeltas;
    globalParseable   += parseableCount;
    if (hasPositive) globalHasPositive = true;
  });

  // Prefer audit's authoritative global values when present.
  var samplingTime = (sampling.time && sampling.time.timestampContext) || {};
  if (typeof samplingTime.consecutiveTimestampPairsCount === 'number') globalConsecutive = samplingTime.consecutiveTimestampPairsCount;
  if (typeof samplingTime.positiveTimeDeltaCount         === 'number') globalPositive    = samplingTime.positiveTimeDeltaCount;
  if (typeof samplingTime.timestampedPointsCount         === 'number') globalParseable   = samplingTime.timestampedPointsCount;
  if (typeof samplingTime.hasAnyPositiveTimeDelta        === 'boolean') globalHasPositive = samplingTime.hasAnyPositiveTimeDelta;

  var global = {
    parseableTimestampPointCount:   globalParseable,
    hasAnyPositiveTimeDelta:        globalHasPositive,
    consecutiveTimestampPairsCount: globalConsecutive,
    positiveTimeDeltaCount:         globalPositive
  };

  // ── Global mode evaluation ─────────────────────────────────────────────────
  var globalCoverage = (global.consecutiveTimestampPairsCount > 0)
    ? global.positiveTimeDeltaCount / global.consecutiveTimestampPairsCount : 0;
  var globalMode;
  var globalReasons = [];
  if (global.parseableTimestampPointCount === 0) {
    globalMode = 'geometry-only';
    globalReasons.push('no-parseable-timestamps');
  } else if (global.hasAnyPositiveTimeDelta === false) {
    globalMode = 'geometry-only';
    globalReasons.push('all-timestamps-uniform');
  } else if (globalCoverage < minRatio) {
    globalMode = 'timestamp-sparse';
    globalReasons.push('insufficient-pair-coverage');
  } else {
    globalMode = 'full';
  }

  // ── Per-segment evaluation ─────────────────────────────────────────────────
  var profiles = [];
  pointBySegment.forEach(function(segPts, segIdx) {
    var tags = perSegmentTags.get(segIdx) || {};
    var coverage = (tags.consecutiveTimestampPairsCount > 0)
      ? tags.positiveTimeDeltaCount / tags.consecutiveTimestampPairsCount : 0;
    var hasUsableTimes = tags.parseableTimestampPointCount >= 2;
    var hasAnomalies = (
      (tags.belowAnchor || []).length > 0 ||
      (tags.belowPrevValid || []).length > 0 ||
      (tags.nonAdjacentRepeat || []).length > 0 ||
      (tags.adjacentDuplicate || []).length > 0
    );

    // isFullyReversed: every stream-adjacent consecutive parseable pair is strictly
    // decreasing AND there is ≥1 such pair.
    var isFullyReversed = false;
    if (tags.parseableTimestampPointCount >= 2) {
      var rfLastOk = false, rfLastT = null, rfDec = 0, rfTotal = 0;
      for (var ri = 0; ri < segPts.length; ri++) {
        var rp = segPts[ri];
        var rpOk = (typeof rp.timeMs === 'number' && isFinite(rp.timeMs) && rp.timeMs > 0);
        if (rpOk && rfLastOk) {
          rfTotal++;
          if (rp.timeMs < rfLastT) rfDec++;
        }
        rfLastOk = rpOk;
        if (rpOk) rfLastT = rp.timeMs;
      }
      isFullyReversed = (rfTotal >= 1 && rfDec === rfTotal);
    }

    var mode;
    if (tags.parseableTimestampPointCount === 0) {
      mode = 'geometry-only';
    } else if (tags.hasAnyPositiveTimeDelta === false && !isFullyReversed) {
      mode = 'geometry-only';
    } else if (isFullyReversed) {
      mode = 'fully-reversed';
    } else if (coverage < minRatio) {
      mode = 'timestamp-sparse';
    } else {
      mode = 'full';
    }

    profiles.push({
      trkSegIndex:     segIdx,
      mode:            mode,
      hasAnomalies:    hasAnomalies,
      hasUsableTimes:  hasUsableTimes,
      coverageRatio:   coverage,
      isFullyReversed: isFullyReversed,
      spineEnvelope:   { minTimeMs: null, maxTimeMs: null },
      iterationsRun:   0,
      exitReason:      null,
      correctionIdle:  false
    });
  });

  profiles.sort(function(a, b) { return a.trkSegIndex - b.trkSegIndex; });

  return {
    participation: {
      mode:          globalMode,
      coverageRatio: globalCoverage,
      reasons:       globalReasons
    },
    segmentParticipationProfiles: profiles,
    perSegmentView: { pointBySegment: pointBySegment, perSegmentTags: perSegmentTags, global: global }
  };
}

module.exports = { checkParticipation };
