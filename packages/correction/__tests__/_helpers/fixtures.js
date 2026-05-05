'use strict';

/**
 * Phase J test fixtures — synthetic point-array builders.
 *
 * These build JS objects (not GPX XML) matching the shape that flows through
 * the correction pipeline post-ingestion. Each builder produces a small,
 * deterministic input designed to exercise one specific pipeline behaviour
 * (or to deliberately try to break it).
 *
 * Conventions:
 *   - timeMs values use a small base (1_000_000) plus integer offsets so
 *     human-readable arithmetic is easy in test assertions.
 *   - lat/lon use 47.0 / 8.0 base (Switzerland) with small deltas.
 *   - ele uses base 500m unless ele variation is the test focus.
 */

const T0 = 1000000; // 1970-01-01T00:16:40Z — arbitrary base
const LAT0 = 47.0;
const LON0 = 8.0;

function makePoint(opts) {
  return {
    gpxIndex:     opts.gpxIndex,
    trkSegIndex:  opts.trkSegIndex || 0,
    timeMs:       opts.timeMs === undefined ? null : opts.timeMs,
    lat:          opts.lat === undefined ? LAT0 : opts.lat,
    lon:          opts.lon === undefined ? LON0 : opts.lon,
    ele:          opts.ele === undefined ? null : opts.ele,
    eleAbsent:    opts.eleAbsent === undefined ? (opts.ele === undefined) : opts.eleAbsent,
    timeAbsent:   opts.timeAbsent === undefined ? (opts.timeMs === undefined || opts.timeMs === null) : opts.timeAbsent
  };
}

/**
 * Clean forward-monotone N-point single-segment track.
 */
function cleanTrack(n, opts) {
  opts = opts || {};
  const dt   = opts.dtMs    || 1000;
  const dLat = opts.dLat    || 0.0001;
  const seg  = opts.seg     || 0;
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(makePoint({
      gpxIndex: (opts.startGpxIndex || 0) + i,
      trkSegIndex: seg,
      timeMs: T0 + i * dt,
      lat: LAT0 + i * dLat,
      lon: LON0 + i * dLat,
      ele: 500 + i
    }));
  }
  return out;
}

/**
 * Multi-segment track — N segments of M points each.
 */
function multiSegmentTrack(numSegments, pointsPerSegment) {
  const out = [];
  let gpxIdx = 0;
  for (let s = 0; s < numSegments; s++) {
    for (let i = 0; i < pointsPerSegment; i++) {
      out.push(makePoint({
        gpxIndex: gpxIdx++,
        trkSegIndex: s,
        timeMs: T0 + s * 100000 + i * 1000,
        lat: LAT0 + s * 0.5 + i * 0.0001,
        lon: LON0 + s * 0.5 + i * 0.0001,
        ele: 500 + s * 50 + i
      }));
    }
  }
  return out;
}

/**
 * Track with a contiguous belowAnchor block (chunk that backtracks then re-rises).
 * Returns { points, belowAnchorIndexes } so test can pass the synthetic temporal payload.
 *
 * Layout (gpxIndex 0..6, all seg 0):
 *   0: t=0       — pre-block anchor
 *   1: t=10      — pre-block anchor
 *   2: t=5       — block member (below 1)
 *   3: t=6       — block member
 *   4: t=7       — block member
 *   5: t=20      — post-block anchor
 *   6: t=30      — post-block anchor
 */
function blockTrack() {
  const pts = [
    makePoint({ gpxIndex: 0, timeMs: T0 +  0, lat: LAT0,         lon: LON0,         ele: 500 }),
    makePoint({ gpxIndex: 1, timeMs: T0 + 10, lat: LAT0 + 0.001, lon: LON0 + 0.001, ele: 501 }),
    makePoint({ gpxIndex: 2, timeMs: T0 +  5, lat: LAT0 + 0.002, lon: LON0 + 0.002, ele: 502 }),
    makePoint({ gpxIndex: 3, timeMs: T0 +  6, lat: LAT0 + 0.003, lon: LON0 + 0.003, ele: 503 }),
    makePoint({ gpxIndex: 4, timeMs: T0 +  7, lat: LAT0 + 0.004, lon: LON0 + 0.004, ele: 504 }),
    makePoint({ gpxIndex: 5, timeMs: T0 + 20, lat: LAT0 + 0.005, lon: LON0 + 0.005, ele: 505 }),
    makePoint({ gpxIndex: 6, timeMs: T0 + 30, lat: LAT0 + 0.006, lon: LON0 + 0.006, ele: 506 }),
  ];
  return { points: pts, belowAnchorIndexes: [2, 3, 4] };
}

/**
 * Block with INTERNAL monotonicity violation (member k+1 has earlier timeMs than k).
 */
