# ADR-0011: Full DEM substitution only as declared attached channel

**Date**: 2026-04-02  
**Status**: accepted  
**Deciders**: Product / pipeline owners  

*Implementation is deferred; architectural rule is accepted.*

## Context

When recorded elevation is largely missing or invalid, replacing it with DEM-derived values is sometimes necessary — but silent substitution destroys provenance and confuses audit consumers.

## Decision

Using a DEM to **replace** recorded elevation wholesale is valid **only** when:
- The recorded channel is **systematically unusable**, and
- The result is an **explicitly declared attached channel** (product/version/resolution/interpolation/coverage/reason) — **never** a silent in-place replacement of `eleRaw`.

## Alternatives Considered

### Alternative 1: In-pipeline silent DEM fill
- **Pros**: Cleaner user-facing tracks.
- **Cons**: Violates honesty-first / provenance; indistinguishable from recorded data.
- **Why not**: Canonical architecture requires declared channels.

### Alternative 2: Mutate raw GPX on export only
- **Cons**: Same provenance problem if not declared in product metadata.

## Consequences

### Positive
- Clear separation between measured and model-derived altitude.

### Negative
- Products must carry channel metadata; slightly heavier data model.

### Risks
- **Risk**: Vendors skip declaration. **Mitigation**: Validation rules in consumers; this ADR as contract reference.

**Cross-references**: [`../../project/canonical-track-architecture.md`](../../project/canonical-track-architecture.md), [`../../project/product-roadmap.md`](../../project/product-roadmap.md)
