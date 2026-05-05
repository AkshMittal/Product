---
type: community
cohesion: 0.22
members: 9
---

# Audit Contract and Boundary Classification

**Cohesion:** 0.22 - loosely connected
**Members:** 9 nodes

## Members
- [[Audit Layer Contract (what correction reads)]] - document - implementation_plan.md
- [[audit.ingestion.segmentBoundaries (raw, unclassified)]] - document - implementation_plan.md
- [[audit.ingestion.segmentSummaries]] - document - implementation_plan.md
- [[chunk_ordering Boundary Classification]] - document - implementation_plan.md
- [[correctionRunner Orchestration]] - document - implementation_plan.md
- [[deterministic-export-fix.js]] - document - implementation_plan.md
- [[duplicate_chunk Boundary Classification]] - document - implementation_plan.md
- [[segment_boundary_gap Boundary Classification]] - document - implementation_plan.md
- [[timestamp_discontinuity Boundary Classification]] - document - implementation_plan.md

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Audit_Contract_and_Boundary_Classification
SORT file.name ASC
```

## Connections to other communities
- 3 edges to [[_COMMUNITY_Pre-segment Analysis and Spine]]
- 1 edge to [[_COMMUNITY_Pipeline Orchestration and Verification]]

## Top bridge nodes
- [[deterministic-export-fix.js]] - degree 6, connects to 1 community
- [[Audit Layer Contract (what correction reads)]] - degree 5, connects to 1 community
- [[correctionRunner Orchestration]] - degree 2, connects to 1 community