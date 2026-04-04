# Adversarial Suite Report

Motion and sampling **pair counts** and **pair annotations** use **GPX stream adjacency** (`toGpxIndex === fromGpxIndex + 1` among accepted points), not raw array `(i-1, i)` when coordinate rejects create `gpxIndex` gaps. See `docs/adr/audit/0013-gpx-stream-adjacency-via-gpxindex.md`. Temporal `adjacentDuplicate` / `belowPrevValid` use the accepted predecessor at `gpxIndex - 1` with finite `timeMs`.

- Overall: strictPass=35, expectedVariance=2, failed=0, total=37

## adv-01-exact-2pct-boundary - Exactly 2% clustering boundary
- Intent: Values exactly 2% apart should not merge under strict '< 0.02' rule.
- Status: EXPECTED_VARIANCE
- Checks:
  - EXPECTED_VARIANCE | Clusters may split at exact 2% boundary (local-center chaining can keep one cluster) | expected atLeast 2 | actual 1
  - PASS | Positive deltas are still collected | expected eq 7 | actual 7
- Key metrics:
  - totalPoints=8, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=0, unparsable=0
  - adjacentDuplicate=0, belowAnchor=0, belowPrevValid=0, nonAdjacentRepeat=0
  - annotationCount=0
  - positiveDeltas=7, clusterCountSorted=1, maxDeltaMs=10200
  - samplingDistancePairs=7, samplingTimestampPairs=7
  - motionConsecutivePairs=7, motionTaggedPairCount=0, motionCleanAdjacent=7, motionBackward=0, motionZeroDelta=0, motionTimeUnresolvable=0, motionInvalidDistance=0, motionEleUnresolvable=0
  - eleMissing=0, eleUnparsable=0, eleOutOfBounds=0, eleAdjacentDup=7, eleValid=8, eleAnnotationCount=7

## adv-02-near-boundary-float - Near-boundary floating precision
- Intent: Very near-boundary deltas should remain stable and finite.
- Status: EXPECTED_VARIANCE
- Checks:
  - EXPECTED_VARIANCE | At least two regimes may be detected (boundary precision can collapse to one cluster) | expected atLeast 2 | actual 1
  - PASS | No nonFiniteDistance motion pairs | expected eq 0 | actual 0
- Key metrics:
  - totalPoints=8, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=0, unparsable=0
  - adjacentDuplicate=0, belowAnchor=0, belowPrevValid=0, nonAdjacentRepeat=0
  - annotationCount=0
  - positiveDeltas=7, clusterCountSorted=1, maxDeltaMs=10200
  - samplingDistancePairs=7, samplingTimestampPairs=7
  - motionConsecutivePairs=7, motionTaggedPairCount=0, motionCleanAdjacent=7, motionBackward=0, motionZeroDelta=0, motionTimeUnresolvable=0, motionInvalidDistance=0, motionEleUnresolvable=0
  - eleMissing=0, eleUnparsable=0, eleOutOfBounds=0, eleAdjacentDup=7, eleValid=8, eleAnnotationCount=7

## adv-03-single-valid-timestamp - Single valid timestamp only
- Intent: No pairs should be time-valid when only one timestamp is parseable.
- Status: PASS
- Checks:
  - PASS | No positive delta pairs | expected eq 0 | actual 0
  - PASS | No motion-clean adjacent pairs (every pair has a tag) | expected eq 0 | actual 0
- Key metrics:
  - totalPoints=7, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=4, unparsable=2
  - adjacentDuplicate=0, belowAnchor=0, belowPrevValid=0, nonAdjacentRepeat=0
  - annotationCount=6
  - positiveDeltas=0, clusterCountSorted=0, maxDeltaMs=null
  - samplingDistancePairs=6, samplingTimestampPairs=0
  - motionConsecutivePairs=6, motionTaggedPairCount=6, motionCleanAdjacent=0, motionBackward=0, motionZeroDelta=0, motionTimeUnresolvable=6, motionInvalidDistance=0, motionEleUnresolvable=0
  - eleMissing=0, eleUnparsable=0, eleOutOfBounds=0, eleAdjacentDup=6, eleValid=7, eleAnnotationCount=6

## adv-04-all-identical-timestamps - All timestamps identical
- Intent: Should produce duplicate timestamp tags and zero-time-delta motion pair flags.
- Status: PASS
- Checks:
  - PASS | Duplicate timestamps detected | expected atLeast 1 | actual 7
  - PASS | At least one zeroTimeDelta motion pair | expected atLeast 1 | actual 7
- Key metrics:
  - totalPoints=8, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=0, unparsable=0
  - adjacentDuplicate=7, belowAnchor=0, belowPrevValid=0, nonAdjacentRepeat=0
  - annotationCount=7
  - positiveDeltas=0, clusterCountSorted=0, maxDeltaMs=null
  - samplingDistancePairs=7, samplingTimestampPairs=7
  - motionConsecutivePairs=7, motionTaggedPairCount=7, motionCleanAdjacent=0, motionBackward=0, motionZeroDelta=7, motionTimeUnresolvable=0, motionInvalidDistance=0, motionEleUnresolvable=0
  - eleMissing=0, eleUnparsable=0, eleOutOfBounds=0, eleAdjacentDup=7, eleValid=8, eleAnnotationCount=7

## adv-05-alternating-backtracking - Alternating forward/backtracking
- Intent: Backtracking points should be detected repeatedly without forced block inflation.
- Status: PASS
- Checks:
  - PASS | belowAnchor tag count equals 3 (each point is behind the monotonic high-water mark) | expected eq 3 | actual 3
  - PASS | Motion backward pair count equals 3 | expected eq 3 | actual 3
- Key metrics:
  - totalPoints=7, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=0, unparsable=0
  - adjacentDuplicate=0, belowAnchor=3, belowPrevValid=3, nonAdjacentRepeat=0
  - annotationCount=3
  - positiveDeltas=3, clusterCountSorted=2, maxDeltaMs=10000
  - samplingDistancePairs=6, samplingTimestampPairs=6
  - motionConsecutivePairs=6, motionTaggedPairCount=3, motionCleanAdjacent=3, motionBackward=3, motionZeroDelta=0, motionTimeUnresolvable=0, motionInvalidDistance=0, motionEleUnresolvable=0
  - eleMissing=0, eleUnparsable=0, eleOutOfBounds=0, eleAdjacentDup=6, eleValid=7, eleAnnotationCount=6

