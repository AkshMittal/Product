# Graph Report - implementation_plan.md  (2026-05-04)

## Corpus Check
- 1 files · ~12,000 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 71 nodes · 104 edges · 7 communities detected
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 2 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Output Schema and Disposition|Output Schema and Disposition]]
- [[_COMMUNITY_Proposal Types and Phase 1 Gates|Proposal Types and Phase 1 Gates]]
- [[_COMMUNITY_Pre-segment Analysis and Spine|Pre-segment Analysis and Spine]]
- [[_COMMUNITY_Audit Contract and Boundary Classification|Audit Contract and Boundary Classification]]
- [[_COMMUNITY_Adjacency Primitives and Deduplication|Adjacency Primitives and Deduplication]]
- [[_COMMUNITY_Pipeline Orchestration and Verification|Pipeline Orchestration and Verification]]
- [[_COMMUNITY_Phase 2 Edge Reconciliation|Phase 2 Edge Reconciliation]]

## God Nodes (most connected - your core abstractions)
1. `Per-segment Multipass Loop` - 11 edges
2. `Correction Layer Pipeline` - 8 edges
3. `MVP Output Schema (correction.{} shape)` - 8 edges
4. `Pre-segment Phase` - 7 edges
5. `Correction Export` - 6 edges
6. `Spine Envelope (per-segment)` - 6 edges
7. `deterministic-export-fix.js` - 6 edges
8. `insert Proposal Kind (unified)` - 6 edges
9. `Correction-idle Predicate (per-segment)` - 5 edges
10. `duplicate-proposal.js` - 5 edges

## Surprising Connections (you probably didn't know these)
- `block-proposal.js` --shares_data_with--> `Spine Envelope (per-segment)`  [INFERRED]
  implementation_plan.md → implementation_plan.md  _Bridges community 2 → community 1_
- `correctionRunner Orchestration` --implements--> `Correction Layer Pipeline`  [EXTRACTED]
  implementation_plan.md → implementation_plan.md  _Bridges community 5 → community 3_
- `Correction Layer Pipeline` --conceptually_related_to--> `Pre-segment Phase`  [EXTRACTED]
  implementation_plan.md → implementation_plan.md  _Bridges community 5 → community 2_
- `Correction Layer Pipeline` --conceptually_related_to--> `Phase 2 — Edge Reconciliation`  [EXTRACTED]
  implementation_plan.md → implementation_plan.md  _Bridges community 5 → community 6_
- `Correction Layer Pipeline` --conceptually_related_to--> `Correction Export`  [EXTRACTED]
  implementation_plan.md → implementation_plan.md  _Bridges community 5 → community 0_

## Hyperedges (group relationships)
- **Three-phase Correction Pipeline** — impl_phase1, impl_phase2, impl_phase3 [EXTRACTED 1.00]
- **Correction Output Schema (drops + excluded + trusted)** — impl_drops, impl_excluded_from_trust, impl_canonical_trusted_points [EXTRACTED 1.00]
- **Three Proposal Kinds (block-finding, insert, adjacent-exact-drop)** — impl_block_finding_proposal, impl_insert_proposal, impl_adjacent_exact_drop_proposal [EXTRACTED 1.00]

## Communities

### Community 0 - "Output Schema and Disposition"
Cohesion: 0.18
Nodes (15): AnnotationKind Enum (session/segment/proposal scope), correction.annotations[] (session/segment/proposal scope), canonicalTrustedPoints (kinematic input), Correction Export, correction-export.js, DropReason Enum (adjacent-exact-duplicate, duplicate_chunk_segment), correction.drops[] (removed points), correction.excludedFromTrust[] (kept but untrusted) (+7 more)

### Community 1 - "Proposal Types and Phase 1 Gates"
Cohesion: 0.19
Nodes (14): Bilateral Disturbance Zones (coupling), Block (contiguous belowAnchor run), block-finding Proposal Kind, block-proposal.js, Bracket / Socket, coupling-detection.js, Cross-proposal Footprint Mapping (overlap), insert Proposal Kind (unified) (+6 more)

### Community 2 - "Pre-segment Analysis and Spine"
Cohesion: 0.21
Nodes (13): Correction-idle Predicate (per-segment), Global Full-array Reversal Hypothesis, participation-check.js, Participation Modes (geometry-only/timestamp-sparse/full/fully-reversed), Per-segment minTimestampPairCoverageRatio, Per-segment Reversal (isFullyReversed), audit.temporal.perSegment[] (belowAnchor, belowPrevValid…), Pre-segment Phase (+5 more)

### Community 3 - "Audit Contract and Boundary Classification"
Cohesion: 0.22
Nodes (9): Audit Layer Contract (what correction reads), chunk_ordering Boundary Classification, correctionRunner Orchestration, deterministic-export-fix.js, duplicate_chunk Boundary Classification, audit.ingestion.segmentBoundaries[] (raw, unclassified), segment_boundary_gap Boundary Classification, audit.ingestion.segmentSummaries[] (+1 more)

### Community 4 - "Adjacency Primitives and Deduplication"
Cohesion: 0.33
Nodes (7): Adjacency Consumer Table, adjacent-exact-drop Proposal Kind, duplicate-proposal.js, Adjacent Dedupe Equality Table, objective-adjacent-dedupe.js, Stream-adjacent Adjacency, Traversal-adjacent Adjacency

### Community 5 - "Pipeline Orchestration and Verification"
Cohesion: 0.29
Nodes (7): Correction Layer Pipeline, Open Items / Explicit Deferrals, Phase 1 — Per-segment Terminal Solve, Phase 3 — Residual Diagnostic Sweep, residual-diagnostic-sweep.js (Phase 3), Verification Plan (adversarial fixtures), workingOrderedPoints (mutable traversal)

### Community 6 - "Phase 2 Edge Reconciliation"
Cohesion: 0.4
Nodes (6): Edge Proposal, edge-reconciliation.js (Phase 2), Phase 2 — Edge Reconciliation, Phase 2 Boundary Stability Decision Table, Scope Gate (envelope-bounded proposals), stagedEdgeProposals (Phase 1 → Phase 2 handoff)

## Knowledge Gaps
- **20 isolated node(s):** `Singleton (isolated backtrack)`, `Bracket / Socket`, `Multipass Cap (multipassMaxIterations=500)`, `fullOrderedPoints (UI trace)`, `correction-export.js` (+15 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Correction Layer Pipeline` connect `Pipeline Orchestration and Verification` to `Output Schema and Disposition`, `Pre-segment Analysis and Spine`, `Audit Contract and Boundary Classification`, `Phase 2 Edge Reconciliation`?**
  _High betweenness centrality (0.303) - this node is a cross-community bridge._
- **Why does `Pre-segment Phase` connect `Pre-segment Analysis and Spine` to `Audit Contract and Boundary Classification`, `Adjacency Primitives and Deduplication`, `Pipeline Orchestration and Verification`?**
  _High betweenness centrality (0.300) - this node is a cross-community bridge._
- **Why does `Per-segment Multipass Loop` connect `Proposal Types and Phase 1 Gates` to `Output Schema and Disposition`, `Pre-segment Analysis and Spine`, `Adjacency Primitives and Deduplication`, `Pipeline Orchestration and Verification`, `Phase 2 Edge Reconciliation`?**
  _High betweenness centrality (0.284) - this node is a cross-community bridge._
- **What connects `Singleton (isolated backtrack)`, `Bracket / Socket`, `Multipass Cap (multipassMaxIterations=500)` to the rest of the system?**
  _20 weakly-connected nodes found - possible documentation gaps or missing edges._