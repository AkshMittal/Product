# ADR-0001: Canonical track as single source of truth for the product surface

**Date**: 2026-04-02
**Status**: accepted
**Deciders**: Product / engineering (documented in `docs/project/canonical-track-architecture.md`, `docs/project/product-roadmap.md`)

## Context

Mountain GPX analytics need users to trust what they see. Mainstream tools often blur raw recordings with repairs and implicit smoothing. This product commits to honesty-first computation: no silent repair presented as raw truth. The UI still needs one coherent representation for maps, anchoring, and metrics at a time—without pretending that representation is the same as the original GPX stream.

Forces at play: immutability and exportability of raw audit output; need for interactive consistency (one path for hit-testing and distance); elevation is often missing or noisy and must not silently stand in for recorded values; metrics must be comparable and auditable across processing profiles.

## Decision

We use a layered model: **raw observations (immutable)** → **canonical geometry (explicit, versioned, reversible processed output)** → **attached elevation channels** → **metric families that declare dependencies** (geometry profile, elevation channel, timestamp rules, masks, coverage). The product surface operates on a chosen canonical track representation with declared provenance, while raw observations and raw audit remain the immutable reference.

## Alternatives Considered

### Alternative 1: Treat raw GPX points as the only track for all UI and metrics

- **Pros**: Maximum literal fidelity to the upload; no “processed” path to explain.
- **Cons**: Cannot support explicit geometry processing, resampling, or consistent map/metric alignment when the product intentionally improves horizontal path estimates; elevation one-to-one mapping breaks once geometry changes.
- **Why not**: Conflicts with the need for a single consistent coordinate stream for UI interaction while still preserving raw truth separately.

### Alternative 2: Implicit unified track (merge corrections into one stream without versioning)

- **Pros**: Simpler mental model for casual users; less UI surface for provenance.
- **Cons**: Silent overwrite of raw semantics; impossible to audit what was computed on; breaks honesty-first and export contracts.
- **Why not**: Violates non-negotiable principles in the product roadmap.

### Alternative 3: Multiple parallel “truths” in the UI without a declared canonical choice

- **Pros**: Flexibility to compare streams side-by-side.
- **Cons**: Ambiguous anchoring for notes/photos/metrics; inconsistent distance and map behavior unless a chosen profile is explicit.
- **Why not**: “Single source of truth” is defined as one **chosen** canonical representation per view/metric set, with explicit profile metadata—not ambiguity.

## Consequences

### Positive

- Map rendering, anchoring, and geometry-conditioned metrics share one explicit coordinate basis per profile.
- Raw data and audit stay immutable and reversible; downstream work references indices and declared profiles.
- Elevation can be modeled honestly as resampled or DEM-sourced channels with declared source type and quality.
- Metrics can report coverage, exclusions, and parameters because dependencies are explicit.

### Negative

- Product and engineering must implement and surface profile identifiers, algorithm/version metadata, and channel declarations—more schema and UI surfacing than a naive tracker.
- Users must understand (at appropriate depth) that “canonical geometry” is processed output, not raw GPX.

### Risks

- **Risk**: Teams shortcut metadata and collapse layers, reintroducing silent correction. **Mitigation**: Treat canonical-track doc and glossary as contract; enforce metric dependency declarations in implementation and exports.