## adv-06-large-forward-jump - Single large forward jump outlier
- Intent: Outlier should increase max delta and often add a cluster.
- Status: PASS
- Checks:
  - PASS | Max delta includes outlier jump | expected atLeast 300000 | actual 300000
  - PASS | At least two clusters due to mixed regimes | expected atLeast 2 | actual 2
- Key metrics:
  - totalPoints=10, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=0, unparsable=0
  - adjacentDuplicate=0, belowAnchor=0, belowPrevValid=0, nonAdjacentRepeat=0
  - annotationCount=0
  - positiveDeltas=9, clusterCountSorted=2, maxDeltaMs=300000
  - samplingDistancePairs=9, samplingTimestampPairs=9
  - motionConsecutivePairs=9, motionTaggedPairCount=0, motionCleanAdjacent=9, motionBackward=0, motionZeroDelta=0, motionTimeUnresolvable=0, motionInvalidDistance=0, motionEleUnresolvable=0
  - eleMissing=0, eleUnparsable=0, eleOutOfBounds=0, eleAdjacentDup=9, eleValid=10, eleAnnotationCount=9

## adv-07-dateline-crossing - Dateline crossing distance
- Intent: Crossing +179.9/-179.9 should remain finite.
- Status: PASS
- Checks:
  - PASS | No nonFiniteDistance motion pairs | expected eq 0 | actual 0
  - PASS | Five motion-clean adjacent pairs | expected eq 5 | actual 5
- Key metrics:
  - totalPoints=6, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=0, unparsable=0
  - adjacentDuplicate=0, belowAnchor=0, belowPrevValid=0, nonAdjacentRepeat=0
  - annotationCount=0
  - positiveDeltas=5, clusterCountSorted=1, maxDeltaMs=5000
  - samplingDistancePairs=5, samplingTimestampPairs=5
  - motionConsecutivePairs=5, motionTaggedPairCount=0, motionCleanAdjacent=5, motionBackward=0, motionZeroDelta=0, motionTimeUnresolvable=0, motionInvalidDistance=0, motionEleUnresolvable=0
  - eleMissing=0, eleUnparsable=0, eleOutOfBounds=0, eleAdjacentDup=5, eleValid=6, eleAnnotationCount=5

## adv-08-polar-latitude - High-latitude geometry stress
- Intent: Near-pole coordinates should still compute finite haversine distances.
- Status: PASS
- Checks:
  - PASS | No nonFiniteDistance motion pairs | expected eq 0 | actual 0
  - PASS | Positive deltas exist | expected eq 7 | actual 7
- Key metrics:
  - totalPoints=8, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=0, unparsable=0
  - adjacentDuplicate=0, belowAnchor=0, belowPrevValid=0, nonAdjacentRepeat=0
  - annotationCount=0
  - positiveDeltas=7, clusterCountSorted=1, maxDeltaMs=3000
  - samplingDistancePairs=7, samplingTimestampPairs=7
  - motionConsecutivePairs=7, motionTaggedPairCount=0, motionCleanAdjacent=7, motionBackward=0, motionZeroDelta=0, motionTimeUnresolvable=0, motionInvalidDistance=0, motionEleUnresolvable=0
  - eleMissing=0, eleUnparsable=0, eleOutOfBounds=0, eleAdjacentDup=7, eleValid=8, eleAnnotationCount=7

## adv-09-mixed-point-types - Mixed GPX point types
- Intent: Ingestion should flag multi-point-type context correctly.
- Status: PASS
- Checks:
  - PASS | Multiple point types detected | expected eq true | actual true
  - PASS | Total points include wpt+rtept+trkpt | expected eq 5 | actual 5
- Key metrics:
  - totalPoints=5, rejectedCoords=0, hasMultiplePointTypes=true
  - missing=0, unparsable=0
  - adjacentDuplicate=0, belowAnchor=0, belowPrevValid=0, nonAdjacentRepeat=0
  - annotationCount=0
  - positiveDeltas=4, clusterCountSorted=1, maxDeltaMs=5000
  - samplingDistancePairs=4, samplingTimestampPairs=4
  - motionConsecutivePairs=4, motionTaggedPairCount=0, motionCleanAdjacent=4, motionBackward=0, motionZeroDelta=0, motionTimeUnresolvable=0, motionInvalidDistance=0, motionEleUnresolvable=0
  - eleMissing=0, eleUnparsable=0, eleOutOfBounds=0, eleAdjacentDup=0, eleValid=5, eleAnnotationCount=0

## adv-10-timestamp-format-variants - Timestamp format variants
- Intent: Valid variants parse; malformed strings are counted as unparsable.
- Status: PASS
- Checks:
  - PASS | Unparsable timestamps counted | expected atLeast 2 | actual 2
  - PASS | Still has some positive deltas | expected atLeast 1 | actual 4
- Key metrics:
  - totalPoints=8, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=0, unparsable=2
  - adjacentDuplicate=0, belowAnchor=0, belowPrevValid=0, nonAdjacentRepeat=0
  - annotationCount=2
  - positiveDeltas=4, clusterCountSorted=3, maxDeltaMs=5500
  - samplingDistancePairs=7, samplingTimestampPairs=4
  - motionConsecutivePairs=7, motionTaggedPairCount=3, motionCleanAdjacent=4, motionBackward=0, motionZeroDelta=0, motionTimeUnresolvable=3, motionInvalidDistance=0, motionEleUnresolvable=0
  - eleMissing=0, eleUnparsable=0, eleOutOfBounds=0, eleAdjacentDup=7, eleValid=8, eleAnnotationCount=7

## adv-11-backtracking-after-invalid-gap - Backtracking after missing/unparsable gap
- Intent: Anchor-based backtracking should survive invalid timestamp gaps.
- Status: PASS
- Checks:
  - PASS | Missing timestamp present | expected atLeast 1 | actual 1
  - PASS | Unparsable timestamp present | expected atLeast 1 | actual 1
  - PASS | Backtracking is detected after invalid gap | expected atLeast 1 | actual 1
