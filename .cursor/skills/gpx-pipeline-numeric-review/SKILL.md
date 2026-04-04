---
name: gpx-pipeline-numeric-review
description: >-
  Review GPX/pipeline code changes for numeric and structural edge cases that can
  corrupt, drop, or misalign data (indices, time, masks, geometry, floats, export).
  Use when editing audit, correction, metrics, ingestion, or schema paths—or when
  the user asks for edge-case / data-loss review. Does not replace tests or formal
  verification. For audit semantics (observation-only, no silent correction), use
  audit-philosophy-review.
---

# GPX Pipeline Numeric Review

Identify **numeric and structural** risks in code that processes tracks: places where results can be **wrong**, **silent**, or **misaligned** with raw/canon contracts. This skill **augments** tests and review; it **does not** guarantee correctness or prove absence of bugs.

## When to Activate

- Edits or proposals touch **ingestion**, **audit**, **correction**, **canonical geometry**, **elevation channels**, **metrics**, **sampling/time**, or **export/schema** code.
- User asks: **edge cases**, **numeric review**, **could we lose data**, **pipeline safety**, **off-by-one**, **NaN**, **mask alignment**.
- Before merging a change that affects **deterministic** audit/export behavior.

**Prefer not to run** on pure UI/layout unless it binds displayed numbers to pipeline outputs (then only the data-binding path).

**Not for:** market research, generic coding style only, security/auth-only changes.

**Overlap:** If the concern is **audit semantics** (causal language, observation-only, glossary compliance), use **`audit-philosophy-review`** first or in addition; this skill focuses on **numeric/structural** failure modes.

## Scope

### In scope

| Domain | Review focus |
|--------|----------------|
| **Point sequences** | Empty track, single point, `n` vs `n-1` segment/pair loops, index validity. |
| **Time** | Ordering, duplicates, gaps, parse failures; code that assumes time always present or strictly monotonic. |
| **Geometry / distance** | Near-zero segments, duplicate coordinates, cumulative sum from empty, antipodal or extreme distances if relevant. |
| **Masks / exclusions / profiles** | Length or index alignment with points; excluded ranges still feeding metrics; implicit fill vs explicit gaps. |
| **Resampling / alignment** | Raw index vs canonical geometry; elevation or other channels mapped to wrong points. |
| **Aggregations / windows** | Empty `reduce`, NaN propagation, window endpoints, integer overflow on large `n`. |
| **Export / schema** | Missing required fields when subset empty; ordering affecting determinism; JSON number precision if material. |
| **Floating point** | Exact equality on floats, unstable ordering keys, cancellation in small deltas. |

### Out of scope

- Replacing **unit tests**, **golden files**, or **adversarial suites**.
- **Formal proof** of correctness.
- **Product copy** and non-numeric UX except where numbers are tied to pipeline output.

## Meta-constraints (how the agent must behave)

1. **No false certainty** — Use “may”, “risk”, “if assumption X breaks”; never claim “no data can be lost.”
2. **Severity** — Tag each finding: **Critical** / **Likely** / **Theoretical** / **Mitigated if …** (with stated condition).
3. **Actionable** — Each item: failure mode, where to look (function/module), suggested mitigation (invariant, guard, schema, dev assert), optional **test idea**.
4. **Immutability** — Flag patterns that **mutate** shared track/audit state instead of producing new structures (aligns with project coding rules).
5. **Default brevity** — Unless the user asks for a **deep** pass: **top risks** (e.g. up to 5–8 bullets) plus a one-line **residual risk** note.
6. **Determinism** — For audit/export paths, flag unordered iteration, non-stable sort keys, or float order sensitivity where reruns could diverge.

## Review checklist (use as a scan guide)

Work through the list **as relevant** to the changed code; skip sections that clearly do not apply.

- **Empty / degenerate input**: zero points, one point, one valid segment, all excluded.
- **Indices**: `0..n-1` vs `1..n`, half-open ranges, off-by-one in pair/slide windows.
- **Time**: missing `time`, duplicate timestamps, non-monotonic series, division by `dt` when `dt === 0`.
- **Non-finite values**: `NaN`/`Infinity` from math; filtering that drops points without recording exclusion.
- **Masks**: same length as point count (or explicit documented mapping); bitwise vs index semantics.
- **Geometry**: distance on coincident points; bearing/azimuth edge cases if used.
- **Merging / stitching**: behavior at segment boundaries after correction or split/join.
- **Serialization**: `undefined` omitted vs `null`; big integers; sorting keys for stable output.

## Workflow

1. **Identify scope** — Files, diff, or pasted snippet; list **assumptions** the code seems to make (e.g. “timestamps strictly increasing”).
2. **Scan** — Apply checklist; cross-check call sites for **implicit** preconditions.
3. **Report** — Use the output structure below.
4. **Tests** — Suggest **specific** cases (empty, single-point, all-NaN time, duplicate time, max-size sanity) where gaps exist.

## Output structure

```text
## GPX pipeline numeric review
**Scope:** [files / operations reviewed]
**Assumptions noted:** [bullets]

| Severity | Issue | Where | Mitigation / test idea |
|----------|-------|-------|-------------------------|
| ... | ... | ... | ... |

## Residual risk
[What still depends on integration tests or real data]
```

## Examples (user prompts)

- “Numeric review on this diff for the motion audit module.”
- “Could we misalign masks and points after this change?”
- “Edge cases for empty GPX after ingestion?”
