'use strict';

const { parseTimestampMs, isValidTimeMs } = require('../time/parse-timestamp');

describe('parseTimestampMs', () => {
  test('null → null', () => expect(parseTimestampMs(null)).toBeNull());
  test('undefined → null', () => expect(parseTimestampMs(undefined)).toBeNull());
  test('empty string → null', () => expect(parseTimestampMs('')).toBeNull());
  test('whitespace string → null', () => expect(parseTimestampMs('   ')).toBeNull());
  test('NaN number → null', () => expect(parseTimestampMs(NaN)).toBeNull());
  test('Infinity → null', () => expect(parseTimestampMs(Infinity)).toBeNull());

  test('valid number → passes through', () => {
    expect(parseTimestampMs(1714000000000)).toBe(1714000000000);
  });

  test('float number → rounded', () => {
    expect(parseTimestampMs(1714000000000.7)).toBe(1714000000001);
  });

  test('ISO 8601 with Z → ms', () => {
    var ms = parseTimestampMs('2024-04-25T12:00:00Z');
    expect(typeof ms).toBe('number');
    expect(isFinite(ms)).toBe(true);
    expect(ms).toBe(Date.parse('2024-04-25T12:00:00Z'));
  });

  test('ISO 8601 with offset → ms', () => {
    var ms = parseTimestampMs('2024-04-25T14:00:00+02:00');
    expect(typeof ms).toBe('number');
    expect(isFinite(ms)).toBe(true);
  });

  test('ISO 8601 with ms → ms', () => {
    var ms = parseTimestampMs('2024-04-25T12:00:00.500Z');
    expect(typeof ms).toBe('number');
    expect(isFinite(ms)).toBe(true);
  });

  test('invalid string → null', () => {
    expect(parseTimestampMs('not-a-date')).toBeNull();
  });
});

describe('isValidTimeMs', () => {
  test('finite number → true', () => expect(isValidTimeMs(1714000000000)).toBe(true));
  test('0 → true', () => expect(isValidTimeMs(0)).toBe(true));
  test('NaN → false', () => expect(isValidTimeMs(NaN)).toBe(false));
  test('Infinity → false', () => expect(isValidTimeMs(Infinity)).toBe(false));
  test('null → false', () => expect(isValidTimeMs(null)).toBe(false));
  test('string → false', () => expect(isValidTimeMs('2024-01-01')).toBe(false));
});