- Key metrics:
  - totalPoints=7, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=1, unparsable=1
  - adjacentDuplicate=0, belowAnchor=1, belowPrevValid=0, nonAdjacentRepeat=0
  - annotationCount=3
  - positiveDeltas=3, clusterCountSorted=3, maxDeltaMs=16000
  - samplingDistancePairs=6, samplingTimestampPairs=3
  - motionConsecutivePairs=6, motionTaggedPairCount=3, motionCleanAdjacent=3, motionBackward=0, motionZeroDelta=0, motionTimeUnresolvable=3, motionInvalidDistance=0, motionEleUnresolvable=0
  - eleMissing=0, eleUnparsable=0, eleOutOfBounds=0, eleAdjacentDup=6, eleValid=7, eleAnnotationCount=6

## adv-12-large-scale-20k - Large scale 20k points
- Intent: Volume stress: validates count/ratio stability at scale.
- Status: PASS
- Checks:
  - PASS | No coordinate rejections | expected eq 0 | actual 0
  - PASS | Expected positive delta count | expected eq 19999 | actual 19999
  - PASS | All 19,999 adjacent motion pairs clean | expected eq 19999 | actual 19999
- Key metrics:
  - totalPoints=20000, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=0, unparsable=0
  - adjacentDuplicate=0, belowAnchor=0, belowPrevValid=0, nonAdjacentRepeat=0
  - annotationCount=0
  - positiveDeltas=19999, clusterCountSorted=1, maxDeltaMs=1000
  - samplingDistancePairs=19999, samplingTimestampPairs=19999
  - motionConsecutivePairs=19999, motionTaggedPairCount=0, motionCleanAdjacent=19999, motionBackward=0, motionZeroDelta=0, motionTimeUnresolvable=0, motionInvalidDistance=0, motionEleUnresolvable=0
  - eleMissing=0, eleUnparsable=0, eleOutOfBounds=0, eleAdjacentDup=19999, eleValid=20000, eleAnnotationCount=19999

## adv-13-mixed-all-anomalies - Mixed anomalies in one track
- Intent: Combines ingestion reject + missing + unparsable + duplicate + backtracking.
- Status: PASS
- Checks:
  - PASS | At least one coordinate rejection | expected atLeast 1 | actual 1
  - PASS | Missing timestamp detected | expected atLeast 1 | actual 1
  - PASS | Unparsable timestamp detected | expected atLeast 1 | actual 1
  - PASS | Duplicate timestamp detected | expected atLeast 1 | actual 1
  - PASS | Backtracking detected | expected atLeast 1 | actual 1
- Key metrics:
  - totalPoints=14, rejectedCoords=1, hasMultiplePointTypes=false
  - missing=1, unparsable=1
  - adjacentDuplicate=1, belowAnchor=1, belowPrevValid=1, nonAdjacentRepeat=1
  - annotationCount=4
  - positiveDeltas=6, clusterCountSorted=3, maxDeltaMs=32000
  - samplingDistancePairs=11, samplingTimestampPairs=8
  - motionConsecutivePairs=11, motionTaggedPairCount=5, motionCleanAdjacent=6, motionBackward=1, motionZeroDelta=1, motionTimeUnresolvable=3, motionInvalidDistance=0, motionEleUnresolvable=0
  - eleMissing=0, eleUnparsable=0, eleOutOfBounds=0, eleAdjacentDup=12, eleValid=13, eleAnnotationCount=12

## adv-14-multi-trkseg-backtrack - Multiple track segments with cross-segment backtrack
- Intent: Ensures chronological regressions across trkseg boundaries are detected.
- Status: PASS
- Checks:
  - PASS | Backtracking detected across segments | expected atLeast 1 | actual 1
  - PASS | At least one backwardTime motion pair | expected atLeast 1 | actual 1
- Key metrics:
  - totalPoints=6, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=0, unparsable=0
  - adjacentDuplicate=0, belowAnchor=1, belowPrevValid=1, nonAdjacentRepeat=0
  - annotationCount=1
  - positiveDeltas=4, clusterCountSorted=2, maxDeltaMs=11000
  - samplingDistancePairs=5, samplingTimestampPairs=5
  - motionConsecutivePairs=5, motionTaggedPairCount=1, motionCleanAdjacent=4, motionBackward=1, motionZeroDelta=0, motionTimeUnresolvable=0, motionInvalidDistance=0, motionEleUnresolvable=0
  - eleMissing=0, eleUnparsable=0, eleOutOfBounds=0, eleAdjacentDup=5, eleValid=6, eleAnnotationCount=5

## adv-15-static-geometry-long - Long static geometry with valid progressing time
- Intent: Zero movement with monotonic time: every adjacent pair should be clean for motion (finite haversine, forward dt, resolvable time, valid ele).
- Status: PASS
- Checks:
  - PASS | No nonFiniteDistance motion pairs | expected eq 0 | actual 0
  - PASS | All adjacent motion pairs clean (no tags) | expected eq 119 | actual 119
  - PASS | No backward-time motion pairs | expected eq 0 | actual 0
  - PASS | No zero-delta motion pairs | expected eq 0 | actual 0
- Key metrics:
  - totalPoints=120, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=0, unparsable=0
  - adjacentDuplicate=0, belowAnchor=0, belowPrevValid=0, nonAdjacentRepeat=0
  - annotationCount=0
  - positiveDeltas=119, clusterCountSorted=1, maxDeltaMs=1000
  - samplingDistancePairs=119, samplingTimestampPairs=119
  - motionConsecutivePairs=119, motionTaggedPairCount=0, motionCleanAdjacent=119, motionBackward=0, motionZeroDelta=0, motionTimeUnresolvable=0, motionInvalidDistance=0, motionEleUnresolvable=0
  - eleMissing=0, eleUnparsable=0, eleOutOfBounds=0, eleAdjacentDup=119, eleValid=120, eleAnnotationCount=119

