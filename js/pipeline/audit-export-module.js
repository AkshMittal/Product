  /**
 * Audit Export Module
 * Builds and exports a single combined audit JSON payload.
 */

/**
 * Builds canonical combined audit payload.
 * @param {Object} input
 * @param {string} [input.fileName]
 * @param {number} [input.totalPointCount]
 * @param {Object|null} [input.ingestionAudit]
 * @param {Object|null} [input.temporalAudit]
 * @param {Object|null} [input.samplingAudit]
 * @param {Object|null} [input.motionAudit]
 * @returns {Object}
 */
function buildAuditExportPayload(input) {
  var ingestionAudit = input && input.ingestionAudit ? input.ingestionAudit : null;
  var temporalAudit = input && input.temporalAudit ? input.temporalAudit : null;
  var samplingAudit = input && input.samplingAudit ? input.samplingAudit : null;
  var motionAudit = input && input.motionAudit ? input.motionAudit : null;

  var derivedTotalPointCount = ingestionAudit &&
    ingestionAudit.counts &&
    typeof ingestionAudit.counts.totalPointCount === 'number'
    ? ingestionAudit.counts.totalPointCount
    : 0;

  var totalPointCount = input && typeof input.totalPointCount === 'number'
    ? input.totalPointCount
    : derivedTotalPointCount;

  return {
    metadata: {
      schemaVersion: '2.0.0',
      generatedAtUtc: new Date().toISOString(),
      source: {
        fileName: input && input.fileName ? input.fileName : null
      },
      summary: {
        totalPointCount: totalPointCount
      }
    },
    audit: {
      ingestion: ingestionAudit,
      temporal: temporalAudit,
      sampling: samplingAudit,
      motion: motionAudit
    }
  };
}

/**
 * Downloads audit payload as JSON.
 * @param {Object} payload
 * @param {string} filename
 */
function exportAuditPayloadJSON(payload, filename) {
  var jsonString = JSON.stringify(payload, null, 2);
  var blob = new Blob([jsonString], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
