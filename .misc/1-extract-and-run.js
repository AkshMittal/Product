'use strict';

/**
 * 1-extract-and-run.js
 *
 * Streams the hikr.org CSV, extracts inline GPX XML from the `gpx` column,
 * runs the full audit → correction pipeline on each track, and writes
 * per-track JSON pairs to pipeline-output/csv/<trackId>.audit.json
 * and pipeline-output/csv/<trackId>.correction.json.
 *
 * Usage:
 *   node 1-extract-and-run.js [--limit N] [--offset N] [--output-dir DIR]
 *
 * Options:
 *   --limit N       Process only N tracks (default: all)
 *   --offset N      Skip first N tracks (default: 0)
 *   --output-dir    Where to write JSON pairs (default: pipeline-output/csv)
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const { parse } = require('csv-parse');
const { JSDOM } = require('jsdom');
const { runCorrection } = require('./packages/correction/index');

// ── CLI args ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(flag, def) {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
}
const LIMIT      = getArg('--limit', null);
const OFFSET     = parseInt(getArg('--offset', '0'), 10);
const OUTPUT_DIR = getArg('--output-dir', path.join(__dirname, 'pipeline-output/csv'));
const limitN     = LIMIT ? parseInt(LIMIT, 10) : Infinity;

// ── Load audit modules into jsdom vm context ──────────────────────────────

const dom = new JSDOM('<!DOCTYPE html>');
const vmContext = vm.createContext({ DOMParser: dom.window.DOMParser, console, document: dom.window.document });

const auditDir = path.join(__dirname, 'packages/audit/pipeline');
for (const f of [
  'export-fault-detection.js', 'gpx-ingestion-module.js',
  'timestamp-audit.js', 'sampling-audit.js', 'motion-audit.js',
  'elevation-audit.js', 'audit-export-module.js',
]) {
  vm.runInContext(fs.readFileSync(path.join(auditDir, f), 'utf8'), vmContext);
}

const { parseGPX, auditTimestamps, auditSampling, auditMotion, auditElevation, buildAuditExportPayload } = vmContext;

// ── Pipeline ──────────────────────────────────────────────────────────────

function runPipeline(gpxString, fileName) {
  const { points, audit: ingestionAudit } = parseGPX(gpxString);

  const auditJson = buildAuditExportPayload({
    fileName,
    totalPointCount: points.length,
    ingestionAudit:  ingestionAudit.ingestion,
    temporalAudit:   auditTimestamps(points)?.audit?.temporal,
    samplingAudit:   auditSampling(points, fileName)?.audit?.sampling,
    motionAudit:     auditMotion(points, {})?.audit?.motion,
    elevationAudit:  auditElevation(points, {})?.audit?.elevation,
  });

  let correctionJson = null;
  let correctionError = null;
  try {
    correctionJson = runCorrection(auditJson, points, {});
  } catch (e) {
    correctionError = e.message;
  }

  return { points, auditJson, correctionJson, correctionError };
}

// ── Main ──────────────────────────────────────────────────────────────────

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const csvPath = path.join(__dirname, 'dataset/gpx-tracks-from-hikr.org.csv');
let processed = 0;
let skipped   = 0;
let errors    = 0;

process.stderr.write(`Running pipeline → writing JSONs to ${OUTPUT_DIR}\n`);

const parser = fs.createReadStream(csvPath)
  .pipe(parse({ columns: true, skip_empty_lines: true, relax_quotes: true, relax_column_count: true }));

parser.on('data', (row) => {
  if (skipped < OFFSET)    { skipped++; return; }
  if (processed >= limitN) { parser.destroy(); return; }

  const trackId = row._id || `row-${processed + 1}`;
  const gpxString = row.gpx;

  if (!gpxString || !gpxString.trim()) return;

  processed++;

  let result;
  try {
    result = runPipeline(gpxString, row.name || trackId);
  } catch (e) {
    errors++;
    // Write an error marker so the analyzer can report it
    const safe = trackId.replace(/[^a-zA-Z0-9_-]/g, '_');
    fs.writeFileSync(
      path.join(OUTPUT_DIR, `${safe}.error.json`),
      JSON.stringify({ trackId, name: row.name, error: e.message }, null, 2)
    );
    return;
  }

  const safe = trackId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const meta = { trackId, name: row.name, user: row.user, startTime: row.start_time, url: row.url };

  fs.writeFileSync(
    path.join(OUTPUT_DIR, `${safe}.audit.json`),
    JSON.stringify({ meta, ...result.auditJson }, null, 2)
  );

  if (result.correctionJson) {
    fs.writeFileSync(
      path.join(OUTPUT_DIR, `${safe}.correction.json`),
      JSON.stringify({ meta, correctionError: result.correctionError, ...result.correctionJson }, null, 2)
    );
  } else if (result.correctionError) {
    fs.writeFileSync(
      path.join(OUTPUT_DIR, `${safe}.correction.json`),
      JSON.stringify({ meta, correctionError: result.correctionError }, null, 2)
    );
  }

  if (processed % 50 === 0) {
    process.stderr.write(`\r[progress] processed=${processed}  errors=${errors}    `);
  }
});

parser.on('end', () => {
  process.stderr.write(`\n[done] processed=${processed}  errors=${errors}\n`);
});

parser.on('error', (err) => {
  process.stderr.write(`CSV parse error: ${err.message}\n`);
  process.exit(1);
});