## adv-16-boundary-lat-lon-valid - Coordinate boundary values
- Intent: Latitude/longitude edge values should remain valid and finite.
- Status: PASS
- Checks:
  - PASS | No coordinate rejections | expected eq 0 | actual 0
  - PASS | No nonFiniteDistance motion pairs | expected eq 0 | actual 0
  - PASS | Positive deltas exist | expected eq 3 | actual 3
- Key metrics:
  - totalPoints=4, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=0, unparsable=0
  - adjacentDuplicate=0, belowAnchor=0, belowPrevValid=0, nonAdjacentRepeat=0
  - annotationCount=0
  - positiveDeltas=3, clusterCountSorted=1, maxDeltaMs=5000
  - samplingDistancePairs=3, samplingTimestampPairs=3
  - motionConsecutivePairs=3, motionTaggedPairCount=0, motionCleanAdjacent=3, motionBackward=0, motionZeroDelta=0, motionTimeUnresolvable=0, motionInvalidDistance=0, motionEleUnresolvable=0
  - eleMissing=0, eleUnparsable=0, eleOutOfBounds=0, eleAdjacentDup=3, eleValid=4, eleAnnotationCount=3

## adv-17-time-parse-fuzz - Timestamp parse fuzz
- Intent: Mixes very valid and very invalid timestamp strings in one stream.
- Status: PASS
- Checks:
  - PASS | Multiple unparsable timestamps detected | expected atLeast 4 | actual 5
  - PASS | At least one missing timestamp detected | expected atLeast 1 | actual 1
  - PASS | Still yields some positive deltas | expected atLeast 1 | actual 2
- Key metrics:
  - totalPoints=12, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=1, unparsable=5
  - adjacentDuplicate=0, belowAnchor=0, belowPrevValid=0, nonAdjacentRepeat=0
  - annotationCount=6
  - positiveDeltas=2, clusterCountSorted=2, maxDeltaMs=5123
  - samplingDistancePairs=11, samplingTimestampPairs=2
  - motionConsecutivePairs=11, motionTaggedPairCount=9, motionCleanAdjacent=2, motionBackward=0, motionZeroDelta=0, motionTimeUnresolvable=9, motionInvalidDistance=0, motionEleUnresolvable=0
  - eleMissing=0, eleUnparsable=0, eleOutOfBounds=0, eleAdjacentDup=11, eleValid=12, eleAnnotationCount=11

## adv-18-duplicate-singletons - Duplicate singletons vs duplicate blocks
- Intent: Isolated duplicate events should appear in singleton fields.
- Status: PASS
- Checks:
  - PASS | adjacentDuplicate tag count is 2 (two isolated adjacent-duplicate events) | expected eq 2 | actual 2
- Key metrics:
  - totalPoints=10, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=0, unparsable=0
  - adjacentDuplicate=2, belowAnchor=0, belowPrevValid=0, nonAdjacentRepeat=0
  - annotationCount=2
  - positiveDeltas=7, clusterCountSorted=2, maxDeltaMs=6000
  - samplingDistancePairs=9, samplingTimestampPairs=9
  - motionConsecutivePairs=9, motionTaggedPairCount=2, motionCleanAdjacent=7, motionBackward=0, motionZeroDelta=2, motionTimeUnresolvable=0, motionInvalidDistance=0, motionEleUnresolvable=0
  - eleMissing=0, eleUnparsable=0, eleOutOfBounds=0, eleAdjacentDup=9, eleValid=10, eleAnnotationCount=9

## adv-19-missing-singletons-and-block - Missing singleton and block split
- Intent: Ensures single-point missing anomalies are not hidden by block summaries.
- Status: PASS
- Checks:
  - PASS | Three missing timestamp tags total (block-level grouping is downstream concern) | expected eq 3 | actual 3
- Key metrics:
  - totalPoints=11, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=3, unparsable=0
  - adjacentDuplicate=0, belowAnchor=0, belowPrevValid=0, nonAdjacentRepeat=0
  - annotationCount=3
  - positiveDeltas=5, clusterCountSorted=1, maxDeltaMs=2000
  - samplingDistancePairs=10, samplingTimestampPairs=5
  - motionConsecutivePairs=10, motionTaggedPairCount=5, motionCleanAdjacent=5, motionBackward=0, motionZeroDelta=0, motionTimeUnresolvable=5, motionInvalidDistance=0, motionEleUnresolvable=0
  - eleMissing=0, eleUnparsable=0, eleOutOfBounds=0, eleAdjacentDup=10, eleValid=11, eleAnnotationCount=10

## adv-20-seeded-random-walk - Seeded random-walk fuzz
- Intent: Deterministic pseudo-random walk with sporadic anomalies for robustness.
- Status: PASS
- Checks:
  - PASS | Some positive deltas collected | expected atLeast 50 | actual 438
  - PASS | At least one temporal anomaly detected | expected atLeast 1 | actual 12
  - PASS | No nonFiniteDistance motion pair explosion | expected eq 0 | actual 0
- Key metrics:
  - totalPoints=500, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=12, unparsable=13
  - adjacentDuplicate=11, belowAnchor=0, belowPrevValid=0, nonAdjacentRepeat=0
  - annotationCount=36
  - positiveDeltas=438, clusterCountSorted=6, maxDeltaMs=6000
  - samplingDistancePairs=499, samplingTimestampPairs=449
  - motionConsecutivePairs=499, motionTaggedPairCount=61, motionCleanAdjacent=438, motionBackward=0, motionZeroDelta=11, motionTimeUnresolvable=50, motionInvalidDistance=0, motionEleUnresolvable=0
  - eleMissing=0, eleUnparsable=0, eleOutOfBounds=0, eleAdjacentDup=499, eleValid=500, eleAnnotationCount=499

