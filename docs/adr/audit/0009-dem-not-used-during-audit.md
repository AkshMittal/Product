# ADR-0009: DEM is not used during audit

**Date**: 2026-04-02  
**Status**: accepted  
**Deciders**: Product / pipeline owners

## Context

Digital elevation models (DEMs) are tempting as a reference for “true” altitude. Audit reproducibility and clean observables argue against pulling external rasters into the baseline audit pass.

## Decision

The elevation audit module performs **no** DEM lookup or DEM-based comparison. Audit operates on the GPX stream and explicit numeric parameters only.

## Alternatives Considered

### Alternative 1: Optional DEM residual in audit behind a flag
- **Pros**: Richer baseline output.
- **Cons**: Output depends on DEM product, version, resolution, interpolation — not reproducible from GPX + declared params alone.
- **Why not**: Breaks self-contained audit contract; belongs post-audit (ADR-0010).

### Alternative 2: DEM only for spike detection in audit
- **Cons**: At spikes, lat/lon/ele share corrupt geometry; DEM residual is not a vertical error measure.

## Consequences

### Positive
- All audit modules remain reproducible from file + parameters.
- Avoids entangling horizontal error, vertical error, and DEM error in a single residual.

### Negative
- Terrain-anchored vertical accuracy is not available in audit JSON.

### Risks
- **Risk**: Users expect “DEM corrected ele” in audit. **Mitigation**: ADR-0010/0011 for declared downstream steps.

**Reasoning summary**
1. External DEM breaks self-contained reproducibility.
2. Position spikes: all axes corrupted together — DEM residual not a clean vertical observable.
3. Clean points: `eleRaw - eleDEM(lat,lon)` mixes horizontal position error and vertical error — audit cannot separate them.

**Cross-references**: [`../../project/canonical-track-architecture.md`](../../project/canonical-track-architecture.md), elevation audit module
