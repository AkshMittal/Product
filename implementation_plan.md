# Correction Layer — MVP Implementation Plan

The correction layer is the first post-audit processing stage. It consumes the immutable audit output, applies a versioned decision tree to determine canonical traversal order and timestamp eligibility, and produces a **correction metadata profile** plus a **pre-split handoff** to later layers (see **§ Handoff: pre-split lists**). **Kinematic correction, smoothing, and metrics** consume **`canonicalTrustedPoints`** by default — **not** the raw `points` array and **not** a single list that requires every consumer to re-derive “who is trustworthy” from masks.

**Raw observations remain immutable.** **`workingOrderedPoints`** mutates only during **early** stages (**dedupe**, **reversal**) and **`resolution-apply`**. **Proposal modules** (**`block-proposal`**, **`singleton-proposal`**, **`duplicate-proposal`**) **only emit** candidate corrections (and optional **local** flags from their own rules); they **do not** implement **overlap** or **coupling** logic. **`overlap-detection`** and **`coupling-detection`** are **read-only** on order: both **consume the same** **`correction.proposals[]`** (plus **`workingOrderedPoints`**, **`auditResult`**, **`correction.spineIntervals`**, and any shared context you version). **`resolution-apply`** applies corrections that pass **both** gates (**§ MVP architecture**). **Correction uses a multipass loop** (**§ Multipass correction and spine**): after each **`resolution-apply`** that mutates order, **recompute** **`overlap-detection`** and **`coupling-detection`** on the **new** snapshot; **rebuild** **`correction.proposals[]`** from the three proposal modules and **recompute** **`spineIntervals`** so brackets and overlap stories stay honest. **New** `correction.proposals[]` entries on a **later** pass are **normal** when an apply **unlocks** geometry (e.g. **seam duplicate-time** after **`block-reorder`** with **closed** bracket socket — **§ Block overlap**, **§ Monotonic capability**). No silent repair. All decisions are logged.

**Traversal neighbours:** After **reversal**, **adjacent dedupe**, or **`resolution-apply`**, **immediate neighbours in `workingOrderedPoints` order** change even though **`gpxIndex`** on surviving points is unchanged. Any stage that uses **neighbours or brackets** reads them from the **current** snapshot appropriate to that phase (proposal phase uses the post–early-mutation snapshot).

**Sampling baseline (non-block backtrack):** Empirical **time-delta / sampling-density** checks (e.g. “is this candidate’s implied local behaviour consistent with neighbours?”) must use **original file order by `gpxIndex`**, over a **±`localWindowSize`** window (default **5**, versioned in profile). **Do not** derive that baseline from **consecutive pairs in `workingOrderedPoints` order** — after reorder or drop, traversal adjacency can join **non-consecutive `gpxIndex`** values and **distort** apparent Δt vs true recording density.

**Unfixed / rejected / non-winner rows:** The layer **applies fixes within scope**; it **does not erase** observations from **provenance** merely because they were **not** fixed, **failed** a guard, or **lost** a same-time competition. They are **flagged**, **listed in `correction.excludedFromTrust`**, and **omitted from `canonicalTrustedPoints`**. They **remain** in **`correction.fullOrderedPoints`** for **honesty / UX** (one ordered trace, grey-out, tooltips) without forcing dumb layers to filter. **Drops** only where policy **removes** a row from **all** ordered traces (e.g. **100% adjacent exact duplicate**). Same-time **non-winners** (when a winner is chosen): **flag** + **excludedFromTrust** + **fullOrderedPoints**; **log**; **no** silent erase from metadata.

---

## Terminology: **block** vs **non-block** (“singleton”)

| Term | Meaning in this plan |
|------|----------------------|
| **Block** (detection) | A **maximal contiguous** run of `belowAnchor` points in **`workingOrderedPoints`** order. **`block-proposal`** emits **`block-finding`** per run with **§ Internal monotonicity** classification — **not** socket / overlap verdicts (those belong to **`overlap-detection`**). |
| **Non-block** / **singleton** (product sense) | **Not** such a chunk: **isolated** backtrack points **and** same-`timeMs` rows handled under **`duplicate-proposal`**. When the enclosing **`belowAnchor`** context is **monotonically capable**, **do not** treat **all** rows sharing a `timeMs` as one competition pool — **partition** by **competition segment** (**§ Monotonic capability and duplicate competition scoping**). |

Do **not** read “singleton” as only **block size 1** unless explicitly stated.

---

## Terminology: **bracket** vs **socket**

| Term | Meaning |
|------|---------|
| **Bracket** | The **anchor points** (and their usable times **`t_prev`**, **`t_next`**) that **frame** a contiguous **`belowAnchor`** run in the **intended** forward time story. **Not** defined as "whatever immediate `workingOrderedPoints` neighbours the slab has" if those neighbours may still be **inside** the same fault. **Brackets** are chosen by **`overlap-detection`** per **versioned** rules (first point **before** / after the **maximal** run that lies **outside** it, informed by **`correction.spineIntervals`** and participation policy). |
| **Socket** | After **`B_min`** / **`B_max`** (min / max usable `timeMs` over the block) are known: the **predicate** that the block's time envelope **fits** between bracket times — MVP **closed socket:** **`B_min ≥ t_prev`** and **`B_max ≤ t_next`** (equality allowed; seam duplicate-time deferred to **`duplicate-proposal`** — **§ Monotonic capability**). Socket is computed in **`overlap-detection`**, **not** **`block-proposal`**. |

**Example (times only):** Traversal `... A [ B C D ] E ...` — **`A`** and **`E`** are **outside** the `belowAnchor` run `{B,C,D}`. **`t_prev(A) = 10`**, **`t_next(E) = 30`**, **`B_min = 12`**, **`B_max = 25`**: socket holds (**12 ≥ 10**, **25 ≤ 30**). If **`B_min = 8`**: socket fails (**8 < 10**) → **`overlap.block`**. If neither **`A`** nor **`E`** can be found outside the run: **`no-bracket`**, no reorder.

---

## MVP: what we **resolve** vs **flag only**

| Situation | MVP action |
|-----------|------------|
| **Overlapping or partially overlapping blocks** (two+ time stories: socket / interval / equality / duplicate-time, **mixed** allowed) | **`overlap.block`** + **`overlapDiagnostics`**; **flag + mask** — **no** reorder, **no** partial block fix. **Partial** overlap = **same** treatment as **full** overlap. |
| **Chunk reorder (perfect-fit)** | **`block-proposal`** emits **`kind: 'block-finding'`** (span + **§ Internal monotonicity**). **`overlap-detection`** computes brackets, **`B_min`/`B_max`**, closed socket, overlap vs **`socket-ok`**; emits **`correction.overlapBlockResolution[]`**. **`resolution-apply`** performs **`block-reorder`** only for **`socket-ok`** findings that are **also** coupling-safe — **no** kinematic on chunk (MVP) |
| **Same `timeMs`, different coords** (after adjacent dedupe) | **`duplicate-reorder`** in **`duplicate-proposal`** with **segment-scoped** competition groups (**§ Monotonic capability and duplicate competition scoping**); **kinematic** within each group; **apply** only if **overlap-safe** **and** **coupling-independent** |
| **Backtrack non-block** | **`singleton-insert`** **proposal** + sampling + **kinematic** in **`singleton-proposal`**; **apply** only if **overlap-safe** **and** **coupling-independent** |
| **Non-adjacent 100% exact duplicates** | **`duplicate-proposal`**: **`duplicate.exact_group_unresolved`**, **flag + mask** — **not** **`singleton-proposal`** |

### Proposal discipline (MVP)

**Proposal modules** answer only: “**what correction do I believe this anomaly class needs?**” (or emit **local** flags such as sampling/kinematic failures **within** that module’s scope). They **must not** compute **referential coupling** or **temporal-overlap vetoes** — that belongs in **`coupling-detection`** and **`overlap-detection`**, which both read **`correction.proposals[]`**.

**Apply rule:** A proposal is **executed** in **`resolution-apply`** only if it is **allowed** by **overlap-detection** **and** **allowed** by **coupling-detection** (**AND**). Exact fields (`vetoedProposalIds`, `independentProposalIds`, masks, etc.) are **versioned** in the **`correction`** profile.

**Pipeline order** for **building** proposals within **one pass** is fixed for determinism (e.g. **block → singleton → duplicate**); **overlap** and **coupling** run **after** that pass’s **`proposals`** and **before** **`resolution-apply`**. See **§ Multipass correction and spine** for how passes repeat.

**Who owns duplicate “competition” clustering:** **`duplicate-proposal`** (including **§ Monotonic capability** segment / tether rules). **`overlap-detection`** answers **temporal narrative** permission (**veto / mask**); it **does not** replace **`duplicate-proposal`** when deciding **which indices share a kinematic competition pool**.

**Who owns chunk bracket / socket:** **`overlap-detection`** only. **`block-proposal`** emits **`block-finding`**; it **does not** decide **`t_prev`/`t_next`**, **socket fit**, or **`block-reorder`** payload. **`coupling-detection`** interprets **referential** dependence between **independent** proposals (**`block-finding`**, **`singleton-insert`**, **`duplicate-proposal`** outputs, etc.).

---

## Overlap vs coupling (plain language)

- **Overlap (correction sense):** **Time overlap** that implies **two or more incompatible stories** about the same stretch of the recording — e.g. block **vs** bracket gap (strict socket), **equality / spine** conflict, **duplicate `timeMs`** inside or at the edge of a block, **partial** fit, or **any mixture** of these. That **can** be **cross-anomaly** in the data (block-shaped regions **vs** non-block placement, duplicate-time knots **vs** chunk narrative, etc.); the **MVP implementation** is **block-anchored** in **§ Block overlap** plus flags such as **`overlap.singleton_block_conflict`**. It is **not** “GPS noise”; it is **conflicting temporal narratives**. MVP: **detect overlap** → **flag + mask**, **no** chunk reorder for **overlap-flagged** blocks — **do not** force a single exclusive cause when reality is **mixed** (see **§ Block overlap: detection and diagnostics**).

- **Coupling / reference instability:** Fix **A** needs neighbour/bracket **B**, but **B** is **also** being corrected or **flagged** — **no** safe order. **`coupling-detection`** marks **referential** **coupled** blobs from **`proposals`**. MVP: **flag**; **no** partial-apply where policy forbids. **“Secondary overlap”** in discussion = **this dependency mess**, **not** new interval events on rescan.

---