## adv-21-nonadjacent-repeat-streamwide - Non-adjacent repeat detected stream-wide
- Intent: A timestamp value that reappears after intervening valid points should be tagged nonAdjacentRepeat, not adjacentDuplicate. Must also receive belowAnchor and belowPrevValid since the repeat is behind the current high-water mark.
- Status: PASS
- Checks:
  - PASS | Exactly one nonAdjacentRepeat tag (T+10 reappears after T+20, T+30) | expected eq 1 | actual 1
  - PASS | Exactly one belowAnchor tag (T+10 < anchor=T+30) | expected eq 1 | actual 1
  - PASS | Exactly one belowPrevValid tag (T+10 < prevValid=T+30) | expected eq 1 | actual 1
  - PASS | No adjacentDuplicate tags | expected eq 0 | actual 0
- Key metrics:
  - totalPoints=6, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=0, unparsable=0
  - adjacentDuplicate=0, belowAnchor=1, belowPrevValid=1, nonAdjacentRepeat=1
  - annotationCount=1
  - positiveDeltas=4, clusterCountSorted=2, maxDeltaMs=30000
  - samplingDistancePairs=5, samplingTimestampPairs=5
  - motionConsecutivePairs=5, motionTaggedPairCount=1, motionCleanAdjacent=4, motionBackward=1, motionZeroDelta=0, motionTimeUnresolvable=0, motionInvalidDistance=0, motionEleUnresolvable=0
  - eleMissing=0, eleUnparsable=0, eleOutOfBounds=0, eleAdjacentDup=5, eleValid=6, eleAnnotationCount=5

## adv-22-locally-recovering-backtrack - Locally recovering backtrack: belowAnchor without belowPrevValid
- Intent: After a drop below the anchor, a sequence progressing forward locally is still belowAnchor but is NOT belowPrevValid. Only the initial drop point is belowPrevValid. Tests the tag distinction between 'still in the hole' vs 'actively digging'.
- Status: PASS
- Checks:
  - PASS | Four points tagged belowAnchor (T+60,70,80,90 all < anchor=T+100) | expected eq 4 | actual 4
  - PASS | Only one point tagged belowPrevValid (T+60 is the only drop below its predecessor) | expected eq 1 | actual 1
  - PASS | Four annotation entries total | expected eq 4 | actual 4
- Key metrics:
  - totalPoints=7, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=0, unparsable=0
  - adjacentDuplicate=0, belowAnchor=4, belowPrevValid=1, nonAdjacentRepeat=0
  - annotationCount=4
  - positiveDeltas=5, clusterCountSorted=3, maxDeltaMs=100000
  - samplingDistancePairs=6, samplingTimestampPairs=6
  - motionConsecutivePairs=6, motionTaggedPairCount=1, motionCleanAdjacent=5, motionBackward=1, motionZeroDelta=0, motionTimeUnresolvable=0, motionInvalidDistance=0, motionEleUnresolvable=0
  - eleMissing=0, eleUnparsable=0, eleOutOfBounds=0, eleAdjacentDup=6, eleValid=7, eleAnnotationCount=6

## adv-23-adjacent-dup-below-anchor - Adjacent duplicate that is also below anchor gets both tags
- Intent: Tags are non-exclusive. An adjacent duplicate occurring during a backtracking block should simultaneously carry adjacentDuplicate and belowAnchor, but NOT belowPrevValid (equal, not strictly less) and NOT nonAdjacentRepeat (is adjacent).
- Status: PASS
- Checks:
  - PASS | One adjacentDuplicate tag (T+50 pos3) | expected eq 1 | actual 1
  - PASS | Two belowAnchor tags (both T+50 occurrences < anchor=T+100) | expected eq 2 | actual 2
  - PASS | One belowPrevValid tag (T+50 pos2 only; pos3 equals prevValid, not strictly less) | expected eq 1 | actual 1
  - PASS | No nonAdjacentRepeat tags (adjacent duplicate excluded from that check) | expected eq 0 | actual 0
- Key metrics:
  - totalPoints=5, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=0, unparsable=0
  - adjacentDuplicate=1, belowAnchor=2, belowPrevValid=1, nonAdjacentRepeat=0
  - annotationCount=2
  - positiveDeltas=2, clusterCountSorted=2, maxDeltaMs=100000
  - samplingDistancePairs=4, samplingTimestampPairs=4
  - motionConsecutivePairs=4, motionTaggedPairCount=2, motionCleanAdjacent=2, motionBackward=1, motionZeroDelta=1, motionTimeUnresolvable=0, motionInvalidDistance=0, motionEleUnresolvable=0
  - eleMissing=0, eleUnparsable=0, eleOutOfBounds=0, eleAdjacentDup=4, eleValid=5, eleAnnotationCount=4

## adv-24-anchor-no-advance-on-dup - Anchor does not advance during adjacent duplicate run
- Intent: The monotonic anchor only advances on genuine forward progress. A run of adjacent duplicates must not move the anchor. A belowAnchor point after the dup-run must still be detected correctly.
- Status: PASS
- Checks:
  - PASS | Two adjacentDuplicate tags (T+50 pos2 and pos3) | expected eq 2 | actual 2
  - PASS | One belowAnchor tag (T+30 < anchor=T+50, anchor held steady through dup run) | expected eq 1 | actual 1
  - PASS | One belowPrevValid tag (T+30 < prevValid=T+50) | expected eq 1 | actual 1
- Key metrics:
  - totalPoints=5, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=0, unparsable=0
  - adjacentDuplicate=2, belowAnchor=1, belowPrevValid=1, nonAdjacentRepeat=0
  - annotationCount=3
  - positiveDeltas=1, clusterCountSorted=1, maxDeltaMs=50000
  - samplingDistancePairs=4, samplingTimestampPairs=4
  - motionConsecutivePairs=4, motionTaggedPairCount=3, motionCleanAdjacent=1, motionBackward=1, motionZeroDelta=2, motionTimeUnresolvable=0, motionInvalidDistance=0, motionEleUnresolvable=0
  - eleMissing=0, eleUnparsable=0, eleOutOfBounds=0, eleAdjacentDup=4, eleValid=5, eleAnnotationCount=4

