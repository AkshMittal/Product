---
type: community
cohesion: 0.19
members: 14
---

# Proposal Types and Phase 1 Gates

**Cohesion:** 0.19 - loosely connected
**Members:** 14 nodes

## Members
- [[Bilateral Disturbance Zones (coupling)]] - document - implementation_plan.md
- [[Block (contiguous belowAnchor run)]] - document - implementation_plan.md
- [[Bracket  Socket]] - document - implementation_plan.md
- [[Cross-proposal Footprint Mapping (overlap)]] - document - implementation_plan.md
- [[Multipass Cap (multipassMaxIterations=500)]] - document - implementation_plan.md
- [[Per-segment Multipass Loop]] - document - implementation_plan.md
- [[Singleton (isolated backtrack)]] - document - implementation_plan.md
- [[Verification Pass (rebuild without apply)]] - document - implementation_plan.md
- [[block-finding Proposal Kind]] - document - implementation_plan.md
- [[block-proposal.js]] - document - implementation_plan.md
- [[coupling-detection.js]] - document - implementation_plan.md
- [[insert Proposal Kind (unified)]] - document - implementation_plan.md
- [[overlap-detection.js]] - document - implementation_plan.md
- [[singleton-proposal.js]] - document - implementation_plan.md

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Proposal_Types_and_Phase_1_Gates
SORT file.name ASC
```

## Connections to other communities
- 5 edges to [[_COMMUNITY_Output Schema and Disposition]]
- 4 edges to [[_COMMUNITY_Pre-segment Analysis and Spine]]
- 2 edges to [[_COMMUNITY_Adjacency Primitives and Deduplication]]
- 1 edge to [[_COMMUNITY_Pipeline Orchestration and Verification]]
- 1 edge to [[_COMMUNITY_Phase 2 Edge Reconciliation]]

## Top bridge nodes
- [[Per-segment Multipass Loop]] - degree 11, connects to 5 communities
- [[insert Proposal Kind (unified)]] - degree 6, connects to 2 communities
- [[block-finding Proposal Kind]] - degree 5, connects to 1 community
- [[block-proposal.js]] - degree 4, connects to 1 community
- [[singleton-proposal.js]] - degree 4, connects to 1 community