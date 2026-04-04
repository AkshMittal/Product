/** Regenerates adversarial GPX + audit JSON + EXPECTED.md; writes REPORT.md unless ADVERSARIAL_SKIP_REPORT=1. */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const FIXTURE_GPX_DIR = path.join(ROOT, "fixtures", "adversarial-custom-test", "gpx");
const FIXTURE_DOC_DIR = path.join(ROOT, "fixtures", "adversarial-custom-test");
const FIXTURE_JSON_DIR = path.join(ROOT, "fixtures", "adversarial-custom-test", "json");
const REPORT_PATH = path.join(FIXTURE_DOC_DIR, "REPORT.md");
const EXPECTED_PATH = path.join(FIXTURE_DOC_DIR, "EXPECTED.md");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function isoAt(baseIso, plusSec) {
  const ms = Date.parse(baseIso) + plusSec * 1000;
  return new Date(ms).toISOString();
}

function asCoord(value) {
  return Number(value.toFixed(6));
}

function buildLinearTrack(config) {
  const {
    count,
    startLat,
    startLon,
    latStep,
    lonStep,
    baseIso,
    dtSec,
    mutator
  } = config;
  const points = [];
  for (let i = 0; i < count; i++) {
    points.push({
      lat: asCoord(startLat + i * latStep),
      lon: asCoord(startLon + i * lonStep),
      time: isoAt(baseIso, i * dtSec)
    });
  }
  if (typeof mutator === "function") {
    mutator(points);
  }
  return points;
}

function trkptXml(point) {
  const lat = point.rawLat !== undefined ? point.rawLat : point.lat;
  const lon = point.rawLon !== undefined ? point.rawLon : point.lon;
  const hasTime = Object.prototype.hasOwnProperty.call(point, "time");
  const timeLine = hasTime && point.time !== null ? `<time>${point.time}</time>` : "";
  const eleLine =
    point.omitEle === true
      ? ""
      : `<ele>${point.ele !== undefined ? point.ele : 100}</ele>`;
  return `      <trkpt lat="${lat}" lon="${lon}">${eleLine}${timeLine}</trkpt>`;
}

function toTrackGpx(points, trackName) {
  const trkpts = points.map(trkptXml).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="gpx-audit-adversarial-suite" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${trackName}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>
`;
}

function toMixedPointTypeGpx(name, baseIso) {
  const wpt = `<wpt lat="12.971600" lon="77.594600"><ele>100</ele><time>${isoAt(baseIso, 0)}</time></wpt>`;
  const rtept = `<rte><name>route-a</name><rtept lat="12.971700" lon="77.594700"><ele>101</ele><time>${isoAt(baseIso, 5)}</time></rtept><rtept lat="12.971800" lon="77.594800"><ele>102</ele><time>${isoAt(baseIso, 10)}</time></rtept></rte>`;
  const trkpt = `<trk><name>${name}</name><trkseg><trkpt lat="12.971900" lon="77.594900"><ele>103</ele><time>${isoAt(baseIso, 15)}</time></trkpt><trkpt lat="12.972000" lon="77.595000"><ele>104</ele><time>${isoAt(baseIso, 20)}</time></trkpt></trkseg></trk>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="gpx-audit-adversarial-suite" xmlns="http://www.topografix.com/GPX/1/1">
  ${wpt}
  ${rtept}
  ${trkpt}
</gpx>
`;
}

function loadBrowserModules() {
  const { JSDOM } = require("jsdom");
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  global.window = dom.window;
  global.document = dom.window.document;
  global.DOMParser = dom.window.DOMParser;
  global.Blob = dom.window.Blob;
  global.URL = dom.window.URL;

  const moduleFiles = [
    path.join(ROOT, "packages", "audit", "pipeline", "gpx-ingestion-module.js"),
    path.join(ROOT, "packages", "audit", "pipeline", "timestamp-audit.js"),
    path.join(ROOT, "packages", "audit", "pipeline", "sampling-audit.js"),
    path.join(ROOT, "packages", "audit", "pipeline", "motion-audit.js"),
    path.join(ROOT, "packages", "audit", "pipeline", "elevation-audit.js"),
    path.join(ROOT, "packages", "audit", "pipeline", "audit-export-module.js")
  ];

  for (const filePath of moduleFiles) {
    const code = fs.readFileSync(filePath, "utf8");
    vm.runInThisContext(code, { filename: filePath });
  }
}

function metric(payload) {
  const ingestion = payload.audit.ingestion || {};
  const temporal = payload.audit.temporal || {};
  const sampling = payload.audit.sampling || {};
  const motion = payload.audit.motion || {};
  const elevation = payload.audit.elevation || {};
  const motionConsecutive =
    motion.summary && typeof motion.summary.consecutivePairCount === "number"
      ? motion.summary.consecutivePairCount
      : null;
  const motionTaggedPairCount = Array.isArray(motion.pairAnnotations)
    ? motion.pairAnnotations.length
    : null;
  const motionCleanAdjacentPairs =
    motionConsecutive !== null && motionTaggedPairCount !== null
      ? motionConsecutive - motionTaggedPairCount
      : null;
  const samplingDistancePairs =
    sampling.distance &&
    sampling.distance.pairInspection &&
    typeof sampling.distance.pairInspection.consecutivePairCount === "number"
      ? sampling.distance.pairInspection.consecutivePairCount
      : null;
  const samplingTimestampPairs =
    sampling.time &&
    sampling.time.timestampContext &&
    typeof sampling.time.timestampContext.consecutiveTimestampPairsCount === "number"
      ? sampling.time.timestampContext.consecutiveTimestampPairsCount
      : null;
  return {
    totalPoints: ingestion.counts ? ingestion.counts.totalPointCount : null,
    hasMultiplePointTypes: ingestion.context ? ingestion.context.hasMultiplePointTypes : null,
    rejectedCoords: ingestion.counts ? ingestion.counts.rejectedPointCount : null,
    // Temporal: reads from tag-based schema (tagCounts)
    missingTs: temporal.tagCounts ? temporal.tagCounts.missing : null,
    unparsableTs: temporal.tagCounts ? temporal.tagCounts.unparsable : null,
    duplicateTs: temporal.tagCounts ? temporal.tagCounts.adjacentDuplicate : null,
    backtracking: temporal.tagCounts ? temporal.tagCounts.belowAnchor : null,
    belowPrevValidCount: temporal.tagCounts ? temporal.tagCounts.belowPrevValid : null,
    nonAdjacentRepeatCount: temporal.tagCounts ? temporal.tagCounts.nonAdjacentRepeat : null,
    annotationCount: temporal.pointAnnotations ? temporal.pointAnnotations.length : null,
    positiveDeltas: sampling.time && sampling.time.deltaStatistics ? sampling.time.deltaStatistics.positiveDeltaCount : null,
    clusterCountSorted: sampling.time && sampling.time.clustering ? sampling.time.clustering.sortedClusterCount : null,
    maxDeltaMs: sampling.time && sampling.time.deltaStatistics ? sampling.time.deltaStatistics.maxMs : null,
    // motionForwardValid = consecutivePairCount - pairAnnotations.length (clean adjacent pairs; not stored on payload).
    motionForwardValid: motionCleanAdjacentPairs,
    motionBackward: motion.tagCounts ? motion.tagCounts.backwardTime : null,
    motionZeroDelta: motion.tagCounts ? motion.tagCounts.zeroTimeDelta : null,
    motionInvalidDistance: motion.tagCounts ? motion.tagCounts.nonFiniteDistance : null,
    motionTimeUnresolvable: motion.tagCounts ? motion.tagCounts.timeUnresolvable : null,
    motionEleUnresolvable: motion.tagCounts ? motion.tagCounts.eleUnresolvable : null,
    motionConsecutivePairs: motionConsecutive,
    motionTaggedPairCount: motionTaggedPairCount,
    samplingDistancePairs: samplingDistancePairs,
    samplingTimestampPairs: samplingTimestampPairs,
    eleMissing: elevation.tagCounts ? elevation.tagCounts.missing : null,
    eleUnparsable: elevation.tagCounts ? elevation.tagCounts.unparsable : null,
    eleOutOfBounds: elevation.tagCounts ? elevation.tagCounts.outOfBounds : null,
    eleAdjacentDuplicates: elevation.tagCounts ? elevation.tagCounts.adjacentDuplicate : null,
    eleValidCount: typeof elevation.validElevationPointCount === 'number' ? elevation.validElevationPointCount : null,
    eleAnnotationCount: elevation.pointAnnotations ? elevation.pointAnnotations.length : null
  };
}

function expectAtLeast(value, threshold) {
  return typeof value === "number" && value >= threshold;
}

function expectEq(value, expected) {
  return value === expected;
}

function runCase(caseDef) {
  const xml = typeof caseDef.xmlBuilder === "function"
    ? caseDef.xmlBuilder()
    : toTrackGpx(caseDef.pointsBuilder(), caseDef.id);

  const gpxPath = path.join(FIXTURE_GPX_DIR, `${caseDef.id}.gpx`);
  fs.writeFileSync(gpxPath, xml, "utf8");

  const parsed = parseGPX(xml);
  const points = parsed.points;
  const temporalResult = auditTimestamps(points);
  const samplingResult = auditSampling(points, caseDef.id);
  const motionResult = auditMotion(points);
  const elevationResult = auditElevation(points);

  const payload = buildAuditExportPayload({
    fileName: `${caseDef.id}.gpx`,
    totalPointCount: parsed.audit.ingestion.counts.totalPointCount,
    ingestionAudit: parsed.audit.ingestion,
    temporalAudit: temporalResult.audit.temporal,
    samplingAudit: samplingResult.audit.sampling,
    motionAudit: motionResult.audit.motion,
    elevationAudit: elevationResult.audit.elevation
  });

  const jsonPath = path.join(FIXTURE_JSON_DIR, `${caseDef.id}.audit.v2.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), "utf8");

  const m = metric(payload);
  const checks = caseDef.expectedChecks.map((check) => {
    const actual = m[check.key];
    const ok = check.kind === "eq"
      ? expectEq(actual, check.value)
      : expectAtLeast(actual, check.value);
    return {
      description: check.description,
      key: check.key,
      expected: `${check.kind} ${check.value}`,
      actual: actual,
      pass: ok,
      allowExpectedVariance: check.allowExpectedVariance === true
    };
  });

  const hasHardFailure = checks.some((c) => !c.pass && !c.allowExpectedVariance);
  const hasExpectedVariance = checks.some((c) => !c.pass && c.allowExpectedVariance);
  let status = "PASS";
  if (hasHardFailure) {
    status = "FAIL";
  } else if (hasExpectedVariance) {
    status = "EXPECTED_VARIANCE";
  }

  return {
    caseId: caseDef.id,
    title: caseDef.title,
    rationale: caseDef.rationale,
    metrics: m,
    checks: checks,
    status: status,
    allPass: status !== "FAIL"
  };
}

