'use strict';

/**
 * packages/shared/time/parse-timestamp.js
 *
 * Canonical timestamp parsing for the correction layer.
 * Returns a finite integer ms-since-epoch, or null on any failure.
 *
 * Accepts:
 *  - ISO 8601 strings (with or without milliseconds, with or without Z)
 *  - Numeric ms values (passed through if finite)
 *  - null / undefined → null
 */

/**
 * Parse a GPX timestamp string or number to ms-since-epoch.
 * @param {string|number|null|undefined} value
 * @returns {number|null} finite integer ms, or null
 */
function parseTimestampMs(value) {
  if (value === null || value === undefined) return null;

  if (typeof value === 'number') {
    return isFinite(value) ? Math.round(value) : null;
  }

  if (typeof value === 'string') {
    var trimmed = value.trim();
    if (!trimmed) return null;
    var ms = Date.parse(trimmed);
    return isFinite(ms) ? ms : null;
  }

  return null;
}

/**
 * Returns true if the value is a valid, finite ms timestamp.
 * @param {unknown} value
 * @returns {boolean}
 */
function isValidTimeMs(value) {
  return typeof value === 'number' && isFinite(value);
}

module.exports = { parseTimestampMs, isValidTimeMs };