## Block overlap: detection and diagnostics (MVP)

**Goal:** For each **`block-finding`** from **`block-proposal`**, decide **`socket-ok`** vs **`overlap`** (two+ time stories), populate **`correction.overlapBlockResolution[]`**, and drive **`resolution-apply`** **`block-reorder`**. **Do not** force one mutually exclusive label; **mixed** diagnostics are **expected**.

**Why brackets are not "array neighbours of the slab" only:** A misplaced slab's **immediate** **`workingOrderedPoints`** neighbours may still be **`belowAnchor`** or part of the **same** fault. Bracket rows must be chosen so **`t_prev`/`t_next`** reflect **where the chunk belongs** in the **forward** story — **`correction.spineIntervals`** + **outside-the-run** rules (**versioned** ADR). Failure to obtain valid brackets or socket fit contributes to **`overlap`** / **`no-bracket`**.

**Per-`block-finding` algorithm (conceptual — exact rules versioned in `overlap-detection` ADR):**

1. Read **`gpxIndexes`** (or span) from **`block-finding`**. Compute **`B_min`**, **`B_max`** over the run (usable `timeMs`).
2. **Internal monotonicity:** If **`block-finding.internalMonotonicity === false`** → set resolution **`status: 'skipped-non-monotonic'`** (no **`block-reorder`**; emit **`block.internal_monotonicity_fail`** or rely on **`block-finding`** only — versioned).
3. **Brackets:** Select **`prev`** / **`next`** anchor (and **`t_prev`**, **`t_next`**) per **versioned** policy — **must not** default to misleading in-run neighbours; **may** use first point **before** / after the **maximal** `belowAnchor` run that lies **outside** the run, **`spineIntervals`**, file ends, etc.
4. **Closed socket:** If **`t_prev`**, **`t_next`** usable → **`socket-ok`** iff **`B_min ≥ t_prev`** and **`B_max ≤ t_next`**. Equality at bracket may yield **seam** duplicate-time → **`duplicate-proposal`** on next pass (**§ Monotonic capability**).
5. **Overlap components** (observation-only — do not force one cause): bracket / envelope violation, interval violation, equality / spine conflict, duplicate-time signal, bracket missing. Any conflicting narrative → **`status: 'overlap'`**, **`overlap.block`** + **`overlapDiagnostics`**, no **`blockReorderPayload`**.
6. **`socket-ok`** and not conflicting → **`status: 'socket-ok'`**, emit **`blockReorderPayload`** (permutation / target order — versioned) for **`resolution-apply`**.

**Output:**

- **`correction.overlapBlockResolution[]`**: `{ findingId, status, tPrev?, tNext?, bMin?, bMax?, prevGpxIndex?, nextGpxIndex?, blockReorderPayload?, … }` (versioned).
- **`overlapVetoedProposalIds`** (or equivalent): `block-finding` ids that are `overlap` / `no-bracket` / `skipped-non-monotonic` where policy forbids apply.
- **`correction.overlapDiagnostics[]`**: per-region booleans / metrics, **not** a forced single cause.

**MVP outcome for overlap regions:** flag + mask; `block-reorder` **not** applied for those `findingId`s. **`resolution-apply`** applies `block-reorder` **only** from **`socket-ok`** rows that are **also** coupling-safe. Bracket/socket algorithms — **versioned** in `overlap-detection` ADR.

---

## MVP flag taxonomy (`correction.flags[]`)

Stable **`type`** strings (extend in ADR). Include **`stage`**, **`reason`**, **`gpxIndexes[]`**, optional **`relatedTimeMs`**. **Overlap block:** prefer **`overlap.block`** + **`overlapDiagnostics`** (see above) instead of separate **`overlap.block_socket_miss`** / **`overlap.block_interval_conflict`** rows — those distinctions live in **diagnostics**, not as mutually exclusive top-level types.

| `type` (suggested) | When |
|--------------------|------|
| `overlap.block` | Contiguous `belowAnchor` block: **time overlap** (two+ stories) — **always** pair with **`overlapDiagnostics`** entry for that region (interval / equality / duplicate-time / bracket / partial, etc.) |
| `overlap.singleton_block_conflict` | Block vs non-block incompatible placement |
| `overlap.bracket_missing` | No valid `prev` / `next` bracket (may **also** appear only inside **`overlapDiagnostics.bracketMissing`** if you collapse to **`overlap.block` only** — document in ADR) |
| `block.internal_monotonicity_fail` | Intra-block time retreat (pred in block) |
| `coupled.same_time_deferred` | Same-time group touches overlap / unstable ref — skip competition |
| `coupled.reference_unstable` | Bracket or neighbour inside flagged knot |
| `coupled.block_singleton_order` | **Referential** block vs non-block order ambiguity in **`coupling-detection`** (distinct proposals cannot both apply safely); **time** tension may instead surface via **`overlap.*`** |
| `kinematic.no_safe_move` | Comparative tie or all candidates exceed lenient backstop (**singleton** / **duplicate** paths only — **not** block reorder) |
| `sampling.below_neighbour_baseline` | Candidate’s sampling / Δt story weaker than **gpxIndex**-window neighbour baseline (see **Sampling baseline**) |
| `duplicate.exact_group_unresolved` | Same **`timeMs`** + lat/lon/ele **100% exact** on **≥2** points that are **not** stream-adjacent pairs on **this** snapshot — **flag + mask**, **no** kinematic competition (MVP); clears when **`adjacent-exact-drop`** applies after reorder; **not** **`singleton-proposal`** |
| `adjacent-duplicate-ele-mismatch` | Same time+coords; **both** points have **usable** **ele** but **unequal** (MVP: **flag both**, no drop) |
| `reversal-unconfirmed` | **Full reversal** hypothesis tried (**no** positive Δt on ingest audit **or** **endpoint envelope**); reversed snapshot **fails** **`noCorrectionTemporalAnomalies`** — order **reverted** |

---

## Correction **kinds** (for export / taxonomy)

**Early mutations** (dedupe, reversal) are **not** proposals. After **spine** is first built (**§ Multipass correction and spine**), each **pass** runs: **proposals → overlap-detection → coupling-detection → resolution-apply**.

---

## Multipass correction and spine

**Why multipass:** **`resolution-apply`** changes **`workingOrderedPoints`**, so **brackets**, **neighbours**, and **time envelopes** change. A **singleton** can look like **overlap** with a **misplaced block** until **`block-reorder`** runs; after the chunk moves, the same point may be a **simple** insert. **Single-pass** apply cannot see that **future** geometry. Each iteration **rebuilds** **`correction.proposals[]`** so payloads match **current** geometry; **new** proposal rows on a later pass are **expected** when an apply **unlocks** eligibility (e.g. **`duplicate-reorder`** at a **block–spine seam** after **`block-reorder`**). **Proposal kinds** (`block-finding`, `singleton-insert`, `adjacent-exact-drop`, `duplicate-reorder`, `exact-group-flag-only`, …) are **fixed** by the pipeline design — multipass does **not** invent new **kinds**, only new **instances** when the snapshot warrants them. **`block-reorder`** is an **apply** / **`rearrangements`** **kind** produced when **`resolution-apply`** executes a **`socket-ok`** **`block-finding`** using **`overlapBlockResolution`**, **not** a row emitted by **`block-proposal`**.

**Spine intervals (`correction.spineIntervals`):**

- **First build:** **only after** **`reversal-check`** completes (whether reversal **accepted** or **no-op**). **Not** before — global reversal rewrites traversal and would invalidate an earlier spine.
- **Subsequent builds:** **after each** **`resolution-apply`** that **mutates** `workingOrderedPoints` (end of a multipass **iteration**), **recompute** spine on the **current** snapshot so **overlap**, **coupling**, and **proposal** modules share one **versioned** partition of “forward runs” / gaps on **`gpxIndex`** (exact definition **versioned** — e.g. maximal runs where stream-adjacent time agrees with spine policy).
- **Consumers:** **`block-proposal`**, **`singleton-proposal`**, **`duplicate-proposal`**, **`overlap-detection`**, **`coupling-detection`** may all **read** **`spineIntervals`** + **`workingOrderedPoints`** + **`auditResult`**.

**Multipass loop (each iteration):**

1. **Clear** prior iteration’s **`correction.proposals[]`** (or replace wholesale) and rebuild from **`block-proposal` → `singleton-proposal` → `duplicate-proposal`** on **current** `workingOrderedPoints`.
2. **`overlap-detection`** — **recompute** vetoes / diagnostics / masks from **current** **`proposals`** + context.
3. **`coupling-detection`** — **recompute** **`coupling`** from **current** **`proposals`** + context.
4. **`resolution-apply`** — **`applyable`** = **overlap-safe ∩ coupling-safe**; if **`applyable`** is **non-empty**, apply in deterministic order (**`block-reorder`** from overlap + **`block-finding`**, then **`singleton-insert`** → **`adjacent-exact-drop`** → **`duplicate-reorder`** among other **applyable** kinds), append **`rearrangements`** (tag with **`passIndex`** if useful), **recompute** **`spineIntervals`** and **`noCorrectionTemporalAnomalies`**.
5. **Exit** if any exit condition below holds; else **next iteration**.

**Exit conditions (versioned):**

- **Success / idle:** **`noCorrectionTemporalAnomalies`** is **true** after an apply → **exit** loop with **`multipass.exitReason = 'idle'`** → **`correction-export`** when the runner finishes.
- **Fixed point (stalemate):** **`applyable`** is **empty** while **`proposals`** is **non-empty** (every current proposal is **overlap-vetoed** and/or **coupling-blocked**) → **no** mutation → **spine** unchanged → **next** iteration would repeat the same state → **exit** loop (log **`multipass.exitReason = 'stalemate'`** or equivalent).
- **No proposals:** **`proposals`** empty → **exit** loop (nothing to evaluate).
- **Cap:** **`multipassMaxIterations`** (default e.g. **5**, profile parameter) → **exit** with **`multipass.exitReason = 'max-iterations'`** if still not idle — **honest** export; do **not** infinite-loop.

**Design intent:** The **cardinality** of **applyable** / unresolved work **tends to decrease** each iteration when applies succeed; **stalemate** is an explicit **honest** outcome.

### Multipass diagnostics (recommended)

For **debugging**, **regression**, and **non-determinism** hunts, log per iteration (versioned export or internal-only):

