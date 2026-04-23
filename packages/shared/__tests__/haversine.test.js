'use strict';

const { haversineMeters, haversineKph } = require('../geo/haversine');

describe('haversineMeters', () => {
  test('same point → 0 metres', () => {
    expect(haversineMeters(48.8566, 2.3522, 48.8566, 2.3522)).toBe(0);
  });

  test('known distance: Paris → London ≈ 340 km', () => {
    // Paris 48.8566°N 2.3522°E, London 51.5074°N 0.1278°W
    var d = haversineMeters(48.8566, 2.3522, 51.5074, -0.1278);
    expect(d).toBeGreaterThan(340000);
    expect(d).toBeLessThan(345000);
  });

  test('symmetry: dist(A,B) === dist(B,A)', () => {
    var d1 = haversineMeters(47.0, 8.0, 46.0, 9.0);
    var d2 = haversineMeters(46.0, 9.0, 47.0, 8.0);
    expect(Math.abs(d1 - d2)).toBeLessThan(0.001);
  });

  test('short distance ~111 m for 0.001° lat shift', () => {
    var d = haversineMeters(47.0, 8.0, 47.001, 8.0);
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(120);
  });
});

describe('haversineKph', () => {
  test('zero deltaMs → Infinity', () => {
    var p = { lat: 47.0, lon: 8.0, timeMs: 1000 };
    expect(haversineKph(p, p)).toBe(Infinity);
  });

  test('negative deltaMs → NaN', () => {
    var p1 = { lat: 47.0, lon: 8.0, timeMs: 2000 };
    var p2 = { lat: 47.001, lon: 8.0, timeMs: 1000 };
    expect(haversineKph(p1, p2)).toBeNaN();
  });

  test('realistic walking speed ~4 kph', () => {
    // ~111 m in 100 s → ~4 kph
    var p1 = { lat: 47.0, lon: 8.0, timeMs: 0 };
    var p2 = { lat: 47.001, lon: 8.0, timeMs: 100000 };
    var kph = haversineKph(p1, p2);
    expect(kph).toBeGreaterThan(3.5);
    expect(kph).toBeLessThan(4.5);
  });

  test('same position, positive deltaMs → 0 kph', () => {
    var p1 = { lat: 47.0, lon: 8.0, timeMs: 0 };
    var p2 = { lat: 47.0, lon: 8.0, timeMs: 60000 };
    expect(haversineKph(p1, p2)).toBe(0);
  });
});
