# Handoff: correction pipeline & overlap-detection — restored snapshot

**Purpose:** Continue **architecture discussion** and **MVP overlap finalisation** without re-reading long chat threads.

**Audience:** Engineer or model picking up **`implementation_plan.md`** and **`docs/adr/correction/`**.

**Note:** This file was **re-created** after a worktree loss; content matches the **block-finding + `overlapBlockResolution` + multipass** architecture.

---

## Locked architecture (do not regress)

- **`block-proposal`** → **`kind: 'block-finding'`** (maximal **`belowAnchor`** runs + **`internalMonotonicity`**).
- **`overlap-detection`** → **`overlapBlockResolution[]`**, brackets, **`socket-ok`** vs overlap, **`blockReorderPayload`** when applicable; **`overlapVetoedProposalIds`**.
- **`resolution-apply`** → **`block-reorder`** **apply** kind ( **`rearrangements`** ), **not** a **`correction.proposals[]`** row from **`block-proposal`**.
- **Multipass** + **`correction.spineIntervals`** after reversal and after each mutating apply (**ADR-0001**, **`implementation_plan.md`** § Multipass).

---

## ADRs (revised)

- **`0001`** — Multipass, spine, **`overlapBlockResolution`** in loop.
- **`0006`** — **`block-finding`** vs **`block-reorder`**; no **`block-reorder`** in proposals.
- **`0008`** — Chunk = **`block-finding`**; overlap emits resolution payload.

---

## Open spec work (overlap MVP)

See checklist in prior discussions: footprint scope (singleton vs block), structural vs numeric socket, bracket algorithm determinism, **`overlapVetoedProposalIds`** semantics.

---

*End of handoff.*