- **`passIndex`**, **`proposalIds`** (or **canonical keys**: `kind` + stable footprint hash), **`applyable` ids**, **`appliedProposalIds`**, counts **overlap-vetoed** / **coupling-blocked**.
- Optional **diff** pass *k* → *k+1*: e.g. **zombie** risk if an **`applied`** id **reappears** unchanged without justification; **proposal count** explosion.

This is **not** an invariant that **`proposals`** cardinality must shrink monotonically — only a **safety net**.

---

## MVP architecture: proposals, overlap-detection, coupling-detection, resolution-apply

**Proposals are dumb emitters:** Each proposal module reports **its** findings / intended corrections (e.g. **`block-finding`**, **`singleton-insert`**, **`duplicate-reorder`**, **`adjacent-exact-drop`**, flag-only rows). They **do not** decide **referential coupling** or **temporal-overlap** vetoes. **Three** proposal modules are **independent** of each other; **dependence** is interpreted only by **`overlap-detection`** and **`coupling-detection`**.

**Two analyses, same input:** **`overlap-detection`** and **`coupling-detection`** both take **`correction.proposals[]`** (and **`workingOrderedPoints`**, **`auditResult`**, **`spineIntervals`**, etc.). **Overlap** answers whether **time stories** forbid applying (including **`block-finding`** → **`overlapBlockResolution`** + **vetoes**) and **constructs** **bracket/socket** / **`blockReorderPayload`** for chunk work. **Coupling** answers whether **referential** dependencies forbid applying **some pair or blob** of proposals together. These are **orthogonal** dimensions (**§ Overlap vs coupling**). **`overlap-detection`** does **not** construct **duplicate** kinematic competition groups (**§ Proposal discipline**).

**Apply gate (AND):** **`resolution-apply`** executes work **only** if **not** blocked by **overlap** (including **`block-finding`** without **`socket-ok`**) **and** **not** blocked by **coupling-detection**. **`block-reorder`** uses **`overlapBlockResolution`** + **`coupling`** + **`overlapVetoedProposalIds`**. **Implementation details** are **versioned** separately.

**MVP pattern (`correctionRunner`):**

1. **participation-check** — may **return** early (skip path).

2. **Early mutations:** **objective-adjacent-dedupe**, **reversal-check** — **mutate** `workingOrderedPoints`.

3. **Build spine (first time):** **`spine-intervals`** (or equivalent module) — **read-only**; set **`correction.spineIntervals`** from **current** snapshot + **`auditResult`** (**§ Multipass correction and spine**).

4. **Multipass loop** (**§ Multipass correction and spine**): repeat until exit:
   - **Proposals:** **`block-proposal` → `singleton-proposal` → `duplicate-proposal`** (replace **`correction.proposals[]`** each pass).
   - **`overlap-detection`** → **`coupling-detection`** → **`resolution-apply`** (**AND** gate).
   - After **apply** that **mutates** order: **recompute** **`spineIntervals`**, **`noCorrectionTemporalAnomalies`** (product short-circuit may **break** loop → export).

5. **`correction-export`**.

**Non-adjacent 100% exact duplicates** (same `timeMs` + lat/lon/ele): **`duplicate-proposal`** — **`exact-group-flag-only`** / **`duplicate.exact_group_unresolved`** until **stream-adjacent**; then **`adjacent-exact-drop`** each pass. **No** singleton path, **no** kinematic competition for exact groups in MVP.

### Design rationale

- **Separation of concerns:** Proposal = **finding**; overlap = **temporal** permission; coupling = **referential** permission; apply respects **both** each pass.

- **Multipass:** **Overlap** and **coupling** are **recomputed** on the **current** array; **`correction.proposals[]`** is **rebuilt** each pass so payloads stay consistent with **post-apply** geometry and **new** instances can appear when eligibility unlocks (optimization: incremental refresh **later** if profiling demands).

- **Spine:** Shared **first-class** structure **after reversal** and **after each mutating apply** reduces ad hoc “implicit spine” in each module.

- **Chunk (perfect-fit):** **`block-proposal`** emits **`block-finding`**; **`overlap-detection`** emits **`overlapBlockResolution`**; **`resolution-apply`** performs **`block-reorder`** when **`socket-ok`**; **no** lenient kinematic on chunk (MVP, **§ ADR-0006**).

---

## MVP product decisions (review after MVP)

| Topic | MVP choice |
|--------|------------|
| Pipeline order | participation → dedupe → reversal → **spine (first)** → **multipass loop:** (proposals → overlap → coupling → apply → **spine** if mutated) → **correction-export** — **§ MVP architecture**, **§ Multipass correction and spine** |
| Multipass | **`multipassMaxIterations`** (default e.g. **5**); exit on **idle**, **stalemate** (no **`applyable`** but proposals exist), **empty proposals**, or **cap** |
| Spine | **`correction.spineIntervals`** built **after reversal**; **recomputed** after each **mutating** **`resolution-apply`** |
| Block overlap (incl. partial, mixed) | **Detect** time overlap (two+ stories); **`overlap.block`** + **`overlapDiagnostics`**; **flag + mask only** — **§ Block overlap: detection and diagnostics** |
| Chunk reorder | **`block-finding`** + **`overlap-detection`** (**brackets**, **closed** socket **`B_min ≥ t_prev`**, **`B_max ≤ t_next`**, **`spineIntervals`**); **`resolution-apply`** **`block-reorder`** only when **`socket-ok`** + **§ Internal monotonicity** on finding; **no** kinematic guard on chunk (MVP) |
| Non-block same-time | **`duplicate-proposal`**: **kinematic** competition only within a **same `timeMs` + same competition segment** (**§ Monotonic capability and duplicate competition scoping**); **not** one global group per `timeMs` across a capable slab; **apply** only if **overlap-safe** **and** **coupling-independent** |
| Non-adjacent exact dupes | **`duplicate-proposal`** only: **`exact-group-flag-only`** / **`duplicate.exact_group_unresolved`**, **flag + mask**, **not** singleton — **no** drop until they become **stream-adjacent** (then **`adjacent-exact-drop`**); **post-MVP** may add spine-aware non-adjacent collapse |
| Non-block backtrack | **singleton-proposal** + **lenient kinematic** + sampling; **apply** only if **overlap-safe** **and** **coupling-independent** |
| Unfixed / failed guard / non-winner | **Flag + mask** + **`excludedFromTrust`**; **omit** from **`canonicalTrustedPoints`**; **no** discard except explicit **drop** policy (e.g. adjacent exact dup) .|
| Handoff | **`canonicalTrustedPoints`** + **`correction.fullOrderedPoints`** + **`excludedFromTrust`** — **pre-split** at export; dumb downstream **references**, no per-frame mask recompute |
| Adjacent dedupe | **Initial:** **`objective-adjacent-dedupe`** on **`workingOrderedPoints`** after copy — **stream-adjacent** only (**ADR-0013**), same **ele** rules (**ADR-0004**). **Every multipass iteration:** **`duplicate-proposal`** re-scans stream-adjacent exact pairs and emits **`adjacent-exact-drop`**; **`resolution-apply`** performs drops (**same** predicates / **`correction.drops`** reasons as early stage) so **reorder** can surface new adjacency |
| Kinematic | **Singleton** + **duplicate** proposals only; **always** `kinematicChecks[]` when run; **block** reorder: **none** (MVP) |
| Participation | **`minTimestampPairCoverageRatio` default 0.8**; `coverageRatio` + `reasons[]`; **evaluate coverage gate before** **`noCorrectionTemporalAnomalies`** (sparse tracks can still be correction-idle); downstream joins **audit + participation** for gaps |
| `noCorrectionTemporalAnomalies` | **Correction-idle** only (see **participation-check**): recompute after **early mutations** and after **any** **`resolution-apply`** that runs; may **break** multipass early → **export** when **true** |
| Spine narrative | **Spine** after **reversal**; **proposals** + **overlap** + **coupling** use **current** snapshot each pass |
| Overlap vs coupling | **Both** consume **`proposals`**; **apply** requires passing **both** gates (**AND**) |
| Coupling | **`coupling-detection`** on **all applyable proposal kinds** (**referential**); **`correction.coupling`** export; rich **`correction.analysis`** optional **Post-MVP** |

---

## Internal monotonicity for chunk reorder (MVP)

**Eligible block:** A contiguous run of `belowAnchor` points (in `gpxIndex` / file order) where **timestamps do not retreat between consecutive points that both lie inside the block**.

**Precise rule:** For every stream-adjacent pair `(prev, curr)` such that **both** `prev` and `curr` are in the block, **`curr` must not have `belowPrevValid`** (equivalently `timeMs(curr) ≥ timeMs(prev)` on those edges).  

**Boundary:** The **first** point of the block **may** carry **`belowPrevValid`** when its stream predecessor is **outside** the block (attachment to the forward bracket), e.g. times `5 → 1, 2, 3, 4` with the block `{1,2,3,4}` — only `1` is below the previous row’s time; **inside** the block, `2,3,4` only advance locally.  

**Not eligible:** Any **intra-block** step with `timeMs` strictly decreasing vs the **previous row in the block** (`belowPrevValid` on a point whose predecessor is **also** in the block).

**Do not** misread as “zero `belowPrevValid` tags on any point in the run”; that would reject every legitimate misplaced monotonic slab.

---

## Reference stability, overlap vetoes, and coupling

### Referential instability (coupling)

**Singleton**, **duplicate**, and **block** proposals may **reference** neighbours or brackets. **`coupling-detection`** decides when **two or more** proposals **cannot** all be applied without **order** or **footprint** ambiguity (**referential** coupling — **§ Overlap vs coupling**).

**Terminology:** Informal **“secondary overlap”** meant this **dependency** problem, **not** extra **interval** scans.

### Temporal overlap (overlap-detection)

**`overlap-detection`** decides when **time stories** forbid applying a proposal (or require masking), independent of whether proposals are **referentially** coupled. A proposal can be **uncoupled** but **overlap-vetoed**, or **coupled** but **overlap-clear**, or **both** blocked.

### Relation to MVP runner

**`resolution-apply`** uses the **AND** of **overlap-detection** and **`coupling-detection`** outputs. **`block-reorder`** runs **first** among applyable work (from **`block-finding`** + **`overlapBlockResolution`**), then **singleton → `adjacent-exact-drop` → `duplicate-reorder`** — **§ `resolution-apply`**.

### Post-MVP / optional upgrade (document only until implemented)

- **Multipass** is **MVP** — see **§ Multipass correction and spine**. Further **analysis** exports are optional.
- Richer **`correction.analysis`** `{ coupledRegions, stableComponents, proposalGraph, … }` when needed.

