# ADR-correction-0003: Handoff — `workingOrderedPoints` and pre-split trusted/full/excluded

**Date**: 2026-04-13  
**Status**: accepted  

## Context

Downstream smoothing and metrics need a **single** honest traversal and a **default** trusted polyline without re-deriving masks on every consumer. Correction **mutates order** in early stages (**dedupe**, **reversal**) and in **`resolution-apply`** (**block** / **singleton** / **duplicate** proposals that pass **overlap** and **coupling** gates); audit is **immutable** on the original ingest pass.

## Decision

- **`workingOrderedPoints`**: **Mutable** pipeline array during correction (order changes after reversal and **`resolution-apply`**; drops after adjacent dedupe). **Traversal neighbours** for brackets and kinematic windows are read from the **current** snapshot unless a rule explicitly uses **original `gpxIndex`** windows (sampling baseline).

- **`correction.fullOrderedPoints`**: Final traversal order after correction (**drops** removed); includes untrusted rows for UX.

- **`canonicalTrustedPoints`**: **Filter** of `fullOrderedPoints` excluding **`correction.drops`** and indices in **`correction.excludedFromTrust`**. **Time-conditioned** eligibility still uses **`audit` + participation** where needed.

- **`correction.excludedFromTrust`**: **Correction-only** exclusions (flags, masks, same-time non-winners, coupled blobs, etc.) — not a mirror of ingestion rejects or audit temporal missing/unparsable.

## Alternatives Considered

### Alternative 1: Single merged list + masks only (no pre-split)

- **Pros**: One array.
- **Cons**: Every consumer recomputes trust; error-prone.
- **Why not**: **Pre-split at `correction-export`** keeps dumb downstream **cheap**.

### Alternative 2: Put all non-participating indices in `excludedFromTrust`

- **Pros**: One list for “bad” rows.
- **Cons**: Duplicates audit; diverging sources of truth.
- **Why not**: **Rejected** — audit/participation own gap semantics; `excludedFromTrust` stays correction-specific.

## Consequences

### Positive

- Clear contract for kinematic / smoothing defaults vs full-trace UI.

### Negative

- Exporters must apply **consistent** partition rules.

### Risks

- **`gpxIndex` gaps** between consecutive trusted rows — document for dynamics (ingestion + drops + exclusions).
