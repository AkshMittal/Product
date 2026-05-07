'use strict';

/**
 * packages/shared/index.js
 * Re-exports all shared utilities for the correction layer.
 */

var haversine = require('./geo/haversine');
var timestamp = require('./time/parse-timestamp');

module.exports = {
  haversineMeters: haversine.haversineMeters,
  haversineKph: haversine.haversineKph,
  parseTimestampMs: timestamp.parseTimestampMs,
  isValidTimeMs: timestamp.isValidTimeMs,
};