---

## User Review Required

> [!IMPORTANT]
> **Kinematic usage in this layer:** Primary signal is **comparative** (two candidates, neighbourhood continuity). A **lenient absolute** implied-speed ceiling (versioned parameter, e.g. 80 km/h — accounting for pre-smoothing jitter) is a **backstop** for **singleton** and **duplicate** proposals — **not** for **perfect-fit block reorder** (MVP: **no** kinematic guard on chunk reorder; see **§ MVP architecture**). **Every** kinematic check must emit **structured log entries** (`correction.kinematicChecks[]` or equivalent) for offline pattern study. **No** silent discard based only on a hard cap without logging.

> [!IMPORTANT]
> **No schema changes to audit** for MVP unless a deliberate ADR says otherwise. The correction layer reads the first-pass audit output. If the working array is re-audited for `noCorrectionTemporalAnomalies` gating, that is a **second read-only pass** on **`workingOrderedPoints`** / **`correction.fullOrderedPoints`**, not a mutation of the original export.

> [!IMPORTANT]
> **Gap semantics for later layers.** **Default dynamics** (speed, acceleration, sectional smoothing) run on **`canonicalTrustedPoints`** — consecutive rows are **trusted-relative** neighbours, but **`gpxIndex` gaps** can still mean **ingestion rejections** or **correction drops** between trusted rows; consult **`audit.ingestion.rejections`** and **`correction.drops`**. **Ingestion rejects** never enter the numeric pipeline; they **must stay** on the **immutable audit** (and session handoff) for **UX** (“this row was rejected and why”) — gaps alone are not enough for UI honesty. **`correction.fullOrderedPoints`** + **`excludedFromTrust`** carry the full post-correction story for overlays without recomputing mask logic. See **§ Downstream continuity** and **§ Handoff: pre-split lists**.

> [!NOTE]
> **`minTimestampPairCoverageRatio` (default 0.8)** gates how much of the **stream-adjacent pair budget** has usable timestamp pairs (see **participation-check**). It is a coarse MVP knob until **sectional** participation (post-MVP) handles stitched GPX with mixed regions.

---

## Handoff: pre-split lists (dumb downstream)

**Principle:** **Correction-export** does the **partition once**. Later modules **reference** `canonicalTrustedPoints`, `excludedFromTrust`, `drops`, and **audit** — they **do not** re-derive trust from scratch on every run (cheaper than repeating mask resolution; fewer foot-guns).

| Handoff field | Role |
|---------------|------|
| **`canonicalTrustedPoints`** | Default input for **kinematic correction**, **smoothing**, **metrics** — points **not** in `excludedFromTrust` and not **dropped**. Consecutive entries are **the** polyline vertices for “trusted” work. **Time-conditioned** eligibility still uses **`audit` + participation** (gaps, missing/unparsable, etc.); **`excludedFromTrust`** lists **correction-only** exclusions. |
| **`correction.fullOrderedPoints`** | Full traversal after correction (**drops** removed), **including** untrusted rows — **honesty / UX** (single ordered trace, grey segments, tooltips) without a second geometric merge. |
| **`correction.excludedFromTrust`** | `{ gpxIndex, reasons[], … }[]` — **correction-layer** outcomes only (flags, masks, same-time non-winners, coupled regions, etc.). **Do not** duplicate **`audit.ingestion.rejections`** or **audit temporal** missing/unparsable / other **participation** semantics here; downstream **joins `audit` + participation** for gaps and non-participating points. |
| **`correction.drops`** | Indices **removed** from **both** lists (e.g. adjacent exact duplicate). |
| **`audit.ingestion.rejections`** | **Never** in pipeline arrays; **always** available on the session for UI — **why** a `gpxIndex` hole exists. |

**Partition sanity (accepted ingest only):** For every **`gpxIndex`** in **`points`** at correction input: either **`gpxIndex`** ∈ **`correction.drops`** (absent from **`fullOrderedPoints`**), or the point appears in **`fullOrderedPoints`** and is either (**a**) in **`canonicalTrustedPoints`** or (**b**) listed in **`excludedFromTrust`**. **Ingestion-rejected** indices are **not** in `points`; they appear **only** in **audit** + UI merge. (Enumerate edge cases in ADR: geometry-only mode, etc.)

---

## Downstream continuity (smoothing and segment boundaries)

**Preserved for the whole passage:** Original **`gpxIndex`**, **ingestion rejections** (audit), **correction** **`drops`**, **`flags`**, **`masks`**, **`excludedFromTrust`**, **`fullOrderedPoints`** — and, once implemented, **kinematic-correction** exclusions — form the **ground truth** for “what happened along the file” vs “what we trust for local dynamics.”

**Why:** After audit → correction → (later) kinematic correction, **`fullOrderedPoints`** is a **traversal-ordered** arrangement of **non-dropped** accepted points. Two **consecutive trusted** rows can still sit at **`gpxIndex`** values that are **not** consecutive in the source (e.g. … `3` → `5` with `4` rejected at ingestion). **Per-edge** Δtime and Δdistance on **`canonicalTrustedPoints`** are **span** measures when a **hole** or **untrusted** row sat between — not the same as **micro-local** sampling. **Average speed** over a long span can look **similar** to averaging finer steps, while **pairwise** Δt/Δd are **misleading** for filters that assume **neighbour = true kinematic adjacency**.

**Sectional smoothing (custom algos):** **Smooth within segments**, not **across** **lie gaps**. **Segment recognition** = derive **allowed adjacency** from **`gpxIndex` discontinuities** (ingestion + drops), **`excludedFromTrust`**, and any **kinematic-correction** boundary. **`canonicalTrustedPoints`** already **omits** untrusted vertices; gaps between consecutive trusted rows still require **audit/drops** awareness.

**Global / robust smoothers:** Contract must **not** assume **consecutive trusted rows = continuous physics** without **gap** checks; use **weights**, **gaps**, or **explicit** robust loss — document in the smoothing ADR.

**Handoff contract:** Default **derivative-style** pipelines use **`canonicalTrustedPoints`** + **`audit`/`drops`** for gaps; **full** story for UI uses **`fullOrderedPoints`** + **`excludedFromTrust`** + **audit rejections**. Document for **kinematic smoothing** and **metric** layers in their ADRs.

---

## Performance and architecture (expectations)

- **Upload latency:** Each stage is **O(n)** or **O(n × small window)** on point count. Re-auditing snapshots for `noCorrectionTemporalAnomalies` adds a few linear passes — **acceptable for MVP**; optimize only if profiling shows a problem.
- **Architecture:** **Explicit pipeline**: **early mutations** → **spine (first time)** → **multipass**: **all proposal modules** (read-only) → **`overlap-detection`** → **`coupling-detection`** → **`resolution-apply`** (**AND** gate); **recompute spine** after mutating apply. **Pre-split export** keeps **downstream** simple.

---

## Audit pipeline: module-wise flags and outputs (reference)

Canonical implementations live under `packages/audit/pipeline/`. Tags are **observational**; **non-exclusive** where noted. **Pair** identities use `{ fromGpxIndex, toGpxIndex }` on **stream-adjacent** accepted points (`toGpxIndex === fromGpxIndex + 1`, ADR-0013).

| Module | File | Entity | Flags / anomalies / key fields |
|--------|------|--------|--------------------------------|
| **Ingestion** | `gpx-ingestion-module.js` | Rejected points only (not in `points`) | **`audit.ingestion.rejections.events[]`**: `gpxIndex`, `pointType`, `rawLat`, `rawLon`, `rawEle`, `rawTime`, **`reason`** (e.g. invalid coordinates, out-of-range lat/lon). Plus **`counts`** (`totalPointCount`, `validPointCount`, `rejectedPointCount`, `pointTypeCounts`) and **`context`** (`hasMultiplePointTypes`, `hasAnyTimestampValues`). |
| **Temporal** | `timestamp-audit.js` | Per **point** (`gpxIndex`) | **`tagCounts` / `tagIndex` / `pointAnnotations`**: **`missing`**, **`unparsable`**, **`adjacentDuplicate`**, **`belowAnchor`**, **`belowPrevValid`**, **`nonAdjacentRepeat`** (non-exclusive except adjacent vs non-adjacent repeat are mutually exclusive by construction). Session: `parseableTimestampPointCount`, `totalPointsEvaluated`, `rawSessionDurationSec`. |
| **Sampling** | `sampling-audit.js` | Stream-adjacent **pairs** (time + distance) | **`audit.sampling.time.timestampContext`**: `hasAnyParseableTimestamp`, **`hasAnyPositiveTimeDelta`**, `timestampedPointsCount`, **`consecutiveTimestampPairsCount`**, **`positiveTimeDeltaCount`**, `rejections.nonPositiveTimeDeltaPairs` (`nonPositivePairCount`, **`events`** `{ fromIndex, toIndex, delta }`). Plus **Δt statistics**, **time clustering** / **normalization** metadata. **`audit.sampling.distance`**: `pairInspection.consecutivePairCount`, `rejections.invalidDistance`, **Δd statistics**, distance clustering / normalization, `timeConditionedDeltaCount`. |
| **Motion** | `motion-audit.js` | Stream-adjacent **pairs** | **`tagCounts` / `tagIndex` / `pairAnnotations`**: **`backwardTime`**, **`zeroTimeDelta`**, **`timeUnresolvable`** (no finite `timeMs` on one or both ends — use **`audit.temporal`** for point-level why), **`nonFiniteDistance`**, **`eleUnresolvable`** (ele missing/out of band vs motion params). Optional `dtSec`, `ddMeters` on annotations per glossary. **`summary.consecutivePairCount`**, **`summary.parameters`** (`validFloorM`, `validCeilingM`). |
| **Elevation** | `elevation-audit.js` | Per **point** | **`tagCounts` / `tagIndex` / `pointAnnotations`**: **`missing`**, **`unparsable`**, **`outOfBounds`**, **`adjacentDuplicate`** (mutual-exclusion rules per file header). `validElevationPointCount`, `parameters` (`validFloorM`, `validCeilingM`). |
| **Audit export** | `audit-export-module.js` | — | Assembles **`metadata`** + **`audit`** object with **`ingestion`**, **`temporal`**, **`sampling`**, **`motion`**, **`elevation`** sub-payloads; **no extra tags**. |

### Audit modules vs correction participation (MVP)