function blockWithInternalViolation() {
  const pts = [
    makePoint({ gpxIndex: 0, timeMs: T0 +  0,  lat: LAT0,         lon: LON0 }),
    makePoint({ gpxIndex: 1, timeMs: T0 + 100, lat: LAT0 + 0.001, lon: LON0 }),
    makePoint({ gpxIndex: 2, timeMs: T0 + 60,  lat: LAT0 + 0.002, lon: LON0 }),
    makePoint({ gpxIndex: 3, timeMs: T0 + 40,  lat: LAT0 + 0.003, lon: LON0 }), // earlier than 2!
    makePoint({ gpxIndex: 4, timeMs: T0 + 80,  lat: LAT0 + 0.004, lon: LON0 }),
    makePoint({ gpxIndex: 5, timeMs: T0 + 200, lat: LAT0 + 0.005, lon: LON0 }),
  ];
  return { points: pts, belowAnchorIndexes: [2, 3, 4] };
}

/**
 * Singleton backtrack (single belowAnchor not in any run).
 */
function singletonTrack() {
  const pts = [
    makePoint({ gpxIndex: 0, timeMs: T0 +  0,  lat: LAT0,         lon: LON0 }),
    makePoint({ gpxIndex: 1, timeMs: T0 + 10,  lat: LAT0 + 0.001, lon: LON0 }),
    makePoint({ gpxIndex: 2, timeMs: T0 + 20,  lat: LAT0 + 0.002, lon: LON0 }),
    makePoint({ gpxIndex: 3, timeMs: T0 +  5,  lat: LAT0 + 0.003, lon: LON0 }), // singleton
    makePoint({ gpxIndex: 4, timeMs: T0 + 30,  lat: LAT0 + 0.004, lon: LON0 }),
    makePoint({ gpxIndex: 5, timeMs: T0 + 40,  lat: LAT0 + 0.005, lon: LON0 }),
  ];
  return { points: pts, belowAnchorIndexes: [3] };
}

/**
 * Adjacent exact duplicate pair.
 */
function adjacentExactDup() {
  return [
    makePoint({ gpxIndex: 0, timeMs: T0 + 0,    lat: LAT0,         lon: LON0,         ele: 500 }),
    makePoint({ gpxIndex: 1, timeMs: T0 + 1000, lat: LAT0 + 0.001, lon: LON0 + 0.001, ele: 501 }),
    makePoint({ gpxIndex: 2, timeMs: T0 + 1000, lat: LAT0 + 0.001, lon: LON0 + 0.001, ele: 501 }), // exact dup of 1
    makePoint({ gpxIndex: 3, timeMs: T0 + 2000, lat: LAT0 + 0.002, lon: LON0 + 0.002, ele: 502 }),
  ];
}

/**
 * Non-adjacent same-time competition (two points share timeMs but differ geometrically).
 */
function competitionTrack() {
  return [
    makePoint({ gpxIndex: 0, timeMs: T0 + 0,    lat: LAT0,          lon: LON0          }),
    makePoint({ gpxIndex: 1, timeMs: T0 + 1000, lat: LAT0 + 0.001,  lon: LON0          }), // same time as 3
    makePoint({ gpxIndex: 2, timeMs: T0 + 500,  lat: LAT0 + 0.0005, lon: LON0          }),
    makePoint({ gpxIndex: 3, timeMs: T0 + 1000, lat: LAT0 + 0.0011, lon: LON0 + 0.0001 }), // same time as 1
    makePoint({ gpxIndex: 4, timeMs: T0 + 2000, lat: LAT0 + 0.002,  lon: LON0          }),
  ];
}

/**
 * Exact-geometry group (multiple identical points at the same timeMs).
 */
function exactGroupTrack() {
  return [
    makePoint({ gpxIndex: 0, timeMs: T0 + 0,    lat: LAT0,         lon: LON0,         ele: 500 }),
    makePoint({ gpxIndex: 1, timeMs: T0 + 1000, lat: LAT0 + 0.001, lon: LON0 + 0.001, ele: 501 }),
    makePoint({ gpxIndex: 2, timeMs: T0 + 1000, lat: LAT0 + 0.001, lon: LON0 + 0.001, ele: 501 }),
    makePoint({ gpxIndex: 3, timeMs: T0 + 1000, lat: LAT0 + 0.001, lon: LON0 + 0.001, ele: 501 }),
    makePoint({ gpxIndex: 4, timeMs: T0 + 2000, lat: LAT0 + 0.002, lon: LON0 + 0.002, ele: 502 }),
  ];
}

module.exports = {
  T0, LAT0, LON0,
  makePoint,
  cleanTrack, multiSegmentTrack,
  blockTrack, blockWithInternalViolation,
  singletonTrack,
  adjacentExactDup, competitionTrack, exactGroupTrack
};
