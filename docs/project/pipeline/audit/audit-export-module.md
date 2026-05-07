<!-- generated-by: gsd-doc-writer -->
# Audit Export Module

## Purpose

`audit-export-module.js` is the **final assembly stage** of the audit pipeline. It merges the outputs of all upstream audit modules into a single canonical `audit.json` payload with a versioned schema envelope.

It performs no analysis, labeling, or mutation — only structural assembly and metadata attachment.

## Public API

### `buildAuditExportPayload(input)`

**Parameters:**

```javascript
{
  fileName?:       string,          // source GPX filename; null if omitted
  totalPointCount?: number,         // accepted trkpt count; falls back to ingestionAudit.counts.totalPointCount
  ingestionAudit?:  Object | null,  // from gpx-ingestion-module.js
  temporalAudit?:   Object | null,  // from timestamp-audit.js
  samplingAudit?:   Object | null,  // from sampling-audit.js
  motionAudit?:     Object | null,  // from motion-audit.js
  elevationAudit?:  Object | null   // from elevation-audit.js
}
```

All fields are optional. Missing or falsy audit blocks become `null` in the output.

**Returns:**

```javascript
{
  metadata: {
    schemaVersion:    '2.0.0',
    generatedAtUtc:   string,   // new Date().toISOString() at call time
    source: {
      fileName:       string | null
    },
    summary: {
      totalPointCount: number
    }
  },
  audit: {
    ingestion:  Object | null,  // audit.ingestion from gpx-ingestion-module.js
    temporal:   Object | null,  // audit.temporal from timestamp-audit.js
    sampling:   Object | null,  // audit.sampling from sampling-audit.js
    motion:     Object | null,  // audit.motion from motion-audit.js
    elevation:  Object | null   // audit.elevation from elevation-audit.js
  }
}
```

`totalPointCount` resolution order:
1. Explicit `input.totalPointCount` if a finite number.
2. `ingestionAudit.counts.totalPointCount` if present.
3. `0` as fallback.

### `exportAuditPayloadJSON(payload, filename)`

Browser-only download helper. Serialises `payload` to JSON and triggers a file download via a temporary `<a>` element. Not part of the pipeline data path — has no effect on the returned payload and should not be called in Node/test environments.

## Output schema version

`metadata.schemaVersion` is hardcoded to `'2.0.0'`. Downstream consumers (correction layer, external tooling) should check this field before reading `audit.*` keys.

## Integration

- **Pipeline position:** last audit module; called after all five upstream modules have run.
- **Inputs:** assembled from the `audit.*` sub-objects returned by each upstream module (callers unwrap the outer `{ audit: { ... } }` wrapper each module emits before passing here).
- **Output consumed by:** correction layer entry point (`packages/correction/index.js`) receives the assembled payload as `auditJson`; `correction-runner.js` reads `auditJson.audit.temporal.perSegment`, `auditJson.audit.ingestion.segmentBoundaries`, etc.
- Does not mutate any input object.

## Notes

- `generatedAtUtc` reflects wall-clock time at `buildAuditExportPayload` call time, not GPX recording time.
- The `audit.*` keys are placed directly on the payload root alongside `metadata`; there is no additional nesting level.