How each audit area relates to **which accepted points / pairs** participate in **time-centric correction** (reorder, overlap, duplicate-time, etc.). Downstream **joins `audit` + participation** for full eligibility; **`correction.excludedFromTrust`** stays **correction-only** (see **§ Handoff**).

| Audit area | Role in correction participation (MVP) |
|------------|------------------------------------------|
| **Ingestion** | **Rejected** rows are **not** in **`points`** — they **cannot** participate; canonical list is **`audit.ingestion.rejections`**. |
| **Temporal** | **Primary.** Point-level time story (**`missing`**, **`unparsable`**, **`belowAnchor`**, **`belowPrevValid`**, **`adjacentDuplicate`**, **`nonAdjacentRepeat`**) drives correction design; **`noCorrectionTemporalAnomalies`** uses temporal + sampling time (see **participation-check**). |
| **Sampling** | **Time:** pair-level forward vs non-positive Δt (same stream-adjacent gate as temporal/motion). **Distance:** pairs that fail finite, non-negative **Δd** (**`rejections.invalidDistance`**) are a **safety gate** for anything that needs a trusted spatial step along the stream — rare with valid lat/lon ingest, but policy may treat those pairs as **non-participating** for spatially sensitive correction steps. |
| **Motion** | **Not required** for correction participation gating. **`timeUnresolvable`** / **`eleUnresolvable`** / **`backwardTime`** / **`zeroTimeDelta`** at **pair** granularity **restate** conditions already visible from **`audit.temporal`** (endpoints without usable time) and **`audit.elevation`** (endpoints that fail motion’s in-band ele check, i.e. missing / unparsable / **out-of-bounds** on the point). They do **not** introduce new **`gpxIndex`** values beyond those modules. **`nonFiniteDistance`** is an edge safety net (see sampling distance). |
| **Elevation** | **Secondary** for **time-centric** correction MVP: **`ele`** does **not** define whether a point **participates** in timestamp reorder logic. Use **`audit.elevation`** when classifying usable vs OOB for **`objective-adjacent-dedupe`**. **`elevation.adjacentDuplicate`** is **observational** (study / quality), not a correction participation switch. **Ele** resolution: **§ `objective-adjacent-dedupe`**. |

Design docs: `docs/project/pipeline/*.md`, `docs/project/json-schema-v2-glossary.md`. See also **`docs/project/objective-participation-and-quality.md`** (correction vs metrics participation).

---

## Proposed Changes

### New Package: `packages/correction/`

#### [NEW] `packages/correction/pipeline/participation-check.js`

Reads from `audit.temporal` and `audit.sampling`. Decides **mode**, **`coverageRatio`**, then **`noCorrectionTemporalAnomalies`** (**correction-idle** — see below). **Evaluation order:** **coverage / mode first**, then **`noCorrectionTemporalAnomalies`**, so a **`timestamp-sparse`** file can still be correction-idle (no reorder work) and take the **skip** path.

**Inputs from audit:**
- `audit.temporal.session.parseableTimestampPointCount`, `totalPointsEvaluated`, `tagCounts`, `tagIndex`
- `audit.sampling.time.timestampContext` (`hasAnyPositiveTimeDelta`, `consecutiveTimestampPairsCount`, `positiveTimeDeltaCount`, non-positive pair events as needed)
- `audit.sampling.distance.pairInspection.consecutivePairCount` (denominator for **coverageRatio** — **stream-adjacent** pairs in the accepted array; align with live export if motion summary is used instead)
- Optional policy: `audit.sampling.distance.pairInspection.rejections.invalidDistance` when defining **pair** participation for spatially sensitive steps (**§ Audit modules vs correction participation**). **`audit.motion`** is **not** required for **`noCorrectionTemporalAnomalies`** or **`coverageRatio`**.

**Decisions emitted:**
1. `participationProfile.mode`: `'geometry-only'` | `'full'` | `'timestamp-sparse'`
2. `participationProfile.coverageRatio`: `consecutiveTimestampPairsCount / consecutivePairCount` (pair-level; **consecutivePairCount** = stream-adjacent pairs evaluated for distance, same basis as `objective-participation-and-quality.md`; **verify** against `audit.motion.summary.consecutivePairCount` — should match when both use ADR-0013 adjacency)
3. `participationProfile.reasons[]`
4. `participationProfile.noCorrectionTemporalAnomalies`: boolean (**correction-idle**)

**Participation mode (evaluate in this order):**
```
IF parseableTimestampPointCount === 0
  → mode = 'geometry-only', reason = 'no-parseable-timestamps'

ELSE IF coverageRatio < minTimestampPairCoverageRatio (default 0.8, versioned in profile.parameters)
  → mode = 'timestamp-sparse', reason = 'insufficient-pair-coverage'

ELSE
  → mode = 'full'
```

**`noCorrectionTemporalAnomalies` = correction-idle (MVP — this layer’s scope only):** “**No work for the correction reorder / backtrack / duplicate-time machinery**” — **not** “no temporal gaps globally.” **Do not** require zero **missing** / **unparsable** timestamps or zero **ingestion rejections**; those stay on **`audit`** and **participation** for downstream to **join**. Predicate (align field names with live `audit.sampling` / **ADR-0013**):

- `hasAnyPositiveTimeDelta === true`
- On every stream-adjacent pair where **both** endpoints have finite `timeMs`, **`Δt > 0`**: e.g. `positiveTimeDeltaCount === consecutiveTimestampPairsCount` and **no** non-positive events in that eligible set
- `audit.temporal.tagCounts` for **`belowAnchor`**, **`belowPrevValid`**, **`nonAdjacentRepeat`** are all **0** (no work for **overlap / chunk / singleton / duplicate** machinery)

**Explicitly out of this predicate:** **`missing`**, **`unparsable`** (gap semantics; not corrected here). **`adjacentDuplicate`** temporal tag may coexist with correction-idle only when **sampling** already shows all timestamped pairs strictly forward — if duplicate-time edges exist, sampling non-positive events or temporal counts will fail the predicate.

**Skip entire correction:** If **`noCorrectionTemporalAnomalies === true`** (correction-idle) **after** the above and product rules allow **full skip** (e.g. not forcing geometry-only through a different path), **short-circuit**: `workingOrderedPoints = copy(points)`, **`canonicalTrustedPoints` = copy(points)**, **`correction.fullOrderedPoints` = copy(points)**, **`correction.excludedFromTrust` = []**, emit minimal `correction` profile noting skip reason. **Gaps** and **non-participating** points remain discoverable via **`audit`** + **`participation`**; **`excludedFromTrust`** is not used to mirror those on this path.

---

#### [NEW] `packages/correction/pipeline/objective-adjacent-dedupe.js`

First mutation stage. **Stream-adjacent** pairs only (**ADR-0013** `curr.gpxIndex === prev.gpxIndex + 1`).

**Non-adjacent 100% duplicates:** **Never** drop here, even when time+lat+lon+ele match on non-consecutive **`gpxIndex`** rows — collapsing assumes one observation is redundant on the **correct** spine when **neither** may be. **`duplicate-proposal`** / **`duplicate.exact_group_unresolved`** handles those (MVP). **Automated non-adjacent dedupe** = **post-MVP** (recursive / spine-aware policy).

**Usable `ele`:** finite number inside the same **valid band** as **`audit.elevation`** / motion (e.g. profile **`validFloorM`**–**`validCeilingM`**, aligned with audit defaults). **Not usable:** missing / unparsable / **out-of-bounds** (per **`audit.elevation`**), non-finite, or null where no valid number — use **`audit.elevation.tagIndex`** when needed.

**When `timeMs`, `lat`, `lon` match** (ingestion equality semantics):

| Situation | Action |
|-----------|--------|
| **Time, lat, lon, ele** all exactly equal (including identical null/absent **ele**) | **Drop one**; **`correction.drops`** reason **`adjacent-exact-duplicate`**. |
| **Both** lack **usable** **ele** | **Drop one**; survivor keeps absent / **`null`** **ele** as appropriate. |
| **Exactly one** **usable** **ele** | **Drop** the point **without** usable **ele**; survivor keeps the in-band value. |
| **Both** **finite** **ele** but **both** **out-of-bounds** | **Drop one**; survivor **`ele = null`** (and consistent **`eleAbsent`** / metadata per product rules) for downstream DEM / interpolate / smooth. |
| **Both** have **usable** **ele** but **values differ** | **No drop** — **`correction.flags`** both **`adjacent-duplicate-ele-mismatch`**. |

**When time or lat/lon differ** — partial duplicate: **flag**, **no drop**.

**Immutability:** New objects for updated survivor rows (**`ele`** cleared to **`null`** where applicable); do not mutate **`audit`**.

**Non-adjacent** exact groups remain **`duplicate-proposal`** — **not** **`singleton-proposal`**.

**After this step:** Recompute **`noCorrectionTemporalAnomalies`** on the working snapshot (see **§ Recomputing `noCorrectionTemporalAnomalies`**). If `true`, skip all subsequent correction substeps and jump to **correction-export**.

---

#### [NEW] `packages/correction/pipeline/reversal-check.js`

**Goal:** One **cheap** global hypothesis — **full array reversal** — then an **objective** accept/reject using **`noCorrectionTemporalAnomalies`** on the **reversed** snapshot (same definition as **participation-check** / **§ Recomputing `noCorrectionTemporalAnomalies`**). Do **not** require pointwise monotonic **`timeMs`** on the reversed array; interior backtrack can remain and still fail a strict monotonic test even when reversal is the right fix.

**Skip entire module (no-op):** **`geometry-only`** (participation); **all-identical** / time-useless pre-check (below); fewer than **2** finite **`timeMs`** rows in **`workingOrderedPoints`** (nothing to compare).

**All-identical pre-check:**
```
IF adjacentDuplicate === parseableTimestampPointCount - 1
  OR sampling shows all non-positive Δt are exactly 0
  → treat as time-useless / geometry-only for reversal; skip reversal (align with existing roadmap)
```

**Reversal candidacy (either is enough — evaluate on current `workingOrderedPoints` after adjacent dedupe):**

1. **No forward Δt (original audit):** `audit.sampling.time.timestampContext.hasAnyPositiveTimeDelta === false` on the **ingest** audit passed into the runner.
2. **Endpoint envelope:** Let **`firstUsable`** = first row in **`workingOrderedPoints`** order with finite **`timeMs`**, **`lastUsable`** = last such. Require **≥2** usable timestamps. Let **`tMax`** / **`tMin`** be max / min **`timeMs`** over all rows with finite **`timeMs`**. **Envelope** iff **`firstUsable.timeMs === tMax`**, **`lastUsable.timeMs === tMin`**, and **`tMax > tMin`**. (Captures “file runs backward in time” at the ends even when **`hasAnyPositiveTimeDelta`** is **true** because of interior noise.)

