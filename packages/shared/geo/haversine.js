'use strict';

/**
 * packages/shared/geo/haversine.js
 *
 * Canonical haversine utilities for the correction layer and any future
 * CommonJS consumer. The audit pipeline (packages/audit/pipeline/*.js) is
 * loaded via vm.runInThisContext and cannot require() modules; those files
 * retain their own local haversine copies until the vm-loader is retired.
 *
 * Earth radius: 6 371 000 m (matches motion-audit.js for consistency).
 */

var R = 6371000; // metres

/**
 * Haversine great-circle distance in metres.
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number} distance in metres
 */
function haversineMeters(lat1, lon1, lat2, lon2) {
  var dLat = (lat2 - lat1) * Math.PI / 180;
  var dLon = (lon2 - lon1) * Math.PI / 180;
  var a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Implied speed in km/h between two points.
 * Returns Infinity if deltaMs === 0, NaN if deltaMs < 0 or either point is invalid.
 *
 * @param {{ lat: number, lon: number, timeMs: number }} p1
 * @param {{ lat: number, lon: number, timeMs: number }} p2
 * @returns {number} speed in km/h
 */
function haversineKph(p1, p2) {
  var deltaMs = p2.timeMs - p1.timeMs;
  if (deltaMs < 0) return NaN;
  if (deltaMs === 0) return Infinity;
  var distM = haversineMeters(p1.lat, p1.lon, p2.lat, p2.lon);
  return (distM / deltaMs) * 3600000 / 1000;
}

module.exports = { haversineMeters, haversineKph };