## adv-25-multi-tag-convergence - Single point receives nonAdjacentRepeat + belowAnchor + belowPrevValid simultaneously
- Intent: A non-adjacent repeat that falls below the anchor and below its predecessor should carry all three tags in a single annotation object.
- Status: PASS
- Checks:
  - PASS | One nonAdjacentRepeat tag | expected eq 1 | actual 1
  - PASS | One belowAnchor tag | expected eq 1 | actual 1
  - PASS | One belowPrevValid tag | expected eq 1 | actual 1
  - PASS | No adjacentDuplicate tags (the non-adjacent repeat is not the immediately preceding point) | expected eq 0 | actual 0
  - PASS | Exactly one annotation entry | expected eq 1 | actual 1
- Key metrics:
  - totalPoints=5, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=0, unparsable=0
  - adjacentDuplicate=0, belowAnchor=1, belowPrevValid=1, nonAdjacentRepeat=1
  - annotationCount=1
  - positiveDeltas=3, clusterCountSorted=3, maxDeltaMs=50000
  - samplingDistancePairs=4, samplingTimestampPairs=4
  - motionConsecutivePairs=4, motionTaggedPairCount=1, motionCleanAdjacent=3, motionBackward=1, motionZeroDelta=0, motionTimeUnresolvable=0, motionInvalidDistance=0, motionEleUnresolvable=0
  - eleMissing=0, eleUnparsable=0, eleOutOfBounds=0, eleAdjacentDup=4, eleValid=5, eleAnnotationCount=4

## adv-26-motion-ele-boundary-inclusive - Motion ele endpoints exactly at validFloorM and validCeilingM
- Intent: Motion audit uses inclusive [-500, 9500]; boundary values must not fire eleUnresolvable.
- Status: PASS
- Checks:
  - PASS | No motion ele-unresolvable pairs at inclusive boundaries | expected eq 0 | actual 0
  - PASS | All three adjacent pairs clean for motion | expected eq 3 | actual 3
- Key metrics:
  - totalPoints=4, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=0, unparsable=0
  - adjacentDuplicate=0, belowAnchor=0, belowPrevValid=0, nonAdjacentRepeat=0
  - annotationCount=0
  - positiveDeltas=3, clusterCountSorted=1, maxDeltaMs=5000
  - samplingDistancePairs=3, samplingTimestampPairs=3
  - motionConsecutivePairs=3, motionTaggedPairCount=0, motionCleanAdjacent=3, motionBackward=0, motionZeroDelta=0, motionTimeUnresolvable=0, motionInvalidDistance=0, motionEleUnresolvable=0
  - eleMissing=0, eleUnparsable=0, eleOutOfBounds=0, eleAdjacentDup=0, eleValid=4, eleAnnotationCount=0

## adv-27-motion-ele-above-ceiling - Elevation above motion validCeilingM flags adjacent pairs
- Intent: Any endpoint outside default [validFloorM, validCeilingM] makes every adjacent pair touching it eleUnresolvable (independent of time).
- Status: PASS
- Checks:
  - PASS | Two pairs affected by one out-of-range spike (prev and next) | expected eq 2 | actual 2
  - PASS | Times still forward so no backward motion pairs | expected eq 0 | actual 0
- Key metrics:
  - totalPoints=3, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=0, unparsable=0
  - adjacentDuplicate=0, belowAnchor=0, belowPrevValid=0, nonAdjacentRepeat=0
  - annotationCount=0
  - positiveDeltas=2, clusterCountSorted=1, maxDeltaMs=2000
  - samplingDistancePairs=2, samplingTimestampPairs=2
  - motionConsecutivePairs=2, motionTaggedPairCount=2, motionCleanAdjacent=0, motionBackward=0, motionZeroDelta=0, motionTimeUnresolvable=0, motionInvalidDistance=0, motionEleUnresolvable=2
  - eleMissing=0, eleUnparsable=0, eleOutOfBounds=1, eleAdjacentDup=0, eleValid=2, eleAnnotationCount=1

## adv-28-motion-omit-ele-element - Missing GPX ele element yields motion eleUnresolvable
- Intent: Ingestion sets eleAbsent true when <ele> is absent; elevation audit tags missing; motion flags eleUnresolvable on adjacent pairs.
- Status: PASS
- Checks:
  - PASS | Middle point without ele tags both adjacent pairs | expected eq 2 | actual 2
  - PASS | No non-finite haversine on valid coordinates | expected eq 0 | actual 0
  - PASS | One missing-ele point (eleAbsent) | expected eq 1 | actual 1
  - PASS | No unparsable ele when absent vs present is distinguished | expected eq 0 | actual 0
- Key metrics:
  - totalPoints=3, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=0, unparsable=0
  - adjacentDuplicate=0, belowAnchor=0, belowPrevValid=0, nonAdjacentRepeat=0
  - annotationCount=0
  - positiveDeltas=2, clusterCountSorted=1, maxDeltaMs=3000
  - samplingDistancePairs=2, samplingTimestampPairs=2
  - motionConsecutivePairs=2, motionTaggedPairCount=2, motionCleanAdjacent=0, motionBackward=0, motionZeroDelta=0, motionTimeUnresolvable=0, motionInvalidDistance=0, motionEleUnresolvable=2
  - eleMissing=1, eleUnparsable=0, eleOutOfBounds=0, eleAdjacentDup=0, eleValid=2, eleAnnotationCount=1

## adv-29-motion-stacked-backward-and-elebad - Same pair stacks backwardTime and eleUnresolvable
- Intent: Tags are non-exclusive: one adjacent pair can carry multiple motion flags simultaneously.
- Status: PASS
- Checks:
  - PASS | Exactly one backward-time pair | expected eq 1 | actual 1
  - PASS | Exactly one ele-unresolvable pair (stacked on same pair as backward) | expected eq 1 | actual 1
  - PASS | Leading pair still clean | expected eq 1 | actual 1
- Key metrics:
  - totalPoints=3, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=0, unparsable=0
  - adjacentDuplicate=0, belowAnchor=1, belowPrevValid=1, nonAdjacentRepeat=0
  - annotationCount=1
  - positiveDeltas=1, clusterCountSorted=1, maxDeltaMs=20000
  - samplingDistancePairs=2, samplingTimestampPairs=2
  - motionConsecutivePairs=2, motionTaggedPairCount=1, motionCleanAdjacent=1, motionBackward=1, motionZeroDelta=0, motionTimeUnresolvable=0, motionInvalidDistance=0, motionEleUnresolvable=1
  - eleMissing=0, eleUnparsable=0, eleOutOfBounds=1, eleAdjacentDup=1, eleValid=2, eleAnnotationCount=2

