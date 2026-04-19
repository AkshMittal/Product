# ADR-correction-0004: Objective adjacent dedupe — scope and elevation resolution

**Date**: 2026-04-13  
**Status**: accepted  

## Context

Duplicate observations appear **adjacent** in stream order and **non-adjacent** in the file. Collapsing **non-adjacent** 100% matches assumes one point is redundant on the **correct global spine** when **neither** may be — unsafe without spine-aware or multi-pass policy.

**Elevation** is often missing, unparsable, or out-of-bounds on one side of an otherwise duplicate pair; MVP needs deterministic **drop vs flag** rules.

## Decision

1. **`objective-adjacent-dedupe`** operates on **stream-adjacent** pairs only (**ADR-0013** `curr.gpxIndex === prev.gpxIndex + 1`).

2. **Non-adjacent** exact duplicate groups: **no** drop in this module — handled in **`duplicate-proposal`** (e.g. **`duplicate.exact_group_unresolved`**, flag + mask, MVP). **Automated non-adjacent dedupe** deferred to **post-MVP** (recursive / spine-aware policy).

3. **Usable `ele`:** finite and inside the same band as **`audit.elevation`** / motion parameters. **Not usable:** missing, unparsable, **out-of-bounds** (per **`audit.elevation`**).

4. **When `timeMs`, `lat`, `lon` match:**  
   - Full quadruplet equal → drop one.  
   - Both lack usable `ele` → drop one.  
   - Exactly one usable `ele` → drop the other.  
   - Both finite but both **OOB** → drop one; survivor **`ele = null`** (and consistent `eleAbsent` / metadata) for downstream DEM / interpolate.  
   - **Both** usable `ele` but **unequal** → **flag both** (`adjacent-duplicate-ele-mismatch`), **no drop**.

5. **Immutability:** new objects when clearing survivor `ele`; do not mutate **`audit`**.

## Alternatives Considered

### Alternative 1: Drop non-adjacent 100% duplicates in the same pass

- **Pros**: Fewer points earlier.
- **Cons**: Wrong collapse when both copies are off-spine or context-dependent.
- **Why not**: **Rejected** for MVP.

### Alternative 2: Any `ele` difference → flag both, never drop

- **Pros**: Maximum caution.
- **Cons**: Leaves redundant rows when one side clearly has no usable height.
- **Why not**: **Superseded** by asymmetric and OOB survivor rules above; **conflicting dual usable `ele`** still flags both.

## Consequences

### Positive

- Safe **local** dedupe; honest handling of **ele** channel.

### Negative

- Non-adjacent exact groups remain until **`duplicate-proposal`** / policy.

### Risks

- OOB survivor `null` must be explicit in export objects, not assumed from ingestion.
