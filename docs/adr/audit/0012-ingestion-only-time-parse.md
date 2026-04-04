# ADR-0012: GPX time parsing only at ingestion; audits consume `timeMs`

**Date**: 2026-04-04  
**Status**: accepted  
**Deciders**: product / audit pipeline maintainers

## Context

GPX `<time>` text is converted to a millisecond instant with `Date.parse` during ingestion (`timeMs`), alongside `timeAbsent` (no `<time>` child) and `timeRaw` (trimmed text for observation). Downstream audit modules previously duplicated `Date.parse(timeRaw)` as a fallback. That did not change outcomes for ingestion-shaped points but blurred responsibility, suggested “re-parsing” as classification logic, and conflicted with using **`timeAbsent` and `timeMs` together** to distinguish **missing** from **unparsable**.

## Decision

1. **Only ingestion** calls `Date.parse` on GPX time text and sets `timeMs` (finite or `null`) and `timeAbsent` (`true` / `false`).
2. **Temporal, sampling, and motion** audits use **finite `timeMs` only** for instant math and parseable counts. They **do not** parse `timeRaw`.
3. **`timeRaw`** after ingestion is **forward-only**: it may appear on sparse annotations (e.g. temporal `unparsable`) for humans or tools; it is **not** an input to audit control flow.
4. **Missing vs unparsable** remains: **`timeAbsent === true`** → missing; **`timeAbsent === false`** and no finite **`timeMs`** → unparsable. Audits do not infer missing from “null `timeMs`” alone without `timeAbsent` where the temporal module classifies points.
5. **No shared npm-style export** of a resolver across modules for this decision; each module inlines the small “finite `timeMs`?” check until a future consolidation is justified.

## Alternatives Considered

### Alternative 1: Keep downstream `Date.parse(timeRaw)` as legacy fallback

- **Pros**: Tolerates hand-built point arrays without `timeMs`.
- **Cons**: Duplicate policy, misleading names (“parse” at pair loop), no semantic gain for real GPX ingestion.
- **Why not**: Ingestion is the single parse site; contract is ingestion-shaped points.

### Alternative 2: Shared utility module re-exported to all audits

- **Pros**: DRY, one implementation of the rule.
- **Cons**: Extra coupling file; user preference for modules standing alone for now.
- **Why not**: Deferred; each module keeps a minimal local check.

## Consequences

### Positive

- Clear ownership: ingestion parses; audits observe `timeMs` / `timeAbsent`.
- Motion `timeUnresolvable` and sampling time deltas align with the same instant source as temporal `parseableTimestampPointCount`.

### Negative

- Point objects that omit `timeMs` and only supply `timeRaw` are no longer supported by sampling/motion/temporal without going through ingestion.

### Risks

- **Malformed points** (`timeAbsent` missing): temporal audit treats as missing unless finite `timeMs` is present; document ingestion as the required producer.
