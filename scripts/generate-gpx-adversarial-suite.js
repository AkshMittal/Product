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
  const ele = point.ele !== undefined ? point.ele : 100;
  const hasTime = Object.prototype.hasOwnProperty.call(point, "time");
  const timeLine = hasTime && point.time !== null ? `<time>${point.time}</time>` : "";
  return `      <trkpt lat="${lat}" lon="${lon}"><ele>${ele}</ele>${timeLine}</trkpt>`;
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
    path.join(ROOT, "js", "pipeline", "gpx-ingestion-module.js"),
    path.join(ROOT, "js", "pipeline", "timestamp-audit.js"),
    path.join(ROOT, "js", "pipeline", "sampling-audit.js"),
    path.join(ROOT, "js", "pipeline", "motion-audit.js"),
    path.join(ROOT, "js", "pipeline", "audit-export-module.js")
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
  return {
    totalPoints: ingestion.counts ? ingestion.counts.totalPointCount : null,
    hasMultiplePointTypes: ingestion.context ? ingestion.context.hasMultiplePointTypes : null,
    rejectedCoords: ingestion.counts ? ingestion.counts.rejectedPointCount : null,
    missingTs: temporal.temporalOrder && temporal.temporalOrder.missing ? temporal.temporalOrder.missing.pointCount : null,
    missingBlocks: temporal.temporalOrder && temporal.temporalOrder.missing ? temporal.temporalOrder.missing.blocks.length : null,
    missingSingles: temporal.temporalOrder && temporal.temporalOrder.missing ? temporal.temporalOrder.missing.isolatedPointCount : null,
    unparsableTs: temporal.temporalOrder && temporal.temporalOrder.unparsable ? temporal.temporalOrder.unparsable.pointCount : null,
    unparsableBlocks: temporal.temporalOrder && temporal.temporalOrder.unparsable ? temporal.temporalOrder.unparsable.blocks.length : null,
    unparsableSingles: temporal.temporalOrder && temporal.temporalOrder.unparsable ? temporal.temporalOrder.unparsable.isolatedPointCount : null,
    duplicateTs: temporal.temporalOrder && temporal.temporalOrder.duplicate ? temporal.temporalOrder.duplicate.pointCount : null,
    duplicateBlocks: temporal.temporalOrder && temporal.temporalOrder.duplicate ? temporal.temporalOrder.duplicate.blocks.length : null,
    duplicateSingles: temporal.temporalOrder && temporal.temporalOrder.duplicate ? temporal.temporalOrder.duplicate.isolatedPointCount : null,
    backtracking: temporal.temporalOrder && temporal.temporalOrder.backtracking ? temporal.temporalOrder.backtracking.pointCount : null,
    backtrackingBlocks: temporal.temporalOrder && temporal.temporalOrder.backtracking ? temporal.temporalOrder.backtracking.blocks.length : null,
    backtrackingSingles: temporal.temporalOrder && temporal.temporalOrder.backtracking ? temporal.temporalOrder.backtracking.isolatedPointCount : null,
    positiveDeltas: sampling.time && sampling.time.deltaStatistics ? sampling.time.deltaStatistics.positiveDeltaCount : null,
    clusterCountSorted: sampling.time && sampling.time.clustering ? sampling.time.clustering.sortedClusterCount : null,
    maxDeltaMs: sampling.time && sampling.time.deltaStatistics ? sampling.time.deltaStatistics.maxMs : null,
    motionForwardValid: motion.evaluatedPairs ? motion.evaluatedPairs.forwardValidPairCount : null,
    motionBackward: motion.rejections ? motion.rejections.backwardTimePairCount : null,
    motionZeroDelta: motion.rejections ? motion.rejections.zeroTimeDeltaPairCount : null,
    motionInvalidDistance: motion.rejections ? motion.rejections.nonFiniteDistancePairCount : null,
    motionInvalidTimeRatio: motion.time ? motion.time.invalidTimeShareOfEvaluatedTime : null,
    motionTotalValidDistanceMeters: motion.distance ? motion.distance.totalForwardValidDistanceMeters : null
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

  const payload = buildAuditExportPayload({
    fileName: `${caseDef.id}.gpx`,
    totalPointCount: parsed.audit.ingestion.counts.totalPointCount,
    ingestionAudit: parsed.audit.ingestion,
    temporalAudit: temporalResult.audit.temporal,
    samplingAudit: samplingResult.audit.sampling,
    motionAudit: motionResult.audit.motion
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
        { description: "No non-finite distance rejection", key: "motionInvalidDistance", kind: "eq", value: 0 }
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
        { description: "No forward-valid motion pairs", key: "motionForwardValid", kind: "eq", value: 0 }
      ]
    },
    {
      id: "adv-04-all-identical-timestamps",
      title: "All timestamps identical",
      rationale: "Should produce duplicates and zero-time-delta rejections.",
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
        { description: "Motion zero-delta rejections present", key: "motionZeroDelta", kind: "atLeast", value: 1 }
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
        { description: "Temporal backtracking count equals 3", key: "backtracking", kind: "eq", value: 3 },
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
        { description: "No non-finite distance rejection", key: "motionInvalidDistance", kind: "eq", value: 0 },
        { description: "Forward-valid motion pairs exist", key: "motionForwardValid", kind: "eq", value: 5 }
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
        { description: "No non-finite distance rejection", key: "motionInvalidDistance", kind: "eq", value: 0 },
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
        { description: "Expected forward-valid motion count", key: "motionForwardValid", kind: "eq", value: 19999 }
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
        { description: "Motion backward rejections detected", key: "motionBackward", kind: "atLeast", value: 1 }
      ]
    },
    {
      id: "adv-15-static-geometry-long",
      title: "Long static geometry with valid progressing time",
      rationale: "Zero movement should remain valid and yield zero total motion distance.",
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
        { description: "No invalid distance rejections", key: "motionInvalidDistance", kind: "eq", value: 0 },
        { description: "Forward-valid motion exists", key: "motionForwardValid", kind: "eq", value: 119 },
        { description: "Total valid motion distance remains zero", key: "motionTotalValidDistanceMeters", kind: "eq", value: 0 }
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
        { description: "No invalid distance rejections", key: "motionInvalidDistance", kind: "eq", value: 0 },
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
        { description: "Duplicate count is 2", key: "duplicateTs", kind: "eq", value: 2 },
        { description: "Duplicate singleton count is 2", key: "duplicateSingles", kind: "eq", value: 2 },
        { description: "No duplicate block of length >1", key: "duplicateBlocks", kind: "eq", value: 0 }
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
        { description: "Three missing timestamps total", key: "missingTs", kind: "eq", value: 3 },
        { description: "One missing block exists", key: "missingBlocks", kind: "eq", value: 1 },
        { description: "One missing singleton remains visible", key: "missingSingles", kind: "eq", value: 1 }
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
        { description: "No invalid-distance rejection explosion", key: "motionInvalidDistance", kind: "eq", value: 0 }
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
    lines.push(`  - missingTs=${r.metrics.missingTs}, missingBlocks=${r.metrics.missingBlocks}, missingSingles=${r.metrics.missingSingles}`);
    lines.push(`  - unparsableTs=${r.metrics.unparsableTs}, unparsableBlocks=${r.metrics.unparsableBlocks}, unparsableSingles=${r.metrics.unparsableSingles}`);
    lines.push(`  - duplicateTs=${r.metrics.duplicateTs}, duplicateBlocks=${r.metrics.duplicateBlocks}, duplicateSingles=${r.metrics.duplicateSingles}`);
    lines.push(`  - backtracking=${r.metrics.backtracking}, backtrackingBlocks=${r.metrics.backtrackingBlocks}, backtrackingSingles=${r.metrics.backtrackingSingles}`);
    lines.push(`  - positiveDeltas=${r.metrics.positiveDeltas}, clusterCountSorted=${r.metrics.clusterCountSorted}, maxDeltaMs=${r.metrics.maxDeltaMs}`);
    lines.push(`  - motionForwardValid=${r.metrics.motionForwardValid}, motionBackward=${r.metrics.motionBackward}, motionZeroDelta=${r.metrics.motionZeroDelta}, motionInvalidDistance=${r.metrics.motionInvalidDistance}, motionInvalidTimeRatio=${r.metrics.motionInvalidTimeRatio}, motionTotalValidDistanceMeters=${r.metrics.motionTotalValidDistanceMeters}`);
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
  fs.writeFileSync(REPORT_PATH, renderReport(results), "utf8");

  const failed = results.filter((r) => r.status === "FAIL");
  console.log(`Generated ${results.length} adversarial GPX files in: ${FIXTURE_GPX_DIR}`);
  console.log(`Generated ${results.length} adversarial JSON files in: ${FIXTURE_JSON_DIR}`);
  console.log(`Expected outcomes file: ${EXPECTED_PATH}`);
  console.log(`Report file: ${REPORT_PATH}`);
  console.log(`Result: ${results.length - failed.length}/${results.length} non-failing cases`);

  if (failed.length > 0) {
    process.exitCode = 2;
  }
}

main();