function buildCases() {
  const baseIso = "2026-02-14T00:00:00.000Z";
  return [
    {
      id: "adv-01-exact-2pct-boundary",
      title: "Exactly 2% clustering boundary",
      rationale: "Values exactly 2% apart should not merge under strict '< 0.02' rule.",
      pointsBuilder: () => {
        const pts = buildLinearTrack({
          count: 8,
          startLat: 12.9716,
          startLon: 77.5946,
          latStep: 0.0001,
          lonStep: 0.00005,
          baseIso,
          dtSec: 10
        });
        const deltas = [10, 10.2, 10, 10.2, 10, 10.2, 10];
        let running = 0;
        pts[0].time = isoAt(baseIso, 0);
        for (let i = 1; i < pts.length; i++) {
          running += deltas[i - 1];
          pts[i].time = isoAt(baseIso, running);
        }
        return pts;
      },
      expectedChecks: [
        {
          description: "Clusters may split at exact 2% boundary (local-center chaining can keep one cluster)",
          key: "clusterCountSorted",
          kind: "atLeast",
          value: 2,
          allowExpectedVariance: true
        },
        { description: "Positive deltas are still collected", key: "positiveDeltas", kind: "eq", value: 7 }
      ]
    },
    {
      id: "adv-02-near-boundary-float",
      title: "Near-boundary floating precision",
      rationale: "Very near-boundary deltas should remain stable and finite.",
      pointsBuilder: () => {
        const pts = buildLinearTrack({
          count: 8,
          startLat: 12.9716,
          startLon: 77.5946,
          latStep: 0.00009,
          lonStep: 0.00005,
          baseIso,
          dtSec: 10
        });
        const deltas = [10, 10.1999999, 10.2000001, 10, 10.1999999, 10.2000001, 10];
        let running = 0;
        pts[0].time = isoAt(baseIso, 0);
        for (let i = 1; i < pts.length; i++) {
          running += deltas[i - 1];
          pts[i].time = isoAt(baseIso, running);
        }
        return pts;
      },
      expectedChecks: [
        {
          description: "At least two regimes may be detected (boundary precision can collapse to one cluster)",
          key: "clusterCountSorted",
          kind: "atLeast",
          value: 2,
          allowExpectedVariance: true
        },
        { description: "No nonFiniteDistance motion pairs", key: "motionInvalidDistance", kind: "eq", value: 0 }
      ]
    },
    {
      id: "adv-03-single-valid-timestamp",
      title: "Single valid timestamp only",
      rationale: "No pairs should be time-valid when only one timestamp is parseable.",
      pointsBuilder: () => {
        const pts = buildLinearTrack({
          count: 7,
          startLat: 12.9716,
          startLon: 77.5946,
          latStep: 0.00007,
          lonStep: 0.00004,
          baseIso,
          dtSec: 2
        });
        for (let i = 0; i < pts.length; i++) {
          if (i === 3) {
            pts[i].time = isoAt(baseIso, 6);
          } else {
            pts[i].time = i % 2 === 0 ? null : `INVALID_TS_${i}`;
          }
        }
        return pts;
      },
      expectedChecks: [
        { description: "No positive delta pairs", key: "positiveDeltas", kind: "eq", value: 0 },
        { description: "No motion-clean adjacent pairs (every pair has a tag)", key: "motionForwardValid", kind: "eq", value: 0 }
      ]
    },
    {
      id: "adv-04-all-identical-timestamps",
      title: "All timestamps identical",
      rationale: "Should produce duplicate timestamp tags and zero-time-delta motion pair flags.",
      pointsBuilder: () => {
        const pts = buildLinearTrack({
          count: 8,
          startLat: 12.9716,
          startLon: 77.5946,
          latStep: 0.00006,
          lonStep: 0.00006,
          baseIso,
          dtSec: 1
        });
        for (let i = 0; i < pts.length; i++) {
          pts[i].time = isoAt(baseIso, 10);
        }
        return pts;
      },
      expectedChecks: [
        { description: "Duplicate timestamps detected", key: "duplicateTs", kind: "atLeast", value: 1 },
        { description: "At least one zeroTimeDelta motion pair", key: "motionZeroDelta", kind: "atLeast", value: 1 }
      ]
    },
    {
      id: "adv-05-alternating-backtracking",
      title: "Alternating forward/backtracking",
      rationale: "Backtracking points should be detected repeatedly without forced block inflation.",
      pointsBuilder: () => {
        const pts = buildLinearTrack({
          count: 7,
          startLat: 12.9716,
          startLon: 77.5946,
          latStep: 0.0001,
          lonStep: 0.00003,
          baseIso,
          dtSec: 1
        });
        const absoluteSec = [0, 10, 5, 15, 12, 20, 18];
        for (let i = 0; i < pts.length; i++) {
          pts[i].time = isoAt(baseIso, absoluteSec[i]);
        }
        return pts;
      },
      expectedChecks: [
        { description: "belowAnchor tag count equals 3 (each point is behind the monotonic high-water mark)", key: "backtracking", kind: "eq", value: 3 },
        { description: "Motion backward pair count equals 3", key: "motionBackward", kind: "eq", value: 3 }
      ]
    },
    {
      id: "adv-06-large-forward-jump",
      title: "Single large forward jump outlier",
      rationale: "Outlier should increase max delta and often add a cluster.",
      pointsBuilder: () => {
        const pts = buildLinearTrack({
          count: 10,
          startLat: 12.9716,
          startLon: 77.5946,
          latStep: 0.00008,
          lonStep: 0.00004,
          baseIso,
          dtSec: 1
        });
        const absoluteSec = [0, 1, 2, 3, 4, 304, 305, 306, 307, 308];
        for (let i = 0; i < pts.length; i++) {
          pts[i].time = isoAt(baseIso, absoluteSec[i]);
        }
        return pts;
      },
      expectedChecks: [
        { description: "Max delta includes outlier jump", key: "maxDeltaMs", kind: "atLeast", value: 300000 },
        { description: "At least two clusters due to mixed regimes", key: "clusterCountSorted", kind: "atLeast", value: 2 }
      ]
    },
    {
      id: "adv-07-dateline-crossing",
      title: "Dateline crossing distance",
      rationale: "Crossing +179.9/-179.9 should remain finite.",
      pointsBuilder: () => {
        const pts = [];
        const lons = [179.9, -179.9, 179.8, -179.8, 179.7, -179.7];
        for (let i = 0; i < lons.length; i++) {
          pts.push({
            lat: 0.2 + i * 0.01,
            lon: lons[i],
            time: isoAt(baseIso, i * 5)
          });
        }
        return pts;
      },
      expectedChecks: [
        { description: "No nonFiniteDistance motion pairs", key: "motionInvalidDistance", kind: "eq", value: 0 },
        { description: "Five motion-clean adjacent pairs", key: "motionForwardValid", kind: "eq", value: 5 }
      ]
    },
    {
      id: "adv-08-polar-latitude",
      title: "High-latitude geometry stress",
      rationale: "Near-pole coordinates should still compute finite haversine distances.",
      pointsBuilder: () => {
        const pts = [];
        for (let i = 0; i < 8; i++) {
          pts.push({
            lat: 89.9 - i * 0.0001,
            lon: -45 + i * 0.2,
            time: isoAt(baseIso, i * 3)
          });
        }
        return pts;
      },
      expectedChecks: [
        { description: "No nonFiniteDistance motion pairs", key: "motionInvalidDistance", kind: "eq", value: 0 },
        { description: "Positive deltas exist", key: "positiveDeltas", kind: "eq", value: 7 }
      ]
    },
    {
      id: "adv-09-mixed-point-types",
      title: "Mixed GPX point types",
      rationale: "Ingestion should flag multi-point-type context correctly.",
      xmlBuilder: () => toMixedPointTypeGpx("adv-09-mixed-point-types", baseIso),
      expectedChecks: [
        { description: "Multiple point types detected", key: "hasMultiplePointTypes", kind: "eq", value: true },
        { description: "Total points include wpt+rtept+trkpt", key: "totalPoints", kind: "eq", value: 5 }
      ]
    },
    {
      id: "adv-10-timestamp-format-variants",
      title: "Timestamp format variants",
      rationale: "Valid variants parse; malformed strings are counted as unparsable.",
      pointsBuilder: () => {
        const pts = buildLinearTrack({
          count: 8,
          startLat: 12.9716,
          startLon: 77.5946,
          latStep: 0.00005,
          lonStep: 0.00005,
          baseIso,
          dtSec: 5
        });
        pts[0].time = "2026-02-14T00:00:00Z";
        pts[1].time = "2026-02-14T05:30:05+05:30";
        pts[2].time = "2026-02-14T00:00:10.500Z";
        pts[3].time = "2026-02-14T00:00:15Z";
        pts[4].time = "INVALID_TIMESTAMP_A";
        pts[5].time = "INVALID_TIMESTAMP_B";
        pts[6].time = "2026-02-14T00:00:30Z";
        pts[7].time = "2026-02-14T00:00:35Z";
        return pts;
      },
      expectedChecks: [
        { description: "Unparsable timestamps counted", key: "unparsableTs", kind: "atLeast", value: 2 },
        { description: "Still has some positive deltas", key: "positiveDeltas", kind: "atLeast", value: 1 }
      ]
    },
    {
      id: "adv-11-backtracking-after-invalid-gap",
      title: "Backtracking after missing/unparsable gap",
      rationale: "Anchor-based backtracking should survive invalid timestamp gaps.",
      pointsBuilder: () => {
        const pts = buildLinearTrack({
          count: 7,
          startLat: 12.9716,
          startLon: 77.5946,
          latStep: 0.00005,
          lonStep: 0.00007,
          baseIso,
          dtSec: 10
        });
        pts[0].time = isoAt(baseIso, 0);
        pts[1].time = isoAt(baseIso, 10);
        pts[2].time = null;
        pts[3].time = "INVALID_GAP";
        pts[4].time = isoAt(baseIso, 4);
        pts[5].time = isoAt(baseIso, 20);
        pts[6].time = isoAt(baseIso, 25);
        return pts;
      },
      expectedChecks: [
        { description: "Missing timestamp present", key: "missingTs", kind: "atLeast", value: 1 },
        { description: "Unparsable timestamp present", key: "unparsableTs", kind: "atLeast", value: 1 },
        { description: "Backtracking is detected after invalid gap", key: "backtracking", kind: "atLeast", value: 1 }
      ]
    },
    {
      id: "adv-12-large-scale-20k",
      title: "Large scale 20k points",
      rationale: "Volume stress: validates count/ratio stability at scale.",
      pointsBuilder: () => buildLinearTrack({
        count: 20000,
        startLat: 12.9716,
        startLon: 77.5946,
        latStep: 0.000001,
        lonStep: 0.000001,
        baseIso,
        dtSec: 1
      }),
      expectedChecks: [
        { description: "No coordinate rejections", key: "rejectedCoords", kind: "eq", value: 0 },
        { description: "Expected positive delta count", key: "positiveDeltas", kind: "eq", value: 19999 },
        { description: "All 19,999 adjacent motion pairs clean", key: "motionForwardValid", kind: "eq", value: 19999 }
      ]
    },
    {
      id: "adv-13-mixed-all-anomalies",
      title: "Mixed anomalies in one track",
      rationale: "Combines ingestion reject + missing + unparsable + duplicate + backtracking.",
      pointsBuilder: () => {
        const pts = buildLinearTrack({
          count: 14,
          startLat: 12.9716,
          startLon: 77.5946,
          latStep: 0.00008,
          lonStep: 0.00005,
          baseIso,
          dtSec: 4
        });
        pts[2] = { rawLat: "not-a-lat", rawLon: "77.5948", time: isoAt(baseIso, 8) };
        pts[4].time = null;
        pts[5].time = "INVALID_MIXED_TS";
        pts[7].time = pts[6].time;
        pts[10].time = isoAt(baseIso, 12);
        return pts;
      },
      expectedChecks: [
        { description: "At least one coordinate rejection", key: "rejectedCoords", kind: "atLeast", value: 1 },
        { description: "Missing timestamp detected", key: "missingTs", kind: "atLeast", value: 1 },
        { description: "Unparsable timestamp detected", key: "unparsableTs", kind: "atLeast", value: 1 },
        { description: "Duplicate timestamp detected", key: "duplicateTs", kind: "atLeast", value: 1 },
        { description: "Backtracking detected", key: "backtracking", kind: "atLeast", value: 1 }
      ]
    },
    {
      id: "adv-14-multi-trkseg-backtrack",
      title: "Multiple track segments with cross-segment backtrack",
      rationale: "Ensures chronological regressions across trkseg boundaries are detected.",
      xmlBuilder: () => `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="gpx-audit-adversarial-suite" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>adv-14-multi-trkseg-backtrack</name>
    <trkseg>
      <trkpt lat="12.9716" lon="77.5946"><ele>100</ele><time>${isoAt(baseIso, 0)}</time></trkpt>
      <trkpt lat="12.9717" lon="77.5947"><ele>100</ele><time>${isoAt(baseIso, 5)}</time></trkpt>
      <trkpt lat="12.9718" lon="77.5948"><ele>100</ele><time>${isoAt(baseIso, 10)}</time></trkpt>
    </trkseg>
    <trkseg>
      <trkpt lat="12.9719" lon="77.5949"><ele>100</ele><time>${isoAt(baseIso, 4)}</time></trkpt>
      <trkpt lat="12.9720" lon="77.5950"><ele>100</ele><time>${isoAt(baseIso, 15)}</time></trkpt>
      <trkpt lat="12.9721" lon="77.5951"><ele>100</ele><time>${isoAt(baseIso, 20)}</time></trkpt>
    </trkseg>
  </trk>
</gpx>
`,
      expectedChecks: [
        { description: "Backtracking detected across segments", key: "backtracking", kind: "atLeast", value: 1 },
        { description: "At least one backwardTime motion pair", key: "motionBackward", kind: "atLeast", value: 1 }
      ]
    },
    {
      id: "adv-15-static-geometry-long",
      title: "Long static geometry with valid progressing time",
      rationale: "Zero movement with monotonic time: every adjacent pair should be clean for motion (finite haversine, forward dt, resolvable time, valid ele).",
      pointsBuilder: () => buildLinearTrack({
        count: 120,
        startLat: 12.9716,
        startLon: 77.5946,
        latStep: 0,
        lonStep: 0,
        baseIso,
        dtSec: 1
      }),
      expectedChecks: [
        { description: "No nonFiniteDistance motion pairs", key: "motionInvalidDistance", kind: "eq", value: 0 },
        { description: "All adjacent motion pairs clean (no tags)", key: "motionForwardValid", kind: "eq", value: 119 },
        { description: "No backward-time motion pairs", key: "motionBackward", kind: "eq", value: 0 },
        { description: "No zero-delta motion pairs", key: "motionZeroDelta", kind: "eq", value: 0 }
      ]
    },
    {
      id: "adv-16-boundary-lat-lon-valid",
      title: "Coordinate boundary values",
      rationale: "Latitude/longitude edge values should remain valid and finite.",
      pointsBuilder: () => {
        const pts = [
          { lat: 90.0, lon: 180.0, time: isoAt(baseIso, 0) },
          { lat: 89.999, lon: 179.999, time: isoAt(baseIso, 5) },
          { lat: -89.999, lon: -179.999, time: isoAt(baseIso, 10) },
          { lat: -90.0, lon: -180.0, time: isoAt(baseIso, 15) }
        ];
        return pts;
      },
      expectedChecks: [
        { description: "No coordinate rejections", key: "rejectedCoords", kind: "eq", value: 0 },
        { description: "No nonFiniteDistance motion pairs", key: "motionInvalidDistance", kind: "eq", value: 0 },
        { description: "Positive deltas exist", key: "positiveDeltas", kind: "eq", value: 3 }
      ]
    },
    {
      id: "adv-17-time-parse-fuzz",
      title: "Timestamp parse fuzz",
      rationale: "Mixes very valid and very invalid timestamp strings in one stream.",
      pointsBuilder: () => {
        const pts = buildLinearTrack({
          count: 12,
          startLat: 12.9716,
          startLon: 77.5946,
          latStep: 0.00003,
          lonStep: 0.00002,
          baseIso,
          dtSec: 5
        });
        const custom = [
          "2026-02-14T00:00:00Z",
          "2026-02-14T00:00:05.123Z",
          "2026-02-14T05:30:10+05:30",
          "INVALID_X_1",
          "INVALID_X_2",
          null,
          "INVALID_X_3",
          "2026-02-14T00:00:35Z",
          "2026-13-99T99:99:99Z",
          "2026-02-14T00:00:45Z",
          "INVALID_X_4",
          "2026-02-14T00:00:55Z"
        ];
        for (let i = 0; i < pts.length; i++) {
          pts[i].time = custom[i];
        }
        return pts;
      },
      expectedChecks: [
        { description: "Multiple unparsable timestamps detected", key: "unparsableTs", kind: "atLeast", value: 4 },
        { description: "At least one missing timestamp detected", key: "missingTs", kind: "atLeast", value: 1 },
        { description: "Still yields some positive deltas", key: "positiveDeltas", kind: "atLeast", value: 1 }
      ]
    },
    {
      id: "adv-18-duplicate-singletons",
      title: "Duplicate singletons vs duplicate blocks",
      rationale: "Isolated duplicate events should appear in singleton fields.",
      pointsBuilder: () => {
        const pts = buildLinearTrack({
          count: 10,
          startLat: 12.9716,
          startLon: 77.5946,
          latStep: 0.00004,
          lonStep: 0.00005,
          baseIso,
          dtSec: 3
        });
        pts[3].time = pts[2].time;
        pts[7].time = pts[6].time;
        return pts;
      },
      expectedChecks: [
        { description: "adjacentDuplicate tag count is 2 (two isolated adjacent-duplicate events)", key: "duplicateTs", kind: "eq", value: 2 }
      ]
    },
    {
      id: "adv-19-missing-singletons-and-block",
      title: "Missing singleton and block split",
      rationale: "Ensures single-point missing anomalies are not hidden by block summaries.",
      pointsBuilder: () => {
        const pts = buildLinearTrack({
          count: 11,
          startLat: 12.9716,
          startLon: 77.5946,
          latStep: 0.00003,
          lonStep: 0.00003,
          baseIso,
          dtSec: 2
        });
        pts[2].time = null;
        pts[6].time = null;
        pts[7].time = null;
        return pts;
      },
      expectedChecks: [
        { description: "Three missing timestamp tags total (block-level grouping is downstream concern)", key: "missingTs", kind: "eq", value: 3 }
      ]
    },
    {
      id: "adv-20-seeded-random-walk",
      title: "Seeded random-walk fuzz",
      rationale: "Deterministic pseudo-random walk with sporadic anomalies for robustness.",
      pointsBuilder: () => {
        function lcg(seed) {
          let state = seed >>> 0;
          return function next() {
            state = (1664525 * state + 1013904223) >>> 0;
            return state / 4294967296;
          };
        }
        const rand = lcg(20260214);
        const pts = [];
        let t = 0;
        let lat = 12.9716;
        let lon = 77.5946;
        for (let i = 0; i < 500; i++) {
          lat += (rand() - 0.5) * 0.0002;
          lon += (rand() - 0.5) * 0.0002;
          t += 1 + Math.floor(rand() * 3);
          let timeVal = isoAt(baseIso, t);
          const roll = rand();
          if (roll < 0.02) {
            timeVal = null;
          } else if (roll < 0.04) {
            timeVal = `INVALID_RAND_${i}`;
          } else if (roll < 0.06 && i > 0) {
            timeVal = pts[i - 1].time;
          }
          pts.push({ lat: asCoord(lat), lon: asCoord(lon), time: timeVal });
        }
        return pts;
      },
      expectedChecks: [
        { description: "Some positive deltas collected", key: "positiveDeltas", kind: "atLeast", value: 50 },
        { description: "At least one temporal anomaly detected", key: "missingTs", kind: "atLeast", value: 1 },
        { description: "No nonFiniteDistance motion pair explosion", key: "motionInvalidDistance", kind: "eq", value: 0 }
      ]
    },
    {
      id: "adv-21-nonadjacent-repeat-streamwide",
      title: "Non-adjacent repeat detected stream-wide",
      rationale: "A timestamp value that reappears after intervening valid points should be tagged nonAdjacentRepeat, not adjacentDuplicate. Must also receive belowAnchor and belowPrevValid since the repeat is behind the current high-water mark.",
      pointsBuilder: () => {
        const pts = buildLinearTrack({
          count: 6,
          startLat: 12.9716,
          startLon: 77.5946,
          latStep: 0.0001,
          lonStep: 0.00005,
          baseIso,
          dtSec: 10
        });
        // Stream: T+0, T+10, T+20, T+30, T+10 (non-adjacent repeat), T+40
        const absoluteSec = [0, 10, 20, 30, 10, 40];
        for (let i = 0; i < pts.length; i++) {
          pts[i].time = isoAt(baseIso, absoluteSec[i]);
        }
        return pts;
      },
      expectedChecks: [
        { description: "Exactly one nonAdjacentRepeat tag (T+10 reappears after T+20, T+30)", key: "nonAdjacentRepeatCount", kind: "eq", value: 1 },
        { description: "Exactly one belowAnchor tag (T+10 < anchor=T+30)", key: "backtracking", kind: "eq", value: 1 },
        { description: "Exactly one belowPrevValid tag (T+10 < prevValid=T+30)", key: "belowPrevValidCount", kind: "eq", value: 1 },
        { description: "No adjacentDuplicate tags", key: "duplicateTs", kind: "eq", value: 0 }
      ]
    },
    {
      id: "adv-22-locally-recovering-backtrack",
      title: "Locally recovering backtrack: belowAnchor without belowPrevValid",
      rationale: "After a drop below the anchor, a sequence progressing forward locally is still belowAnchor but is NOT belowPrevValid. Only the initial drop point is belowPrevValid. Tests the tag distinction between 'still in the hole' vs 'actively digging'.",
      pointsBuilder: () => {
        const pts = buildLinearTrack({
          count: 7,
          startLat: 12.9716,
          startLon: 77.5946,
          latStep: 0.0001,
          lonStep: 0.00005,
          baseIso,
          dtSec: 10
        });
        // Stream: T+0, T+100, T+60, T+70, T+80, T+90, T+110
        // T+60 drops below anchor=100 and below prevValid=100 → both tags
        // T+70,80,90 are still belowAnchor=100 but each is above its prevValid → belowAnchor only
        const absoluteSec = [0, 100, 60, 70, 80, 90, 110];
        for (let i = 0; i < pts.length; i++) {
          pts[i].time = isoAt(baseIso, absoluteSec[i]);
        }
        return pts;
      },
      expectedChecks: [
        { description: "Four points tagged belowAnchor (T+60,70,80,90 all < anchor=T+100)", key: "backtracking", kind: "eq", value: 4 },
        { description: "Only one point tagged belowPrevValid (T+60 is the only drop below its predecessor)", key: "belowPrevValidCount", kind: "eq", value: 1 },
        { description: "Four annotation entries total", key: "annotationCount", kind: "eq", value: 4 }
      ]
    },
    {
      id: "adv-23-adjacent-dup-below-anchor",
      title: "Adjacent duplicate that is also below anchor gets both tags",
      rationale: "Tags are non-exclusive. An adjacent duplicate occurring during a backtracking block should simultaneously carry adjacentDuplicate and belowAnchor, but NOT belowPrevValid (equal, not strictly less) and NOT nonAdjacentRepeat (is adjacent).",
      pointsBuilder: () => {
        const pts = buildLinearTrack({
          count: 5,
          startLat: 12.9716,
          startLon: 77.5946,
          latStep: 0.0001,
          lonStep: 0.00005,
          baseIso,
          dtSec: 10
        });
        // Stream: T+0, T+100, T+50, T+50, T+120
        // T+50 (pos2): belowAnchor + belowPrevValid
        // T+50 (pos3): adjacentDuplicate + belowAnchor (NOT belowPrevValid: equal, not strictly less)
        const absoluteSec = [0, 100, 50, 50, 120];
        for (let i = 0; i < pts.length; i++) {
          pts[i].time = isoAt(baseIso, absoluteSec[i]);
        }
        return pts;
      },
      expectedChecks: [
        { description: "One adjacentDuplicate tag (T+50 pos3)", key: "duplicateTs", kind: "eq", value: 1 },
        { description: "Two belowAnchor tags (both T+50 occurrences < anchor=T+100)", key: "backtracking", kind: "eq", value: 2 },
        { description: "One belowPrevValid tag (T+50 pos2 only; pos3 equals prevValid, not strictly less)", key: "belowPrevValidCount", kind: "eq", value: 1 },
        { description: "No nonAdjacentRepeat tags (adjacent duplicate excluded from that check)", key: "nonAdjacentRepeatCount", kind: "eq", value: 0 }
      ]
    },
    {
      id: "adv-24-anchor-no-advance-on-dup",
      title: "Anchor does not advance during adjacent duplicate run",
      rationale: "The monotonic anchor only advances on genuine forward progress. A run of adjacent duplicates must not move the anchor. A belowAnchor point after the dup-run must still be detected correctly.",
      pointsBuilder: () => {
        const pts = buildLinearTrack({
          count: 5,
          startLat: 12.9716,
          startLon: 77.5946,
          latStep: 0.0001,
          lonStep: 0.00005,
          baseIso,
          dtSec: 10
        });
        // Stream: T+0, T+50, T+50, T+50, T+30
        // Three adjacent dups at T+50; anchor stays at T+50
        // T+30 < anchor=T+50 → belowAnchor
        const absoluteSec = [0, 50, 50, 50, 30];
        for (let i = 0; i < pts.length; i++) {
          pts[i].time = isoAt(baseIso, absoluteSec[i]);
        }
        return pts;
      },
      expectedChecks: [
        { description: "Two adjacentDuplicate tags (T+50 pos2 and pos3)", key: "duplicateTs", kind: "eq", value: 2 },
        { description: "One belowAnchor tag (T+30 < anchor=T+50, anchor held steady through dup run)", key: "backtracking", kind: "eq", value: 1 },
        { description: "One belowPrevValid tag (T+30 < prevValid=T+50)", key: "belowPrevValidCount", kind: "eq", value: 1 }
      ]
    },
    {
      id: "adv-25-multi-tag-convergence",
      title: "Single point receives nonAdjacentRepeat + belowAnchor + belowPrevValid simultaneously",
      rationale: "A non-adjacent repeat that falls below the anchor and below its predecessor should carry all three tags in a single annotation object.",
      pointsBuilder: () => {
        const pts = buildLinearTrack({
          count: 5,
          startLat: 12.9716,
          startLon: 77.5946,
          latStep: 0.0001,
          lonStep: 0.00005,
          baseIso,
          dtSec: 10
        });
        // Stream: T+0, T+50, T+60, T+50, T+70
        // T+50 pos3: not adjacent (prev=T+60), seen before at pos1 → nonAdjacentRepeat
        //            T+50 < anchor=T+60 → belowAnchor; T+50 < prevValid=T+60 → belowPrevValid
        const absoluteSec = [0, 50, 60, 50, 70];
        for (let i = 0; i < pts.length; i++) {
          pts[i].time = isoAt(baseIso, absoluteSec[i]);
        }
        return pts;
      },
      expectedChecks: [
        { description: "One nonAdjacentRepeat tag", key: "nonAdjacentRepeatCount", kind: "eq", value: 1 },
        { description: "One belowAnchor tag", key: "backtracking", kind: "eq", value: 1 },
        { description: "One belowPrevValid tag", key: "belowPrevValidCount", kind: "eq", value: 1 },
        { description: "No adjacentDuplicate tags (the non-adjacent repeat is not the immediately preceding point)", key: "duplicateTs", kind: "eq", value: 0 },
        { description: "Exactly one annotation entry", key: "annotationCount", kind: "eq", value: 1 }
      ]
    },
    {
      id: "adv-26-motion-ele-boundary-inclusive",
      title: "Motion ele endpoints exactly at validFloorM and validCeilingM",
      rationale: "Motion audit uses inclusive [-500, 9500]; boundary values must not fire eleUnresolvable.",
      pointsBuilder: () => {
        const pts = buildLinearTrack({
          count: 4,
          startLat: 12.9716,
          startLon: 77.5946,
          latStep: 0.00002,
          lonStep: 0.00002,
          baseIso,
          dtSec: 5
        });
        pts[0].ele = -500;
        pts[1].ele = 9500;
        pts[2].ele = 0;
        pts[3].ele = 100;
        return pts;
      },
      expectedChecks: [
        { description: "No motion ele-unresolvable pairs at inclusive boundaries", key: "motionEleUnresolvable", kind: "eq", value: 0 },
        { description: "All three adjacent pairs clean for motion", key: "motionForwardValid", kind: "eq", value: 3 }
      ]
    },
    {
      id: "adv-27-motion-ele-above-ceiling",
      title: "Elevation above motion validCeilingM flags adjacent pairs",
      rationale: "Any endpoint outside default [validFloorM, validCeilingM] makes every adjacent pair touching it eleUnresolvable (independent of time).",
      pointsBuilder: () => {
        const pts = buildLinearTrack({
          count: 3,
          startLat: 12.9716,
          startLon: 77.5946,
          latStep: 0.00003,
          lonStep: 0.00003,
          baseIso,
          dtSec: 2
        });
        pts[0].ele = 100;
        pts[1].ele = 9600;
        pts[2].ele = 200;
        return pts;
      },
      expectedChecks: [
        { description: "Two pairs affected by one out-of-range spike (prev and next)", key: "motionEleUnresolvable", kind: "eq", value: 2 },
        { description: "Times still forward so no backward motion pairs", key: "motionBackward", kind: "eq", value: 0 }
      ]
    },
    {
      id: "adv-28-motion-omit-ele-element",
      title: "Missing GPX ele element yields motion eleUnresolvable",
      rationale: "Ingestion sets eleAbsent true when <ele> is absent; elevation audit tags missing; motion flags eleUnresolvable on adjacent pairs.",
      pointsBuilder: () => {
        const pts = buildLinearTrack({
          count: 3,
          startLat: 12.9716,
          startLon: 77.5946,
          latStep: 0.00004,
          lonStep: 0.00004,
          baseIso,
          dtSec: 3
        });
        pts[1].omitEle = true;
        return pts;
      },
      expectedChecks: [
        { description: "Middle point without ele tags both adjacent pairs", key: "motionEleUnresolvable", kind: "eq", value: 2 },
        { description: "No non-finite haversine on valid coordinates", key: "motionInvalidDistance", kind: "eq", value: 0 },
        { description: "One missing-ele point (eleAbsent)", key: "eleMissing", kind: "eq", value: 1 },
        { description: "No unparsable ele when absent vs present is distinguished", key: "eleUnparsable", kind: "eq", value: 0 }
      ]
    },
    {
      id: "adv-29-motion-stacked-backward-and-elebad",
      title: "Same pair stacks backwardTime and eleUnresolvable",
      rationale: "Tags are non-exclusive: one adjacent pair can carry multiple motion flags simultaneously.",
      pointsBuilder: () => {
        const pts = buildLinearTrack({
          count: 3,
          startLat: 12.9716,
          startLon: 77.5946,
          latStep: 0.00005,
          lonStep: 0.00005,
          baseIso,
          dtSec: 10
        });
        pts[0].time = isoAt(baseIso, 0);
        pts[1].time = isoAt(baseIso, 20);
        pts[2].time = isoAt(baseIso, 10);
        pts[0].ele = 100;
        pts[1].ele = 100;
        pts[2].ele = 9600;
        return pts;
      },
      expectedChecks: [
        { description: "Exactly one backward-time pair", key: "motionBackward", kind: "eq", value: 1 },
        { description: "Exactly one ele-unresolvable pair (stacked on same pair as backward)", key: "motionEleUnresolvable", kind: "eq", value: 1 },
        { description: "Leading pair still clean", key: "motionForwardValid", kind: "eq", value: 1 }
      ]
    },
    {
      id: "adv-30-motion-mixed-time-backward-zero",
      title: "Single track mixes timeUnresolvable, backward, zero delta, and one clean pair",
      rationale: "Six points, five pairs: trailing null so only (4,5) is timeUnresolvable. Includes zero-delta (2→3) and backward (3→4). Leading pairs (0→1) and (1→2) stay clean.",
      pointsBuilder: () => {
        const pts = buildLinearTrack({
          count: 6,
          startLat: 12.9716,
          startLon: 77.5946,
          latStep: 0.00006,
          lonStep: 0.00006,
          baseIso,
          dtSec: 5
        });
        pts[0].time = isoAt(baseIso, 0);
        pts[1].time = isoAt(baseIso, 10);
        pts[2].time = isoAt(baseIso, 15);
        pts[3].time = isoAt(baseIso, 15);
        pts[4].time = isoAt(baseIso, 5);
        pts[5].time = null;
        return pts;
      },
      expectedChecks: [
        { description: "One pair with missing time only on the second endpoint", key: "motionTimeUnresolvable", kind: "eq", value: 1 },
        { description: "One strictly backward dt pair (15s → 5s)", key: "motionBackward", kind: "eq", value: 1 },
        { description: "One zero-dt pair (15s → 15s)", key: "motionZeroDelta", kind: "eq", value: 1 },
        { description: "Exactly two pairs have no motion tags (first two pairs)", key: "motionForwardValid", kind: "eq", value: 2 }
      ]
    },
    {
      id: "adv-31-single-trackpoint",
      title: "Single trackpoint yields zero motion pairs",
      rationale: "motion.summary.consecutivePairCount is n-1; empty pair lists and zero tag counts.",
      xmlBuilder: () => `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="gpx-audit-adversarial-suite" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>adv-31-single-trackpoint</name>
    <trkseg>
      <trkpt lat="12.971600" lon="77.594600"><ele>100</ele><time>${isoAt(baseIso, 0)}</time></trkpt>
    </trkseg>
  </trk>
</gpx>
`,
      expectedChecks: [
        { description: "No adjacent pairs to evaluate", key: "motionConsecutivePairs", kind: "eq", value: 0 },
        { description: "No motion pair annotations", key: "motionTaggedPairCount", kind: "eq", value: 0 }
      ]
    },
    {
      id: "adv-32-unparsable-ele-element",
      title: "Present but unparsable elevation element",
      rationale: "When <ele> exists but is not numeric, ingestion sets eleAbsent false and ele null; elevation audit tags unparsable, not missing.",
      xmlBuilder: () => `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="gpx-audit-adversarial-suite" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>adv-32-unparsable-ele-element</name>
    <trkseg>
      <trkpt lat="12.971600" lon="77.594600"><ele>100</ele><time>${isoAt(baseIso, 0)}</time></trkpt>
      <trkpt lat="12.971700" lon="77.594700"><ele>not-a-number</ele><time>${isoAt(baseIso, 5)}</time></trkpt>
      <trkpt lat="12.971800" lon="77.594800"><ele>102</ele><time>${isoAt(baseIso, 10)}</time></trkpt>
    </trkseg>
  </trk>
</gpx>
`,
      expectedChecks: [
        { description: "Exactly one unparsable ele point", key: "eleUnparsable", kind: "eq", value: 1 },
        { description: "No missing-ele points when every trkpt has an ele child", key: "eleMissing", kind: "eq", value: 0 },
        { description: "Two valid in-bounds ele points", key: "eleValidCount", kind: "eq", value: 2 }
      ]
    },
    {
      id: "adv-33-empty-time-element-mid-track",
      title: "Empty <time></time> is unparsable not missing",
      rationale:
        "Ingestion sets timeAbsent false and timeMs null for empty body; temporal tags unparsable (not missing). Motion/sampling use finite timeMs only (ADR-0012). Sampling time Δ uses adjacent pairs only — no bridge across the empty <time> point.",
      pointsBuilder: () => {
        return buildLinearTrack({
          count: 4,
          startLat: 12.9716,
          startLon: 77.5946,
          latStep: 0.00004,
          lonStep: 0.00004,
          baseIso,
          dtSec: 10,
          mutator: (pts) => {
            pts[0].time = isoAt(baseIso, 0);
            pts[1].time = isoAt(baseIso, 10);
            pts[2].time = "";
            pts[3].time = isoAt(baseIso, 30);
          }
        });
      },
      expectedChecks: [
        { description: "Exactly one unparsable timestamp (empty <time> body)", key: "unparsableTs", kind: "eq", value: 1 },
        { description: "No missing-time points (every trkpt has a <time> child)", key: "missingTs", kind: "eq", value: 0 },
        {
          description: "One adjacent-valid positive dt (0→1 only; 2 unparsable breaks 1→2 and 2→3)",
          key: "positiveDeltas",
          kind: "eq",
          value: 1
        },
        { description: "Two motion pairs touch the non-finite timeMs endpoint", key: "motionTimeUnresolvable", kind: "eq", value: 2 },
        { description: "Only the last pair has both endpoints with finite timeMs and no motion tags", key: "motionForwardValid", kind: "eq", value: 1 }
      ]
    },
    {
      id: "adv-34-missing-time-vs-empty-time",
      title: "No <time> child vs empty <time></time>",
      rationale:
        "Missing requires timeAbsent true (no element). Empty element is timeAbsent false with null timeMs — unparsable. Distinction must not rely on Date.parse downstream.",
      pointsBuilder: () => {
        return buildLinearTrack({
          count: 3,
          startLat: 12.9716,
          startLon: 77.5946,
          latStep: 0.00004,
          lonStep: 0.00004,
          baseIso,
          dtSec: 10,
          mutator: (pts) => {
            delete pts[0].time;
            pts[1].time = "";
            pts[2].time = isoAt(baseIso, 10);
          }
        });
      },
      expectedChecks: [
        { description: "One missing-time point (no <time> element)", key: "missingTs", kind: "eq", value: 1 },
        { description: "One unparsable-time point (empty <time> body)", key: "unparsableTs", kind: "eq", value: 1 },
        { description: "No positive time deltas (only one parseable instant at end)", key: "positiveDeltas", kind: "eq", value: 0 },
        { description: "Both adjacent pairs time-unresolvable for motion", key: "motionTimeUnresolvable", kind: "eq", value: 2 },
        { description: "No motion-clean pairs", key: "motionForwardValid", kind: "eq", value: 0 }
      ]
    },
    {
      id: "adv-35-time-whitespace-only-body",
      title: "Whitespace-only <time> body trims to unparsable",
      rationale:
        "Ingestion trims text; all-whitespace becomes empty string → timeRaw null, timeMs null, timeAbsent false → unparsable.",
      pointsBuilder: () => {
        return buildLinearTrack({
          count: 3,
          startLat: 12.9716,
          startLon: 77.5946,
          latStep: 0.00004,
          lonStep: 0.00004,
          baseIso,
          dtSec: 10,
          mutator: (pts) => {
            pts[0].time = isoAt(baseIso, 0);
            pts[1].time = "   \t\n  ";
            pts[2].time = isoAt(baseIso, 20);
          }
        });
      },
      expectedChecks: [
        { description: "Whitespace-only body counts as unparsable", key: "unparsableTs", kind: "eq", value: 1 },
        { description: "No missing-time tags when <time> exists on every point", key: "missingTs", kind: "eq", value: 0 },
        {
          description: "No positive sampling dt (middle unparsable; adjacent-only pairs are invalid-valid or valid-invalid)",
          key: "positiveDeltas",
          kind: "eq",
          value: 0
        },
        { description: "Middle point breaks two motion pairs for time", key: "motionTimeUnresolvable", kind: "eq", value: 2 }
      ]
    },
    {
      id: "adv-36-gpx-gap-same-time-non-adjacent-dup",
      title: "Coordinate rejection between identical timestamps: not adjacentDuplicate",
      rationale:
        "When a GPX row is rejected between two accepted points, stream adjacency fails; same timestamp as earlier valid point should be nonAdjacentRepeat, not adjacentDuplicate (ADR-0013).",
      pointsBuilder: () => {
        const t = isoAt(baseIso, 0);
        return buildLinearTrack({
          count: 3,
          startLat: 12.9716,
          startLon: 77.5946,
          latStep: 0.00004,
          lonStep: 0.00004,
          baseIso,
          dtSec: 10,
          mutator: (pts) => {
            pts[0].time = t;
            pts[1] = { rawLat: "bad", rawLon: "77.5946", time: isoAt(baseIso, 99) };
            pts[2].time = t;
          }
        });
      },
      expectedChecks: [
        { description: "At least one coordinate rejection", key: "rejectedCoords", kind: "atLeast", value: 1 },
        {
          description: "Same timestamp across gpx gap is nonAdjacentRepeat, not stream-adjacent duplicate",
          key: "nonAdjacentRepeatCount",
          kind: "atLeast",
          value: 1
        },
        { description: "No adjacentDuplicate when stream predecessor is missing", key: "duplicateTs", kind: "eq", value: 0 },
        { description: "No stream-adjacent pairs to evaluate for motion", key: "motionConsecutivePairs", kind: "eq", value: 0 },
        { description: "No sampling distance steps without stream-adjacent edges", key: "samplingDistancePairs", kind: "eq", value: 0 },
        { description: "No sampling timestamp pair evaluations without stream-adjacent edges", key: "samplingTimestampPairs", kind: "eq", value: 0 }
      ]
    },
    {
      id: "adv-37-reject-mid-track-sampling-motion-pair-counts",
      title: "Mid-track coord reject: motion and sampling share stream-adjacent pair count",
      rationale:
        "Five GPX rows with one invalid coordinate in the middle yields two stream edges among four accepted points (0-1 and 3-4). Sampling distance pairInspection.consecutivePairCount must match motion.summary.consecutivePairCount (ADR-0013).",
      pointsBuilder: () =>
        buildLinearTrack({
          count: 5,
          startLat: 12.9716,
          startLon: 77.5946,
          latStep: 0.00004,
          lonStep: 0.00004,
          baseIso,
          dtSec: 5,
          mutator: (pts) => {
            pts[2] = { rawLat: "x", rawLon: "y", time: pts[2].time };
          }
        }),
      expectedChecks: [
        { description: "Exactly one coordinate rejection", key: "rejectedCoords", kind: "eq", value: 1 },
        { description: "Two GPX-stream-adjacent edges among accepted points", key: "motionConsecutivePairs", kind: "eq", value: 2 },
        { description: "Sampling distance pair count matches motion", key: "samplingDistancePairs", kind: "eq", value: 2 },
        { description: "Sampling timestamp pair count matches motion (all times valid and adjacent)", key: "samplingTimestampPairs", kind: "eq", value: 2 }
      ]
    }
  ];
}

