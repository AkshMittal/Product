# ADR-correction-0014: Traversal-adjacent as the canonical adjacency primitive for correction-layer dedupe and neighbour analysis

**Date**: 2026-04-23  
**Status**: accepted

## Context

Two adjacency concepts exist in the pipeline:

- **Stream-adjacent** (`curr.gpxIndex === prev.gpxIndex + 1`): an immutable property of the raw input. Two points are stream-adjacent if and only if they were consecutive in the original GPX document. This never changes — `gpxIndex` is assigned at ingestion and does not mutate.

- **Traversal-adjacent**: consecutive in the current `workingOrderedPoints` snapshot. This is mutable — after any reorder, drop, or insert, the traversal-adjacent neighbours of a surviving point change, even though their `gpxIndex` values do not.

In earlier designs, dedupe and neighbour analysis implicitly used stream-adjacency throughout. This was incorrect for Phase 1 and beyond, where `workingOrderedPoints` may have been reordered by chunk reorder, reversal, or prior-pass block reorder. Stream-adjacent pairs in a reordered snapshot may span large time or distance gaps; traversal-adjacent pairs in the current snapshot reflect the actual forward-time story as the solver understands it.

A concrete failure mode: after a segment reversal, stream-adjacent pairs `(i, i+1)` are no longer meaningful for duplicate detection — the pair `(i+1, i)` in traversal order is the meaningful relationship. Using stream-adjacency would silently skip these.

## Decision

### Two primitives with distinct, non-overlapping scopes

#### Stream-adjacent: raw input only

Used **only** where the question is genuinely about the original recording structure:

- `objective-adjacent-dedupe` initial pass: checks the raw input snapshot before any mutation. A stream-adjacent identical pair in the raw input is an objective duplicate regardless of any future reordering.
- `audit` pair definitions: per `audit.sampling.perSegment`, Δt density uses `gpxIndex` window pairs because the question is "how densely were points recorded", not "what is the current traversal story".
- `audit.ingestion` stream-adjacency for initial ingestion sanity.

Stream-adjacency never changes. A pair that was stream-adjacent at ingestion is stream-adjacent for the entire pipeline lifetime.

#### Traversal-adjacent: canonical for all correction-layer dedupe and neighbour analysis

Used for every per-pass and Phase 2 consumer where the relevant question is "what is the current forward-time story":

| Consumer | Traversal-adjacent basis |
|---|---|
| `duplicate-proposal` per-pass `adjacent-exact-drop` rescan | Yes — within one `trkSegIndex` in Phase 1. |
| Block detection (`belowAnchor` runs) | Yes — within one `trkSegIndex`. |
| Bracket selection (block-proposal, singleton-proposal) | Yes — segment-bounded, informed by `spineIntervals`. |
| Coupling kinematic neighbours | Yes — segment-bounded. |
| Phase 2 edge reconciliation | Cross-segment by definition (S[i].lastSpine vs S[i+1].firstSpine). |
| Phase 3 residual diagnostic sweep | Yes — across full canonical traversal. |

**Traversal adjacency is recomputed after every mutation.** After `resolution-apply`, after chunk reorder, after reversal, after Phase 2 mutation — any consumer reading "neighbours" reads from the current `workingOrderedPoints` snapshot.

### Segment boundary as a hard wall for traversal adjacency in Phase 1

In Phase 1, traversal adjacency does **not** cross `trkSegIndex`. The segment boundary is treated as a hard wall — even if the last point of S[i] and the first point of S[i+1] are traversal-adjacent in `workingOrderedPoints`, no Phase 1 module treats them as neighbours. Cross-segment traversal adjacency is only used in Phase 2 (edge reconciliation) and Phase 3 (residual sweep), where it is explicitly required.

### Cross-segment adjacent dedupe exception

The one case where traversal adjacency crosses a segment boundary in Phase 2: if S[i].lastPoint and S[i+1].firstPoint are traversal-adjacent and satisfy the exact-duplicate predicate (identical `timeMs`, `lat`, `lon`, `ele` per the equality table in ADR-correction-0004), and both are spine-stable, one may be dropped in Phase 2 with reason `adjacent-exact-duplicate` and `stage: 'edge-reconciliation'`. If either is unstable, no drop — defer to telemetry.

### `objective-adjacent-dedupe` initial pass uses stream-adjacency only

The initial deduplication pass (before any mutation) is stream-adjacent because:
1. `workingOrderedPoints` is a copy of `points` at this stage — no mutations have occurred yet.
2. The objective is to find raw-input exact duplicates, which is a stream-adjacent question.
3. Running traversal-adjacent dedupe at this point produces the same result as stream-adjacent (they are identical before any mutation), but clarifying the intent prevents future confusion if the two ever diverge.

After the initial pass, all per-pass deduplication is traversal-adjacent.

## Alternatives Considered

### Alternative 1: Always use stream-adjacent for all dedupe

- **Pros:** Simpler — `gpxIndex` pairs are immutable and easy to cache.
- **Cons:** After chunk reorder or reversal, stream-adjacent pairs no longer reflect the forward-time story. An exact duplicate created by phase-1 reordering (two previously non-adjacent identical points becoming adjacent in traversal order) would not be detected.
- **Why not:** Incorrect after any mutation that reorders points. Traversal-adjacent is the truthful primitive for post-mutation dedupe.

### Alternative 2: Always use traversal-adjacent for all dedupe, including initial pass

- **Pros:** Single primitive everywhere.
- **Cons:** Before any mutation, traversal-adjacent and stream-adjacent are identical in content. Labeling the initial pass as traversal-adjacent when the intent is "raw input stream" obfuscates the intent. The raw-input question is a stream-adjacency question; the name matters for documentation and code readability.
- **Why not:** Stream-adjacent is the correct and honest label for the initial-pass question, even though the result is identical at that point in time.

### Alternative 3: No per-pass adjacent-exact-drop rescan — drop all exact pairs at initial pass only

- **Pros:** Dedupe is a single pre-phase-1 operation.
- **Cons:** Phase 1 mutations (block reorder, singleton insert) may create new traversal-adjacent identical pairs. These would not be detected if the only dedupe pass is pre-phase-1.
- **Why not:** Per-pass `adjacent-exact-drop` is needed to catch dedupe opportunities created by Phase 1 mutations. Traversal-adjacent rescan on each pass is the correct approach.

## Consequences

### Positive

- Dedupe and neighbour analysis are always computed against the current forward-time story.
- The initial-pass vs per-pass distinction is explicit; no implicit assumption that the pre-mutation snapshot is valid after mutation.
- Segment boundary as a hard wall in Phase 1 eliminates the class of cross-segment neighbour reference bugs during per-segment solve.

### Negative

- Traversal adjacency must be re-walked after every mutation. For large segments with many proposals, this is O(segment size) per pass. Acceptable for MVP; optimize only if profiling shows a problem.
- The stream-adjacent initial pass is a special case that must be explicitly documented and tested; failing to distinguish it from the per-pass traversal-adjacent rescan is a potential source of confusion.

### Risks

- If `workingOrderedPoints` is mutated in place but the traversal-adjacency walk is cached (e.g. memoized from the previous pass), stale neighbours will be used. The mutation protocol must invalidate any adjacency cache immediately on every `resolution-apply` and Phase 2 mutation.
