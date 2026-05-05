---
type: community
cohesion: 0.18
members: 15
---

# Output Schema and Disposition

**Cohesion:** 0.18 - loosely connected
**Members:** 15 nodes

## Members
- [[AnnotationKind Enum (sessionsegmentproposal scope)]] - document - implementation_plan.md
- [[Correction Export]] - document - implementation_plan.md
- [[DropReason Enum (adjacent-exact-duplicate, duplicate_chunk_segment)]] - document - implementation_plan.md
- [[ExcludedReason Enum (12 reasons)]] - document - implementation_plan.md
- [[Kinematic Guard (80 kph per-speed threshold)]] - document - implementation_plan.md
- [[MVP Output Schema (correction.{} shape)]] - document - implementation_plan.md
- [[Partition Invariant (drops ⊕ trusted ⊕ excluded = all)]] - document - implementation_plan.md
- [[canonicalTrustedPoints (kinematic input)]] - document - implementation_plan.md
- [[correction-export.js]] - document - implementation_plan.md
- [[correction.annotations (sessionsegmentproposal scope)]] - document - implementation_plan.md
- [[correction.drops (removed points)]] - document - implementation_plan.md
- [[correction.excludedFromTrust (kept but untrusted)]] - document - implementation_plan.md
- [[correction.rearrangements (mutation log)]] - document - implementation_plan.md
- [[fullOrderedPoints (UI trace)]] - document - implementation_plan.md
- [[resolution-apply.js]] - document - implementation_plan.md

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Output_Schema_and_Disposition
SORT file.name ASC
```

## Connections to other communities
- 5 edges to [[_COMMUNITY_Proposal Types and Phase 1 Gates]]
- 2 edges to [[_COMMUNITY_Pipeline Orchestration and Verification]]
- 1 edge to [[_COMMUNITY_Phase 2 Edge Reconciliation]]
- 1 edge to [[_COMMUNITY_Adjacency Primitives and Deduplication]]

## Top bridge nodes
- [[MVP Output Schema (correction.{} shape)]] - degree 8, connects to 2 communities
- [[resolution-apply.js]] - degree 4, connects to 2 communities
- [[Correction Export]] - degree 6, connects to 1 community
- [[Kinematic Guard (80 kph per-speed threshold)]] - degree 5, connects to 1 community
- [[correction.rearrangements (mutation log)]] - degree 3, connects to 1 community