If **neither** (1) nor (2) holds → **no-op**.

**Hypothesis application:** Reverse **`workingOrderedPoints`** traversal order (reverse the array; **`gpxIndex`** unchanged per point). **Re-run** read-only timestamp + sampling slice on the reversed snapshot (or equivalent) and compute **`noCorrectionTemporalAnomalies`**.

- If **`noCorrectionTemporalAnomalies === true`** → **keep** reversal; record **`correction.rearrangements`** (full reversal) per schema / ADR.
- Else → **revert** to pre-reversal order; **`correction.flags`** e.g. **`reversal-unconfirmed`** (no mutation retained).

**Note:** Full reversal **inverts traversal order** — see **Traversal neighbours** at top.

**After this step:** Recompute **`noCorrectionTemporalAnomalies`** on the **final** working snapshot (already evaluated for accept path; recompute once for runner consistency) → short-circuit to **correction-export** if **true**.

---

#### [NEW] `packages/correction/pipeline/spine-intervals.js`

**Read-only** on `workingOrderedPoints`.

**Duty:** Compute **`correction.spineIntervals`** from **current** traversal order + **`auditResult`** per **versioned** rules (**§ Multipass correction and spine**). Called **once after `reversal-check`** and **again after each mutating `resolution-apply`**.

---

#### [NEW] `packages/correction/pipeline/overlap-detection.js` (or `overlap-detector.js`)

**Read-only** on `workingOrderedPoints`.

**Inputs:** **`correction.proposals[]`**, **`workingOrderedPoints`**, **`auditResult`**, **`correction.spineIntervals`** (if used), and any **shared** context the profile defines.

**Duty:** (**§ Block overlap**, **§ Overlap vs coupling**)

- For each **`kind: 'block-finding'`**, compute **`B_min`/`B_max`**, **brackets** (**not** naïvely “immediate wrong neighbours” only — **§ Terminology: bracket vs socket**), **closed socket**, overlap components, and populate **`correction.overlapBlockResolution[]`** with **`status`** and optional **`blockReorderPayload`**.
- For **all** proposal kinds, determine **temporal** vetoes — **`overlapVetoedProposalIds`** (or equivalent), **`flags`**, **`masks`**, **`overlapDiagnostics`**.

**Does not** build **duplicate** kinematic competition clusters (**`duplicate-proposal`** owns grouping — **§ Proposal discipline**). **Exact rules** are **versioned** in ADR — not fully locked in this plan.

**Mutates:** **No**.

---

#### [NEW] `packages/correction/pipeline/block-proposal.js`

**Read-only** on `workingOrderedPoints`.

**Duty:** For each **maximal contiguous** **`belowAnchor`** run, emit **`correction.proposals[]`** entry **`kind: 'block-finding'`** with payload **`gpxIndexes[]`** (or **`fromGpxIndex`/`toGpxIndex`** span) and **`internalMonotonicity: boolean`** (**§ Internal monotonicity**). **Does not** compute **brackets**, **socket**, **`B_min`/`B_max`**, or **`block-reorder`** — **`overlap-detection`** (**§ Block overlap**). **Does not** consult **`overlap-detection`** / **`coupling-detection`**. **No** kinematic on chunk (MVP).

---

#### [NEW] `packages/correction/pipeline/singleton-proposal.js`

**Read-only** on `workingOrderedPoints`. **Non-duplicate** backtrack / insert candidates only — **not** same-`timeMs` equivalence classes (**`duplicate-proposal`**).

- **Backtrack insert:** **Sampling / clustering** vs **`gpxIndex` ± `localWindowSize`** (see **Sampling baseline**); **lenient kinematic** logged to **`kinematicChecks[]`**. Emit **`singleton-insert`** **proposal** or **local** flags (**`sampling.*`**, **`kinematic.*`**, etc.) when **this module’s** rules fail — **not** overlap/coupling vetoes (those are **downstream**).
- **Does not** handle **non-adjacent 100% exact duplicates** — see **`duplicate-proposal`**.

---

#### [NEW] `packages/correction/pipeline/duplicate-proposal.js`

**Read-only** on `workingOrderedPoints`. Runs **every** multipass iteration (with **`block-proposal`** and **`singleton-proposal`**).

**Per-pass stream-adjacent exact duplicates (`adjacent-exact-drop`):** Scan **current** `workingOrderedPoints` for **stream-adjacent** pairs (**ADR-0013** `curr.gpxIndex === prev.gpxIndex + 1`). Where **`timeMs`**, **lat**, **lon**, and **ele** resolution match **`objective-adjacent-dedupe`** / **ADR-correction-0004** (same table as **§ `objective-adjacent-dedupe`** — full quadruplet equal, asymmetric **ele**, dual OOB, etc.), emit **`correction.proposals[]`** entries **`kind: 'adjacent-exact-drop'`** with payload **`keepGpxIndex`**, **`dropGpxIndex`** (and survivor **`ele`** hint if needed — versioned). **`resolution-apply`** performs the removal and **`correction.drops`** logging (**same** reasons as early dedupe, e.g. **`adjacent-exact-duplicate`**). **Rationale:** **`block-reorder`** can make **non-adjacent** exact twins **adjacent** in traversal order; only **`objective-adjacent-dedupe`** would miss them without this pass. **Non-adjacent** exact pairs **still** do not get **`adjacent-exact-drop`** here — they remain for **`exact-group-flag-only`** below.

**Order inside this module (determinism):** (1) Detect all **`adjacent-exact-drop`** pairs on **current** `workingOrderedPoints`. (2) Build **`duplicate-reorder`** and **`exact-group-flag-only`** cohorts from a **logical** post-drop view: **simulate** those removals in **deterministic** order (**descending `dropGpxIndex`**) **without** mutating the real array until **`resolution-apply`**, so **`duplicate-reorder`** payloads never reference **`dropGpxIndex`** rows and stay valid **after** drops run first in the duplicate batch (**§ `resolution-apply`**). (3) **`resolution-apply`** applies **`adjacent-exact-drop`** **before** **`duplicate-reorder`**; multiple drops: **descending `dropGpxIndex`** — **versioned**.

**Competition keys** for same-instant **different** coords: **`(timeMs, competitionSegmentId)`** (or equivalent), **not** `timeMs` alone — see **§ Monotonic capability and duplicate competition scoping**. Classify contiguous **`belowAnchor`** runs, **monotonic capability**, **segment** boundaries (versioned), and **outside-tethered** duplicate sub-runs before forming kinematic groups. Include **`adjacentDuplicate`** chain members **only** within the **same** segment and subject to **tether** rules.

**Exact duplicate groups — non-adjacent (MVP):** For **≥2** points sharing **identical** `timeMs` + lat + lon + ele (per **ADR-0004**) where **no** **`adjacent-exact-drop`** applies on **this** snapshot (they are **not** stream-adjacent pairs / runs), emit **`duplicate.exact_group_unresolved`**, **flag + mask**, **`kind: 'exact-group-flag-only'`**; **no** kinematic competition, **no** winner. **Segmentation** still applies to **which** indices are grouped for **exact-group** detection where the profile distinguishes **disjoint** exact slabs (avoid one spurious mega-group across segments).

**Same `timeMs`, different coordinates:** Emit **`duplicate-reorder`** **proposal**(s) **per competition segment** with **kinematic** evaluation logged when **this module’s** rules yield an applyable candidate; **`overlap-detection`** / **`coupling-detection`** decide if each may run. **Kinematic** rules: comparative + lenient ceiling; tie / all hot → **`kinematic.no_safe_move`**, **local** flags. **Winner** chosen at **apply** time → non-winners flagged for **`excludedFromTrust`** at export.

---

#### [NEW] `packages/correction/pipeline/coupling-detection.js`

**Read-only.** Inputs: **`correction.proposals[]`**, **`flags`**, **`workingOrderedPoints`**, **`correction.spineIntervals`** (if used), and any overlap output needed for **edge** policy.

**Duty:** Build **referential** **`coupledRegions`** and **`independentProposalIds`** across **all proposal kinds** (**`block-finding`**, **singleton**, **duplicate**, **`adjacent-exact-drop`**). **Not** temporal overlap as the **definition** of an edge; **not** an edge for one `gpxIndex` with two labels (multi-label **flags** on that index).

**Output:** **`correction.coupling`**: **`independentProposalIds[]`**, **`coupledRegions[]`** (each: `proposalIds[]`, `gpxIndexes[]`, `reason`).

---

#### [NEW] `packages/correction/pipeline/resolution-apply.js`

**Mutates** `workingOrderedPoints`.

**Duty:** **`block-reorder`:** For each **`block-finding`** **`id`** with **`overlapBlockResolution.status === 'socket-ok'`**, **`id`** **not** in **`overlapVetoedProposalIds`**, and **`id`** **coupling-safe**, apply **`blockReorderPayload`** from **`overlapBlockResolution`**; log **`rearrangements`** **`kind: 'block-reorder'`**. **Other kinds:** Let **`applyable`** = **`independentProposalIds`** ∩ **not** **`overlapVetoedProposalIds`**. Apply in order: **`singleton-insert`** → **`adjacent-exact-drop`** (**descending `dropGpxIndex`**) → **`duplicate-reorder`**. **`exact-group-flag-only`:** **flag-only** via **`flags`** / **`masks`**. **Coupled** or **overlap-vetoed** → **`coupled.*`** / **`overlap.*`** + **mask**; **no** partial apply where forbidden.

**After this step:** Recompute **`noCorrectionTemporalAnomalies`** → short-circuit to **correction-export** if **true** (product rule).

---

#### [NEW] `packages/correction/pipeline/correction-export.js`

Assembles **`correction`** profile, **`canonicalTrustedPoints`**, and **`correction.fullOrderedPoints`** / **`correction.excludedFromTrust`** (see **§ Handoff: pre-split lists**). **`flags[].type`** values follow **MVP flag taxonomy** (above); keep stable strings for downstream study.

**Export step:** From final **`workingOrderedPoints`**, build **`fullOrderedPoints`** (same order), compute **`excludedFromTrust`** from **correction** policy only (**flags** / **masks** / same-time losers / unresolved overlap regions, etc. — **not** audit ingestion rejects or audit temporal missing/unparsable duplication), then **`canonicalTrustedPoints` = filter** of `fullOrderedPoints` excluding that set. **`drops`** already removed from both ordered lists. Downstream **joins `audit` + participation** for gap and eligibility semantics.

