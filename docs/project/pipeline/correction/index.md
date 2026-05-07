<!-- generated-by: gsd-doc-writer -->
# index.js — Correction Layer Public Entry Point

## Purpose

Exposes the single public function `runCorrection` for external consumers of the correction layer. Acts as a thin facade over `runner/correction-runner.js`, keeping the public API stable while allowing the implementation to evolve independently.

## Inputs

None beyond what it re-exports. Consumers call:

```js
const { runCorrection } = require('packages/correction');
runCorrection(auditJson, acceptedPoints, params?)
// or minimal form:
runCorrection(acceptedPoints)
```

## Outputs

Re-exports `runCorrection` from `runner/correction-runner.js`. Returns the correction payload object as described in `correction-runner.md`.

## Key logic

- Requires `./runner/correction-runner`
- Re-exports `runCorrection` unchanged
- No parameter transformation or default injection at this layer

## Invariants

- The public API surface is exactly one function: `runCorrection`
- All implementation details are in `correction-runner.js`

## Integration

- Called by consumers of the correction layer (e2e pipeline, tests)
- Delegates immediately to `runner/correction-runner.js`

## Related ADRs

- ADR-0011 (three-phase pipeline design)
- ADR-0012 (output schema)