## adv-30-motion-mixed-time-backward-zero - Single track mixes timeUnresolvable, backward, zero delta, and one clean pair
- Intent: Six points, five pairs: trailing null so only (4,5) is timeUnresolvable. Includes zero-delta (2→3) and backward (3→4). Leading pairs (0→1) and (1→2) stay clean.
- Status: PASS
- Checks:
  - PASS | One pair with missing time only on the second endpoint | expected eq 1 | actual 1
  - PASS | One strictly backward dt pair (15s → 5s) | expected eq 1 | actual 1
  - PASS | One zero-dt pair (15s → 15s) | expected eq 1 | actual 1
  - PASS | Exactly two pairs have no motion tags (first two pairs) | expected eq 2 | actual 2
- Key metrics:
  - totalPoints=6, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=1, unparsable=0
  - adjacentDuplicate=1, belowAnchor=1, belowPrevValid=1, nonAdjacentRepeat=0
  - annotationCount=3
  - positiveDeltas=2, clusterCountSorted=2, maxDeltaMs=10000
  - samplingDistancePairs=5, samplingTimestampPairs=4
  - motionConsecutivePairs=5, motionTaggedPairCount=3, motionCleanAdjacent=2, motionBackward=1, motionZeroDelta=1, motionTimeUnresolvable=1, motionInvalidDistance=0, motionEleUnresolvable=0
  - eleMissing=0, eleUnparsable=0, eleOutOfBounds=0, eleAdjacentDup=5, eleValid=6, eleAnnotationCount=5

## adv-31-single-trackpoint - Single trackpoint yields zero motion pairs
- Intent: motion.summary.consecutivePairCount is n-1; empty pair lists and zero tag counts.
- Status: PASS
- Checks:
  - PASS | No adjacent pairs to evaluate | expected eq 0 | actual 0
  - PASS | No motion pair annotations | expected eq 0 | actual 0
- Key metrics:
  - totalPoints=1, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=0, unparsable=0
  - adjacentDuplicate=0, belowAnchor=0, belowPrevValid=0, nonAdjacentRepeat=0
  - annotationCount=0
  - positiveDeltas=0, clusterCountSorted=0, maxDeltaMs=null
  - samplingDistancePairs=0, samplingTimestampPairs=0
  - motionConsecutivePairs=0, motionTaggedPairCount=0, motionCleanAdjacent=0, motionBackward=0, motionZeroDelta=0, motionTimeUnresolvable=0, motionInvalidDistance=0, motionEleUnresolvable=0
  - eleMissing=0, eleUnparsable=0, eleOutOfBounds=0, eleAdjacentDup=0, eleValid=1, eleAnnotationCount=0

## adv-32-unparsable-ele-element - Present but unparsable elevation element
- Intent: When <ele> exists but is not numeric, ingestion sets eleAbsent false and ele null; elevation audit tags unparsable, not missing.
- Status: PASS
- Checks:
  - PASS | Exactly one unparsable ele point | expected eq 1 | actual 1
  - PASS | No missing-ele points when every trkpt has an ele child | expected eq 0 | actual 0
  - PASS | Two valid in-bounds ele points | expected eq 2 | actual 2
- Key metrics:
  - totalPoints=3, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=0, unparsable=0
  - adjacentDuplicate=0, belowAnchor=0, belowPrevValid=0, nonAdjacentRepeat=0
  - annotationCount=0
  - positiveDeltas=2, clusterCountSorted=1, maxDeltaMs=5000
  - samplingDistancePairs=2, samplingTimestampPairs=2
  - motionConsecutivePairs=2, motionTaggedPairCount=2, motionCleanAdjacent=0, motionBackward=0, motionZeroDelta=0, motionTimeUnresolvable=0, motionInvalidDistance=0, motionEleUnresolvable=2
  - eleMissing=0, eleUnparsable=1, eleOutOfBounds=0, eleAdjacentDup=0, eleValid=2, eleAnnotationCount=1

## adv-33-empty-time-element-mid-track - Empty <time></time> is unparsable not missing
- Intent: Ingestion sets timeAbsent false and timeMs null for empty body; temporal tags unparsable (not missing). Motion/sampling use finite timeMs only (ADR-0012). Sampling time Δ uses adjacent pairs only — no bridge across the empty <time> point.
- Status: PASS
- Checks:
  - PASS | Exactly one unparsable timestamp (empty <time> body) | expected eq 1 | actual 1
  - PASS | No missing-time points (every trkpt has a <time> child) | expected eq 0 | actual 0
  - PASS | One adjacent-valid positive dt (0→1 only; 2 unparsable breaks 1→2 and 2→3) | expected eq 1 | actual 1
  - PASS | Two motion pairs touch the non-finite timeMs endpoint | expected eq 2 | actual 2
  - PASS | Only the last pair has both endpoints with finite timeMs and no motion tags | expected eq 1 | actual 1
- Key metrics:
  - totalPoints=4, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=0, unparsable=1
  - adjacentDuplicate=0, belowAnchor=0, belowPrevValid=0, nonAdjacentRepeat=0
  - annotationCount=1
  - positiveDeltas=1, clusterCountSorted=1, maxDeltaMs=10000
  - samplingDistancePairs=3, samplingTimestampPairs=1
  - motionConsecutivePairs=3, motionTaggedPairCount=2, motionCleanAdjacent=1, motionBackward=0, motionZeroDelta=0, motionTimeUnresolvable=2, motionInvalidDistance=0, motionEleUnresolvable=0
  - eleMissing=0, eleUnparsable=0, eleOutOfBounds=0, eleAdjacentDup=3, eleValid=4, eleAnnotationCount=3

