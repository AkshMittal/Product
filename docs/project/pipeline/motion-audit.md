# `motion-audit.js`

## Purpose

`motion-audit.js` computes motion metrics from consecutive ingestion points, independent from sampling audit decisions.

## Public API

- `auditMotion(points)`

Input point shape:

- `lat`, `lon`
- `timeRaw` (ISO string or `null`)
- `gpxIndex`

## Core behavior

- Uses haversine distance per adjacent pair.
- Uses anchored timestamp chaining (`prevTimestampMs`) to evaluate valid motion pairs.
- Classifies pairs into:
  - forward-valid (`dtSec > 0`)
  - zero-delta (`dtSec === 0`)
  - backward-time (`dtSec < 0`)
  - missing/unparsable timestamp cases
  - non-finite distance cases

## Returned metrics (high level)

- Pair counters (consecutive, forward-valid, backward, zero-delta).
- Distance/time totals from valid forward pairs.
- Speed sample distribution from valid forward pairs.
- Event arrays for rejected or anomalous pair classes (with `fromIndex` / `toIndex`).

## Notes

- This module does not mutate points.
- This module feeds downstream visual diagnostics and anomaly cards; it is not a rendering module.