**Output shape (MVP):**
```js
{
  correction: {
    profile: {
      profileId: string,
      algorithmVersion: string,
      parameters: {
        minTimestampPairCoverageRatio: 0.8,
        localWindowSize: 5,
        lenientMaxImpliedSpeedKph: 80,  // example default; versioned
        // ...
      }
    },
    participation: {
      mode: 'geometry-only' | 'timestamp-sparse' | 'full',
      coverageRatio: number,
      reasons: string[], // MVP: no qualityLevel; numeric coverage for internal study
      noCorrectionTemporalAnomalies: boolean
    },
    spineIntervals: [
      { fromGpxIndex: number, toGpxIndex: number /* versioned: optional kind, reason */ }
    ],
    multipass: {
      maxIterations: number,
      iterationsRun: number,
      exitReason?: 'idle' | 'stalemate' | 'no-proposals' | 'max-iterations',
      // optional — § Multipass diagnostics
      passLog?: Array<{
        passIndex: number,
        proposalIds: string[],
        applyableIds: string[],
        appliedProposalIds?: string[],
        overlapVetoedCount?: number,
        couplingBlockedCount?: number,
      }>,
    },
    proposals: [
      { id: string, kind: 'block-finding' | 'singleton-insert' | 'adjacent-exact-drop' | 'duplicate-reorder' | 'exact-group-flag-only',
        gpxIndexes?: number[], internalMonotonicity?: boolean, keepGpxIndex?: number, dropGpxIndex?: number, /* payload per kind — ADR */ }
    ],
    overlapApplication: {
      vetoedProposalIds?: string[],
      overlapBlockResolution?: Array<{
        findingId: string,
        status: 'socket-ok' | 'overlap' | 'no-bracket' | 'skipped-non-monotonic',
        tPrev?: number, tNext?: number, bMin?: number, bMax?: number,
        prevGpxIndex?: number, nextGpxIndex?: number,
        blockReorderPayload?: object /* versioned */
      }>,
    },
    coupling: {
      independentProposalIds: string[],
      coupledRegions: [ { proposalIds: string[], gpxIndexes: number[], reason: string } ]
    },
    kinematicChecks: [
      { stage, gpxIndexes?, candidates?, metrics, passed, reason, parametersSnapshot }
    ],
    rearrangements: [ /* resolution-apply (+ early reversal); kinds e.g. block-reorder (from block-finding+overlap) | singleton-insert | adjacent-exact-drop | duplicate-reorder | full-reversal; ... */ ],
    drops: [ { gpxIndex, reason } ],
    masks: [ { fromGpxIndex, toGpxIndex, reason } ],
    flags: [ { type, gpxIndex?, gpxIndexes?, reason, action, stage?, relatedTimeMs?, details? } ],  // type from § MVP flag taxonomy
    overlapDiagnostics: [
      // one entry per overlap-flagged block (or merge into flags[].details — ADR)
      { gpxIndexes: number[], closedSocketWouldFit?: boolean, intervalViolation?: boolean,
        equalityConflictWithSpine?: boolean, duplicateTimeSignal?: boolean,
        bracketMissing?: boolean, partialOverlap?: boolean, tPrev?: number, tNext?: number, bMin?: number, bMax?: number }
    ],
    fullOrderedPoints: [ /* ... same objects as working snapshot, drops removed */ ],
    excludedFromTrust: [ { gpxIndex, reasons: string[], /* link to flag ids if useful */ } ]
  },
  canonicalTrustedPoints: [ /* subset of fullOrderedPoints — default handoff to kinematic / smoothing */ ]
}
```

---

#### [NEW] `packages/correction/correction-runner.js`

**API:** `correctionRunner({ points, auditResult })` → `{ correction, canonicalTrustedPoints }`  
(`correction` embeds **`fullOrderedPoints`**, **`excludedFromTrust`**, etc.)  
Called **inline from the audit pass** after audit assembly (same as before).

**Orchestration:**

1. **participation-check** — compute **mode** / **`coverageRatio`** first, then **`noCorrectionTemporalAnomalies`** (**correction-idle**); if **correction-idle** and product rules allow **full skip** → emit profile + trusted/full/excluded as in **skip** path (see participation-check) → **return**.
2. Else set **`workingOrderedPoints` = copy(`points`)**, initialize **`correction.proposals[]`**, read **`multipassMaxIterations`** from profile (default **5**), **`multipass.iterationsRun = 0`**.
3. **objective-adjacent-dedupe** — mutate; recompute **`noCorrectionTemporalAnomalies`**; short-circuit to **correction-export** if **true**.
4. **reversal-check** (if applicable) — **full reversal** when candidacy holds (**§ `reversal-check`**); **keep** reorder only if **`noCorrectionTemporalAnomalies`** on reversed snapshot; recompute on **final** order; short-circuit if **true**.
5. **`spine-intervals`** — set **`correction.spineIntervals`** (**first** spine build).
6. **Multipass loop** (see **§ Multipass correction and spine**):
   - If **`multipass.iterationsRun ≥ multipassMaxIterations`** → **break**; **`multipass.exitReason = 'max-iterations'`**.
   - **`block-proposal` → `singleton-proposal` → `duplicate-proposal`** — replace **`correction.proposals[]`** for this pass.
   - If **`proposals`** is **empty** → **break**; **`multipass.exitReason = 'no-proposals'`**.
   - **overlap-detection** → **coupling-detection**.
   - If **`applyable`** (overlap-safe ∩ coupling-safe) is **empty** while **`proposals`** is **non-empty** → increment **`multipass.iterationsRun`**; **break**; **`multipass.exitReason = 'stalemate'`** (fixed point: **no** mutation).
   - **`resolution-apply`** — apply **`applyable`** in deterministic order; append **`rearrangements`** (include **`passIndex`** / **`iteration`** in log if useful).
   - Increment **`multipass.iterationsRun`**. **Recompute** **`spine-intervals`** after **mutating** apply. **Recompute** **`noCorrectionTemporalAnomalies`**; if **true** → **break**; **`multipass.exitReason = 'idle'`**. Else **continue** loop.
7. **correction-export** — **always**: split **`workingOrderedPoints`** → **`fullOrderedPoints`**, **`excludedFromTrust`**, **`canonicalTrustedPoints`**.

**Note:** **Overlap-detection** and **coupling-detection** are **recomputed** every pass on **fresh** **`proposals`** and **current** geometry. **`resolution-apply`** enforces the **AND** gate each pass and merges **`block-finding`** with **`overlapBlockResolution`** for **`block-reorder`**.

**Internal state:** **`workingOrderedPoints`** mutates only in **early stages** and **`resolution-apply`**. **Export** emits the **pre-split** handoff.

**Recomputing `noCorrectionTemporalAnomalies`:** Use the same **correction-idle** definition as **participation-check** on the current snapshot. Implementation choice: **re-run** `auditTimestamps` + sampling time slice on **`workingOrderedPoints`** (read-only, second pass), or an equivalent pure function on the snapshot. Must respect **ADR-0013** adjacency. Original `auditResult` remains the immutable first-pass record on the upload.

---

### Module reference (MVP): duty, I/O, early exit

**Short-circuit summary**

| After step | Condition | Next step |
|------------|-----------|-----------|
| **participation-check** | Product **full skip** + **`noCorrectionTemporalAnomalies`** (**correction-idle**) | **return** (minimal `correction`; trusted/full = copy(`points`); **`excludedFromTrust` = []**; **`proposals`/`coupling`** empty or omitted per schema) |
| **objective-adjacent-dedupe** | `noCorrectionTemporalAnomalies === true` | **correction-export** only — **skip** spine + **multipass** |
| **reversal-check** | `noCorrectionTemporalAnomalies === true` | same as above |
| **Inside multipass** | `noCorrectionTemporalAnomalies === true` after **apply** | **exit** loop → **correction-export** |
| **Never** | — | Do **not** skip **correction-export** on the main path — it **always** runs after dedupe/reversal (short-circuit) or after **resolution-apply**, except **participation** early **return** which still emits a valid handoff **without** running dedupe. |

---

### `participation-check.js`

| | |
|--|--|
| **Duty** | Read **audit**; set **`coverageRatio`** and **mode** (**geometry-only** / **full** / **timestamp-sparse**) using **`minTimestampPairCoverageRatio` (default 0.8)** first; then **`noCorrectionTemporalAnomalies`** (**correction-idle** — reorder/backtrack/duplicate-time scope only; **not** global gap-free). |
| **Mutates** | **No** `workingOrderedPoints` (not run yet). |
| **Inputs** | `points`, `auditResult` (temporal, sampling, motion/distance summary for denominators — see section body). |
| **Outputs** | `participation` slice of `correction`; may set runner-internal **`skipHeavyCorrection`** per product rules. |
| **Early exit** | If **full skip** path: emit **`canonicalTrustedPoints` = fullOrdered = copy(`points`)**, **`excludedFromTrust` = []** (correction-only list; **do not** mirror **audit** gaps here), minimal **`correction`**, **`return`**. **Do not** run dedupe → export. |
| **Otherwise** | Continue to initialize **`workingOrderedPoints` = copy(`points`)**, **`correction.proposals = []`**. |

---

### `objective-adjacent-dedupe.js`

| | |
|--|--|
| **Duty** | Stream-adjacent only: **drop** exact quadruplet or **ele**-resolved duplicates per **§ `objective-adjacent-dedupe`** table; **flag** conflicting dual usable **ele**; **flag** partial match; **no** non-adjacent drops (MVP). |
| **Mutates** | **Yes** — removes dropped indices from **`workingOrderedPoints`**; may set survivor **`ele`** to **`null`** (OOB pair case). |
| **Early exit** | Recompute **`noCorrectionTemporalAnomalies`**. If **true** → **correction-export** (steps **5–8** **skipped** — proposals through **resolution-apply**); ensure **`proposals`**, **`coupling`**, **`overlapApplication`** are **empty** / default. |

---

### `reversal-check.js`

