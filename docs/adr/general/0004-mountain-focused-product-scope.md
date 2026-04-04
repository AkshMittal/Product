# ADR-0004: Mountain-focused product scope and personal log wedge

**Date**: 2026-04-02
**Status**: accepted
**Deciders**: Product / engineering (documented in `docs/project/product-roadmap.md`)

## Context

General fitness and multi-sport platforms optimize for breadth (steps, zones, generic activities). This product targets **trekkers and climbers**: terrain-aware assumptions, honest handling of messy GPS in mountains, and analytics that remain trustworthy when data quality is uneven. Scope creep toward a generic activity platform would dilute the methodology, overload UX with irrelevant taxonomies, and slow delivery of the first shippable wedge.

Market and product forces: sensitive location+time data requires privacy trust; early adoption needs a **repeated win** (personal value) plus clarity of computation; a **personal mountain log** with notes and photos anchored to the route creates a data loop for future interpretation without pretending the audit layer is “done learning.”

## Decision

The product stays **mountain-focused** rather than pursuing broad multi-sport parity. User input prioritizes **mountain-engaged section scoping** and route context over a large generic activity taxonomy. The **MVP wedge** is a private-by-default **personal log** built on the audit engine: track library, per-track audit inspection, anchored **notes** and optional **photos**, and exports that combine track, audit, and user annotations.

v1 discipline: prioritize **objective, high-confidence exclusions and flags** over aggressive interpretation; state undefined or unreliable regions clearly for time-based metrics; keep cleaning **versioned, reversible, and reason-tagged**; avoid deep kinematic correction and silent smoothing until explicit policy layers exist.

## Alternatives Considered

### Alternative 1: Generic activity / fitness platform positioning

- **Pros**: Larger addressable market narrative; reuse of common UX patterns.
- **Cons**: Conflicts with methodology visibility and mountain-specific controls; spreads engineering thin; weaker differentiation.
- **Why not**: Explicitly rejected in roadmap—stay mountain-focused.

### Alternative 2: MVP as “analytics only” without logbook primitives (notes/photos/library)

- **Pros**: Faster path to charts-only demos.
- **Cons**: Weak habit loop; less real-world grounding for labels and future interpretation; misses defined Phase 1 deliverables.
- **Why not**: Contradicts locked MVP definition (personal log wedge + data loop).

### Alternative 3: Aggressive auto-cleaning and interpretation in v1 for “clean” metrics

- **Pros**: Prettier headline numbers; fewer visible gaps for casual users.
- **Cons**: Violates honesty-first and audit/processing separation; erodes trust when users discover hidden repair.
- **Why not**: Rejected in favor of conservative, explicit masks and coverage reporting.

## Consequences

### Positive

- Clear product story and prioritization for roadmap phases (library → processing profiles → mountain metrics engine → community).
- UX and schema can optimize for route memory, crux/rest labeling, and audit transparency.
- Engineering aligns with adversarial validation and deterministic audit completion targets before fancy interpretation.

### Negative

- Some users wanting “Strava-like breadth” may not be the initial target; messaging must be precise.
- Features common in generic trackers may be deferred intentionally.

### Risks

- **Risk**: Pressure to “broaden” scope mid-MVP. **Mitigation**: Tie feature requests back to mountain log and audit contract; record scope changes via new or updated ADRs.
