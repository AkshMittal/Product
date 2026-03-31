---
name: audit-philosophy-review
description: Reviews changes to audit-layer code and contracts for compliance with the audit philosophy. Use when the user explicitly asks to review audit module changes (timestamp, sampling, motion, elevation, schema/glossary) with a focus on observation-only semantics, deterministic outputs, no silent correction, and strict separation between audit and downstream interpretation or policy.
---

# Audit Philosophy Review

## Purpose

Review changes in the audit layer against the project's core audit philosophy:

- observational and non-causal
- deterministic from the input stream and explicit parameters
- no silent correction, smoothing, repair, or reordering
- strict separation between audit outputs and downstream policy/interpretation layers

This skill is for review only. It does not prescribe implementation details except to explain violations.

## When to apply

Apply only when the user explicitly requests an audit review, especially for changes touching:

- audit modules and audit export schema
- `docs/project/pipeline/*` audit specs or glossary paths
- any fields labeled `audit.*`

## Hard blockers

Flag a finding as a blocker if the change does any of the following:

- **Causal inference**: implies why an anomaly happened instead of reporting what was observed.
- **Silent correction**: smooths, repairs, reorders, drops, or "fixes" data inside the audit layer.
- **Non-determinism**: outputs depend on non-explicit state, randomness, wall clock, environment, or unstable iteration order.
- **Observation-policy mixing**: audit outputs encode downstream decisions (eligibility, confidence gating, metric refusal, "usable" labels) rather than leaving those to later layers.

## Review questions

Check these, in order:

1) **Is it observational?** Does it describe stream facts (events/blocks/pairs) without motive, intent, or cause?
2) **Is it deterministic?** Same input + same params -> identical output (including ordering and block boundaries)?
3) **Does it avoid correction?** No smoothing, no silent dedupe, no reordering, no "cleanup."
4) **Is policy kept out?** No eligibility/confidence/refusal logic inside audit outputs.
5) **Are semantics precise?** Distinct anomaly families are not overloaded or merged into ambiguous labels.
6) **Does it emit, not suppress?** If an observable exists, is it emitted rather than hidden because "downstream won't use it"?

## Allowed in audit

- deterministic counts, ratios, summaries, events, blocks, and pair classifications
- explicit observational language (e.g., "timestamp less than monotonic anchor", "adjacent duplicate vs previous parseable anchor")
- subtype tagging only when based on deterministic evidence rules (not assumptions)

## Not allowed in audit

- smoothing, correction, repair, or point removal framed as audit
- confidence/refusal policy or metric eligibility decisions
- kinematic plausibility judgments unless explicitly defined as a later plausibility layer (not audit)
- claims about device intent, export cause, or user behavior
- suppressing observables because they are inconvenient

## Findings format (findings-first)

Report findings first, ordered by severity. For each finding include:

- **Severity**: Critical / High / Medium / Low
- **Title**: short and specific
- **Why it violates audit philosophy**: one paragraph
- **Evidence**: file + symbol/function + a few lines or a brief description
- **Boundary crossed**: which hard blocker or review question it violates

After findings:

- **Open questions / assumptions** (only if needed)
- **Summary** (1-2 sentences)

## Severity guidance

- **Critical**: introduces correction or mixes audit with downstream policy.
- **High**: introduces causal inference or ambiguous semantics that change meaning.
- **Medium**: weakens determinism, naming clarity, or audit contract stability.
- **Low**: wording/docs clarity issues likely to cause confusion later.

## Examples of bad patterns

- "likely GPS glitch" or "probably export bug" in audit output
- "ignore this anomaly because downstream metrics won't use it"
- smoothing/collapsing points directly inside audit code
- output fields that combine observation and eligibility (e.g., `usableForMetrics` inside `audit.*`)

## Examples of good patterns

- "timestamp equals previous parseable anchor (adjacent duplicate)"
- "timestamp less than monotonic anchor (backtracking) with event evidence"
- emitting both time and distance sampling diagnostics without deciding relevance
- recording blocks/events with evidence and leaving policy to later layers