| | |
|--|--|
| **Duty** | If candidacy holds (**no** positive Δt on ingest audit **or** **endpoint envelope** on current `workingOrderedPoints`), apply **full reversal** **hypothesis**; **accept** iff reversed snapshot has **`noCorrectionTemporalAnomalies`**; else **revert** + **`reversal-unconfirmed`**. |
| **Mutates** | **Yes** — reorder **`workingOrderedPoints`** only when hypothesis **accepted**; otherwise unchanged. |
| **Entry** | **Skip** if geometry-only, all-identical pre-check, or **<2** usable **`timeMs`**. |
| **Early exit** | Recompute **`noCorrectionTemporalAnomalies`**. If **true** → **correction-export**; steps **5–8** skipped; empty proposals/coupling/overlap outputs. |

---

### `overlap-detection.js`

| | |
|--|--|
| **Duty** | Consume **`correction.proposals[]`** + context; for **`block-finding`**: **brackets**, **socket**, **`overlapBlockResolution[]`**, **`blockReorderPayload`**. Emit **temporal-overlap** vetoes / **`overlapDiagnostics`** / masks (**versioned**). **Not** owner of **duplicate** kinematic clustering. |
| **Mutates** | **No**. |
| **Early exit** | **None** required — always completes (may emit zero flags). |

---

### `block-proposal.js`

| | |
|--|--|
| **Duty** | Emit **`block-finding`** for each **maximal** contiguous **`belowAnchor`** run + **`internalMonotonicity`**. **No** bracket/socket/`block-reorder` (**§ Block overlap**). **No** kinematic (MVP). |
| **Mutates** | **No**. |
| **Skipped** | If runner short-circuited after dedupe/reversal (**never reached**). |

---

### `singleton-proposal.js`

| | |
|--|--|
| **Duty** | **Non-duplicate** backtrack: sampling vs **`gpxIndex`** window; **lenient kinematic** → **`singleton-insert`** proposal **or** **local** **`sampling.*` / `kinematic.*`** flags. **No** exact-duplicate groups. |
| **Mutates** | **No**. |

---

### `duplicate-proposal.js`

| | |
|--|--|
| **Per pass** | **`adjacent-exact-drop`** scan + **`duplicate-reorder`** + **`exact-group-flag-only`** (**§ `duplicate-proposal`** body). |
| **Exact group** (non-adjacent on snapshot) | **`duplicate.exact_group_unresolved`**, **`exact-group-flag-only`**; **no** kinematic competition. |
| **Different coords, same instant** | **`duplicate-reorder`** per **competition segment**; **`overlap-detection`** / **`coupling-detection`** gate apply. |
| **Mutates** | **No**. |

---

### `coupling-detection.js`

| | |
|--|--|
| **Duty** | From **`proposals`** (all kinds), **`flags`**, **`workingOrderedPoints`**: compute **`independentProposalIds`**, **`coupledRegions`** (**referential** edges only — **§ MVP architecture**). |
| **Mutates** | **No**. |
| **Empty input** | If **`proposals`** empty: **`independentProposalIds = []`**, **`coupledRegions = []`**. |

---

### `resolution-apply.js`

| | |
|--|--|
| **Duty** | **`block-reorder`** from **`block-finding`** + **`overlapBlockResolution`** (`socket-ok` + AND gate). Then **singleton → `adjacent-exact-drop` → `duplicate-reorder`** among **`applyable`**; **`exact-group-flag-only`** → flags/masks. **Vetoed** / **coupled** → flags + masks; **no** partial apply where forbidden. Append **`rearrangements`**. |
| **Mutates** | **Yes** — **only** stage besides **early** steps that **reorders** / **insert-shuffles** `workingOrderedPoints` for **block/singleton/duplicate**. |
| **Early exit** | After apply, **`noCorrectionTemporalAnomalies`** recomputed; if **true** → **exit** multipass → **correction-export**. |
| **No independents** | **No-op** on array for that pass; may **stalemate** multipass; still run **export**. |

---

### `correction-export.js`

| | |
|--|--|
| **Duty** | Build **`fullOrderedPoints`**, **`excludedFromTrust`**, **`canonicalTrustedPoints`**; finalize **`correction`** profile. |
| **Mutates** | **No** `workingOrderedPoints` (read final snapshot). |
| **Early exit** | **Never skip** when runner reached export path from dedupe/reversal short-circuit or full pipeline. |

---

### Documentation

#### [DONE] Correction ADRs (split by scope)

- **Cross-cutting branch scope:** [`docs/adr/general/0005-post-audit-correction-branch-scope.md`](docs/adr/general/0005-post-audit-correction-branch-scope.md) — audit vs correction boundary, observation-only audit, versioned correction.
- **Correction-layer decisions (MVP):** [`docs/adr/correction/README.md`](docs/adr/correction/README.md) — indexed ADRs **0001–0008** (see **0001** / **0008** for **proposal-fed** overlap + coupling + **AND** apply).

**implementation_plan.md** remains the detailed operational spec (terminology, module table, flag taxonomy, overlap diagnostics, etc.); ADRs record **decisions, rejected alternatives, and rationale** only.

#### [MODIFY] `docs/project/product-roadmap.md`

Add section-level timestamp detection and post-MVP partial-overlap kinematic salvage under backlog if not already present.

---

## Post-MVP exploration (backlog)

- Richer **proposal graph** / **correction.analysis** (beyond **`coupling.coupledRegions`**).
- **Overlap footprint map** across all proposal kinds (detect-only for advanced contention) — see **`docs/handoffs/`** handoff notes if present.
- **Non-adjacent 100% duplicate** collapse / spine-aware dedupe (only safe with multi-pass or explicit spine policy — **not** MVP **`objective-adjacent-dedupe`**).
- **Block overlap resolution:** **internal time ordering** of sub-block; **split** block using **outside** timestamps / duplicate instants as cut points; try **smaller chunk insertions** before irreducible overlap; **cap** splits — **versioned profile**, not silent repair.
- **Partial overlap kinematic salvage** (paired with split strategy above).
- Offline **A/B** on **`coupling-detection`** sensitivity + **`kinematicChecks`** + **`flags`**.
- **Kinematic smoothing ADR:** Formal **segment** / **allowed-adjacency** graph from **`gpxIndex` gaps** (ingestion + drops) + **`excludedFromTrust`** + kinematic-correction output; default polyline = **`canonicalTrustedPoints`** — **not** “scan `fullOrderedPoints` for masks on every frame.”

---

## Open Questions

> [!NOTE]
> **Runner call site — resolved:** inline from audit with `{ points, auditResult }`.

> [!NOTE]
> **Quality levels — deferred:** MVP emits **`coverageRatio`** only; no UX-facing `qualityLevel` until calibration data exists.

Remaining tunables: exact **lenient speed** default; **bracket** predicate edge cases (start/end of file); whether **geometry-only** tracks call runner at all or return empty `correction`.

---

## Verification Plan

### Adversarial fixtures (existing + new)

- **Correction-idle** at participation (after **0.8** coverage gate + **correction-scoped** `noCorrectionTemporalAnomalies`) → **skip correction** / early **return**; **audit gaps** may still exist — downstream joins **audit + participation**
- Adjacent dupes **100% identical** (time+lat+lon+ele) → one drop logged
- Adjacent: same time+coords, **one usable ele**, other missing/unparsable/OOB → **one drop**, keeper has in-band **ele**
- Adjacent: same time+coords, **both** lack usable **ele** → **one drop**
- Adjacent: same time+coords, **both** OOB → **one drop**, survivor **`ele = null`**
- Adjacent: same time+coords, **both** usable **ele**, **unequal** → **`adjacent-duplicate-ele-mismatch`**, **both flagged**, no drop
- All-identical timestamps → no false reversal; geometry-only / flagged path
- **Envelope** candidacy: first usable = global max **`timeMs`**, last usable = global min, interior messy → reversal **accepted** only if **`noCorrectionTemporalAnomalies`** after reverse; else **revert** + **`reversal-unconfirmed`**
- **`hasAnyPositiveTimeDelta === false`** path → same **accept** = **`noCorrectionTemporalAnomalies`**, not strict pointwise monotonicity on reversed array
- Successful reversal → **`rearrangements`** logged; runner may short-circuit if **correction-idle**
- Chunk: **intra-block** time retreat (true internal `belowPrevValid` vs predecessor **in** block) → **no** MVP reorder
- Chunk: puzzle slab `5→1,2,3,4` style — first point `belowPrevValid` vs bracket only → **eligible** for monotonicity check + socket test
- Chunk: **`block-finding`** + **`overlapBlockResolution`** **`socket-ok`** + coupling-safe → **`block-reorder`** in **`resolution-apply`**; **no** kinematic on block (MVP)
- Overlap + **partial** / **mixed** (interval + equality + duplicate-time) → **`overlap.block`** + **`overlapDiagnostics`** components; **flag + mask**, no reorder
- Same-time different-coords: **decoupling** defers competition when refs overlap flagged regions → `coupled.same_time_deferred`
- Same-time: both / all candidates above lenient speed → **`kinematic.no_safe_move`**, logged
- Same instant in a **chain** (`5,5,6,5,5,5`): **full `timeMs` group**, not only `nonAdjacentRepeat` row
- Non-block backtrack: **insert** only when decoupled; **sampling** baseline from **`gpxIndex`** window — else flag (`sampling.below_neighbour_baseline` or related)
- Same-time **winner** chosen → **non-winners** flagged + **`excludedFromTrust`**; absent from **`canonicalTrustedPoints`**; present in **`fullOrderedPoints`**
- Recompute `noCorrectionTemporalAnomalies` after **early mutations** and after **`resolution-apply`** → short-circuit to export when **true**
- **Referential coupling:** e.g. neighbouring **singleton** + **duplicate** proposals → **`coupling.coupledRegions`**; **no** partial **`resolution-apply`** on that blob when policy forbids
- **Overlap veto:** proposal **`id`** in **`overlapVetoedProposalIds`** (or equivalent) → **not** in **`applyable`** even if **independent** in coupling; **`block-finding`** without **`socket-ok`** does **not** get **`block-reorder`**
- **Non-adjacent exact duplicate group** → **`duplicate.exact_group_unresolved`**, **not** singleton

- **Downstream contract:** Fixture with **ingestion hole** + **masked/flagged** index — **`canonicalTrustedPoints`** omits excluded rows; **pairwise dynamics** still consult **`audit`/`drops`** for **`gpxIndex` gaps** between consecutive trusted rows
- **Pre-split:** Assert **`excludedFromTrust`** ∪ trusted **`gpxIndex`** ∪ **`drops`** partitions **`points`** input (accepted ingest)

### Regression check

Audit adversarial suite unchanged; correction is additive and does not mutate first-pass audit payload.
