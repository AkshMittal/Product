<!-- generated-by: gsd-doc-writer -->
# reversal-check.js — Two-Stage Reversal Detection and Application

## Purpose

Detects and corrects GPX segments (or the full recording) that were recorded in reverse temporal order. Operates in two stages: a cheap global hypothesis first, then per-segment reversals for segments flagged `isFullyReversed` by `participation-check`.

## Inputs

```js
checkAndApplyReversals(workingState, segmentParticipationProfiles, perSegmentTags)
```

| Parameter | Type | Description |
|---|---|---|
| `workingState` | Object | Mutable working state |
| `segmentParticipationProfiles` | Array | Profiles from participation-check (mutated: `mode`, `exitReason` updated on accept) |
| `perSegmentTags` | Map | `trkSegIndex → segTags` |

## Outputs

```js
{ globalAccepted: boolean, perSegmentAccepted: number[], perSegmentRejected: number[] }
```

Side effects on `workingState`:
- **Global accept**: `workingOrderedPoints` reversed; rearrangement `'full-array-reversal'` added
- **Global reject**: `workingOrderedPoints` reverted; session annotation `'reversal_unconfirmed'` added
- **Per-segment accept**: segment's points reordered in-place; rearrangement `'segment-reversal'` + segment annotation `'is_fully_reversed'` added
- **Per-segment reject**: reverted; segment annotation `'segment_reversal_unconfirmed'`; all segment members → `excludedFromTrust 'reversal_unconfirmed_member'`

## Key logic

**Stage 1 — Global hypothesis**:
1. Snapshot current `workingOrderedPoints`
2. Reverse entire array
3. Synthesise per-segment tags from the reversed snapshot (only Δt counters — original anomaly arrays don't apply to reversed ordering, per ADR-0005)
4. Run `isSegmentCorrectionIdle` on every segment with synthetic tags
5. If all idle → accept (write rearrangement, return immediately — mutually exclusive with per-segment)
6. Else → revert; emit `'reversal_unconfirmed'` session annotation

**Stage 2 — Per-segment** (only for profiles with `isFullyReversed === true`):

For each reversed-candidate segment:
1. Reverse segment's points within `workingOrderedPoints` via `spliceSegment`
2. Check **internal monotonicity**: every consecutive parseable pair must have `Δt > 0`
3. Check **seam consistency**: reversed segment's `[revMin, revMax]` must not undercut the preceding segment's `maxTimeMs` or exceed the following segment's `minTimeMs`
4. **Accept** if both pass: write `'segment-reversal'` rearrangement + `'is_fully_reversed'` annotation; update `rangeBySeg` for downstream segments
5. **Reject** if either fails: `spliceSegment` reverts to original order; write `'segment_reversal_unconfirmed'` annotation; all segment points → `excludedFromTrust 'reversal_unconfirmed_member'`

`spliceSegment` replaces the contiguous slot of a segment in `workingOrderedPoints` with a supplied replacement array.

## Invariants

- Global and per-segment reversals are mutually exclusive: global accept returns immediately without attempting per-segment
- Per-segment reversals are evaluated sequentially in `trkSegIndex` order; each accept updates `rangeBySeg` so subsequent segments see the correct seam timestamps
- Rejected per-segment reversals are fully reverted before the next segment is evaluated
- Synthetic tags for the global hypothesis check only Δt-derived fields; original `belowAnchor` etc. are ignored

## Integration

- Called from `correction-runner.js` step 5, after `objectiveDedupe`
- Followed by `correction-idle` recompute and optional short-circuit
- Depends on `correction-idle.isSegmentCorrectionIdle` for the global hypothesis check

## Related ADRs

- ADR-0005 — reversal check design
