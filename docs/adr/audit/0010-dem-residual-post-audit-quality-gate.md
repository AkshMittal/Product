# ADR-0010: DEM residual analysis as post-audit quality gate

**Date**: 2026-04-02  
**Status**: accepted  
**Deciders**: Product / pipeline owners  

*Implementation is deferred to the quality-gate layer; policy is accepted here.*

## Context

After audit labels position and elevation issues, a **downstream** step may still want terrain-anchored vertical error characterization for the non-spike population, using explicit DEM provenance.

## Decision

Computing `eleRaw - eleDEM(lat, lon)` per point **after audit runs** is a sound **quality-gate** approach for characterizing vertical GPS recording error, subject to:
- Excluding or separately flagging spike points (where lat/lon/ele share a corrupt solution)
- Declaring DEM product, version, and reporting residual **distributions**, not a single silent threshold verdict
- Acknowledging DEM vertical uncertainty (e.g. 10–30 m in steep terrain at 30 m posts)

## Alternatives Considered

### Alternative 1: Run DEM residual inside audit (rejected)
- See ADR-0009.

### Alternative 2: No DEM ever
- **Cons**: Loses a useful research and QC tool when properly scoped.
- **Why not**: Post-audit step preserves separation of concerns.

## Consequences

### Positive
- Audit output remains pure stream; DEM step is explicit and profiled.

### Negative
- Two-stage operation for teams wanting residuals.

### Risks
- **Risk**: Demagogic single-number “GPS error.” **Mitigation**: Require distribution reporting and DEM metadata.

**Cross-references**: [`../../project/canonical-track-architecture.md`](../../project/canonical-track-architecture.md), elevation audit module, [`../../project/objective-participation-and-quality.md`](../../project/objective-participation-and-quality.md)