function renderExpected(cases) {
  const lines = [];
  lines.push("# Adversarial Suite Expected Outcomes");
  lines.push("");
  lines.push("These are assertion targets for each adversarial GPX case.");
  lines.push("");
  for (const c of cases) {
    lines.push(`## ${c.id}`);
    lines.push(`- Title: ${c.title}`);
    lines.push(`- Why: ${c.rationale}`);
    for (const check of c.expectedChecks) {
      const expectationLabel = check.allowExpectedVariance ? "soft-expect" : "expect";
      lines.push(`- ${expectationLabel}: ${check.description} [${check.key} ${check.kind} ${check.value}]`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function renderReport(results) {
  const lines = [];
  lines.push("# Adversarial Suite Report");
  lines.push("");
  lines.push(
    "Motion and sampling **pair counts** and **pair annotations** use **GPX stream adjacency** (`toGpxIndex === fromGpxIndex + 1` among accepted points), not raw array `(i-1, i)` when coordinate rejects create `gpxIndex` gaps. See `docs/adr/audit/0013-gpx-stream-adjacency-via-gpxindex.md`. Temporal `adjacentDuplicate` / `belowPrevValid` use the accepted predecessor at `gpxIndex - 1` with finite `timeMs`."
  );
  lines.push("");
  const strictPass = results.filter((r) => r.status === "PASS").length;
  const expectedVariance = results.filter((r) => r.status === "EXPECTED_VARIANCE").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  lines.push(`- Overall: strictPass=${strictPass}, expectedVariance=${expectedVariance}, failed=${failed}, total=${results.length}`);
  lines.push("");

  for (const r of results) {
    lines.push(`## ${r.caseId} - ${r.title}`);
    lines.push(`- Intent: ${r.rationale}`);
    lines.push(`- Status: ${r.status}`);
    lines.push("- Checks:");
    for (const c of r.checks) {
      const checkStatus =
        c.pass ? "PASS" : (c.allowExpectedVariance ? "EXPECTED_VARIANCE" : "FAIL");
      lines.push(`  - ${checkStatus} | ${c.description} | expected ${c.expected} | actual ${String(c.actual)}`);
    }
    lines.push("- Key metrics:");
    lines.push(`  - totalPoints=${r.metrics.totalPoints}, rejectedCoords=${r.metrics.rejectedCoords}, hasMultiplePointTypes=${String(r.metrics.hasMultiplePointTypes)}`);
    lines.push(`  - missing=${r.metrics.missingTs}, unparsable=${r.metrics.unparsableTs}`);
    lines.push(`  - adjacentDuplicate=${r.metrics.duplicateTs}, belowAnchor=${r.metrics.backtracking}, belowPrevValid=${r.metrics.belowPrevValidCount}, nonAdjacentRepeat=${r.metrics.nonAdjacentRepeatCount}`);
    lines.push(`  - annotationCount=${r.metrics.annotationCount}`);
    lines.push(`  - positiveDeltas=${r.metrics.positiveDeltas}, clusterCountSorted=${r.metrics.clusterCountSorted}, maxDeltaMs=${r.metrics.maxDeltaMs}`);
    lines.push(`  - samplingDistancePairs=${r.metrics.samplingDistancePairs}, samplingTimestampPairs=${r.metrics.samplingTimestampPairs}`);
    lines.push(`  - motionConsecutivePairs=${r.metrics.motionConsecutivePairs}, motionTaggedPairCount=${r.metrics.motionTaggedPairCount}, motionCleanAdjacent=${r.metrics.motionForwardValid}, motionBackward=${r.metrics.motionBackward}, motionZeroDelta=${r.metrics.motionZeroDelta}, motionTimeUnresolvable=${r.metrics.motionTimeUnresolvable}, motionInvalidDistance=${r.metrics.motionInvalidDistance}, motionEleUnresolvable=${r.metrics.motionEleUnresolvable}`);
    lines.push(`  - eleMissing=${r.metrics.eleMissing}, eleUnparsable=${r.metrics.eleUnparsable}, eleOutOfBounds=${r.metrics.eleOutOfBounds}, eleAdjacentDup=${r.metrics.eleAdjacentDuplicates}, eleValid=${r.metrics.eleValidCount}, eleAnnotationCount=${r.metrics.eleAnnotationCount}`);
    lines.push("");
  }

  return lines.join("\n");
}

function main() {
  ensureDir(FIXTURE_GPX_DIR);
  ensureDir(FIXTURE_DOC_DIR);
  ensureDir(FIXTURE_JSON_DIR);
  loadBrowserModules();

  const cases = buildCases();
  fs.writeFileSync(EXPECTED_PATH, renderExpected(cases), "utf8");

  const results = cases.map(runCase);
  if (process.env.ADVERSARIAL_SKIP_REPORT === "1") {
    console.log(`Report file skipped (set ADVERSARIAL_SKIP_REPORT=1 to skip ${path.basename(REPORT_PATH)})`);
  } else {
    fs.writeFileSync(REPORT_PATH, renderReport(results), "utf8");
  }

  const failed = results.filter((r) => r.status === "FAIL");
  console.log(`Generated ${results.length} adversarial GPX files in: ${FIXTURE_GPX_DIR}`);
  console.log(`Generated ${results.length} adversarial JSON files in: ${FIXTURE_JSON_DIR}`);
  console.log(`Expected outcomes file: ${EXPECTED_PATH}`);
  console.log(process.env.ADVERSARIAL_SKIP_REPORT === "1" ? `Report file: (not written)` : `Report file: ${REPORT_PATH}`);
  console.log(`Result: ${results.length - failed.length}/${results.length} non-failing cases`);

  if (failed.length > 0) {
    process.exitCode = 2;
  }
}

main();