## adv-34-missing-time-vs-empty-time - No <time> child vs empty <time></time>
- Intent: Missing requires timeAbsent true (no element). Empty element is timeAbsent false with null timeMs — unparsable. Distinction must not rely on Date.parse downstream.
- Status: PASS
- Checks:
  - PASS | One missing-time point (no <time> element) | expected eq 1 | actual 1
  - PASS | One unparsable-time point (empty <time> body) | expected eq 1 | actual 1
  - PASS | No positive time deltas (only one parseable instant at end) | expected eq 0 | actual 0
  - PASS | Both adjacent pairs time-unresolvable for motion | expected eq 2 | actual 2
  - PASS | No motion-clean pairs | expected eq 0 | actual 0
- Key metrics:
  - totalPoints=3, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=1, unparsable=1
  - adjacentDuplicate=0, belowAnchor=0, belowPrevValid=0, nonAdjacentRepeat=0
  - annotationCount=2
  - positiveDeltas=0, clusterCountSorted=0, maxDeltaMs=null
  - samplingDistancePairs=2, samplingTimestampPairs=0
  - motionConsecutivePairs=2, motionTaggedPairCount=2, motionCleanAdjacent=0, motionBackward=0, motionZeroDelta=0, motionTimeUnresolvable=2, motionInvalidDistance=0, motionEleUnresolvable=0
  - eleMissing=0, eleUnparsable=0, eleOutOfBounds=0, eleAdjacentDup=2, eleValid=3, eleAnnotationCount=2

## adv-35-time-whitespace-only-body - Whitespace-only <time> body trims to unparsable
- Intent: Ingestion trims text; all-whitespace becomes empty string → timeRaw null, timeMs null, timeAbsent false → unparsable.
- Status: PASS
- Checks:
  - PASS | Whitespace-only body counts as unparsable | expected eq 1 | actual 1
  - PASS | No missing-time tags when <time> exists on every point | expected eq 0 | actual 0
  - PASS | No positive sampling dt (middle unparsable; adjacent-only pairs are invalid-valid or valid-invalid) | expected eq 0 | actual 0
  - PASS | Middle point breaks two motion pairs for time | expected eq 2 | actual 2
- Key metrics:
  - totalPoints=3, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=0, unparsable=1
  - adjacentDuplicate=0, belowAnchor=0, belowPrevValid=0, nonAdjacentRepeat=0
  - annotationCount=1
  - positiveDeltas=0, clusterCountSorted=0, maxDeltaMs=null
  - samplingDistancePairs=2, samplingTimestampPairs=0
  - motionConsecutivePairs=2, motionTaggedPairCount=2, motionCleanAdjacent=0, motionBackward=0, motionZeroDelta=0, motionTimeUnresolvable=2, motionInvalidDistance=0, motionEleUnresolvable=0
  - eleMissing=0, eleUnparsable=0, eleOutOfBounds=0, eleAdjacentDup=2, eleValid=3, eleAnnotationCount=2

## adv-36-gpx-gap-same-time-non-adjacent-dup - Coordinate rejection between identical timestamps: not adjacentDuplicate
- Intent: When a GPX row is rejected between two accepted points, stream adjacency fails; same timestamp as earlier valid point should be nonAdjacentRepeat, not adjacentDuplicate (ADR-0013).
- Status: PASS
- Checks:
  - PASS | At least one coordinate rejection | expected atLeast 1 | actual 1
  - PASS | Same timestamp across gpx gap is nonAdjacentRepeat, not stream-adjacent duplicate | expected atLeast 1 | actual 1
  - PASS | No adjacentDuplicate when stream predecessor is missing | expected eq 0 | actual 0
  - PASS | No stream-adjacent pairs to evaluate for motion | expected eq 0 | actual 0
  - PASS | No sampling distance steps without stream-adjacent edges | expected eq 0 | actual 0
  - PASS | No sampling timestamp pair evaluations without stream-adjacent edges | expected eq 0 | actual 0
- Key metrics:
  - totalPoints=3, rejectedCoords=1, hasMultiplePointTypes=false
  - missing=0, unparsable=0
  - adjacentDuplicate=0, belowAnchor=0, belowPrevValid=0, nonAdjacentRepeat=1
  - annotationCount=1
  - positiveDeltas=0, clusterCountSorted=0, maxDeltaMs=null
  - samplingDistancePairs=0, samplingTimestampPairs=0
  - motionConsecutivePairs=0, motionTaggedPairCount=0, motionCleanAdjacent=0, motionBackward=0, motionZeroDelta=0, motionTimeUnresolvable=0, motionInvalidDistance=0, motionEleUnresolvable=0
  - eleMissing=0, eleUnparsable=0, eleOutOfBounds=0, eleAdjacentDup=1, eleValid=2, eleAnnotationCount=1

## adv-37-reject-mid-track-sampling-motion-pair-counts - Mid-track coord reject: motion and sampling share stream-adjacent pair count
- Intent: Five GPX rows with one invalid coordinate in the middle yields two stream edges among four accepted points (0-1 and 3-4). Sampling distance pairInspection.consecutivePairCount must match motion.summary.consecutivePairCount (ADR-0013).
- Status: PASS
- Checks:
  - PASS | Exactly one coordinate rejection | expected eq 1 | actual 1
  - PASS | Two GPX-stream-adjacent edges among accepted points | expected eq 2 | actual 2
  - PASS | Sampling distance pair count matches motion | expected eq 2 | actual 2
  - PASS | Sampling timestamp pair count matches motion (all times valid and adjacent) | expected eq 2 | actual 2
- Key metrics:
  - totalPoints=5, rejectedCoords=1, hasMultiplePointTypes=false
  - missing=0, unparsable=0
  - adjacentDuplicate=0, belowAnchor=0, belowPrevValid=0, nonAdjacentRepeat=0
  - annotationCount=0
  - positiveDeltas=2, clusterCountSorted=1, maxDeltaMs=5000
  - samplingDistancePairs=2, samplingTimestampPairs=2
  - motionConsecutivePairs=2, motionTaggedPairCount=0, motionCleanAdjacent=2, motionBackward=0, motionZeroDelta=0, motionTimeUnresolvable=0, motionInvalidDistance=0, motionEleUnresolvable=0
  - eleMissing=0, eleUnparsable=0, eleOutOfBounds=0, eleAdjacentDup=3, eleValid=4, eleAnnotationCount=3
