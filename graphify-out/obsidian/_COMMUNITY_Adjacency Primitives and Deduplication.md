---
type: community
cohesion: 0.33
members: 7
---

# Adjacency Primitives and Deduplication

**Cohesion:** 0.33 - loosely connected
**Members:** 7 nodes

## Members
- [[Adjacency Consumer Table]] - document - implementation_plan.md
- [[Adjacent Dedupe Equality Table]] - document - implementation_plan.md
- [[Stream-adjacent Adjacency]] - document - implementation_plan.md
- [[Traversal-adjacent Adjacency]] - document - implementation_plan.md
- [[adjacent-exact-drop Proposal Kind]] - document - implementation_plan.md
- [[duplicate-proposal.js]] - document - implementation_plan.md
- [[objective-adjacent-dedupe.js]] - document - implementation_plan.md

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Adjacency_Primitives_and_Deduplication
SORT file.name ASC
```

## Connections to other communities
- 2 edges to [[_COMMUNITY_Proposal Types and Phase 1 Gates]]
- 1 edge to [[_COMMUNITY_Pre-segment Analysis and Spine]]
- 1 edge to [[_COMMUNITY_Output Schema and Disposition]]

## Top bridge nodes
- [[duplicate-proposal.js]] - degree 5, connects to 1 community
- [[objective-adjacent-dedupe.js]] - degree 3, connects to 1 community
- [[adjacent-exact-drop Proposal Kind]] - degree 2, connects to 1 community