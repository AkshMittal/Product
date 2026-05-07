# run-full-pipeline.ps1
# Coordinator: runs 1-extract-and-run.js in batches of 500, then 2-report-findings.js once

$OUTPUT_DIR = "pipeline-output/csv"
$BATCH_SIZE = 500

Write-Host "=========================================================================" -ForegroundColor Cyan
Write-Host "Full Pipeline Coordinator — extracting all GPX tracks from hikr.org CSV" -ForegroundColor Cyan
Write-Host "=========================================================================" -ForegroundColor Cyan
Write-Host ""

# Count CSV rows
$CSV_ROWS = (Get-Content "dataset/gpx-tracks-from-hikr.org.csv" | Measure-Object -Line).Lines
$TOTAL_TRACKS = $CSV_ROWS - 1  # subtract header
$BATCH_COUNT = [Math]::Ceiling($TOTAL_TRACKS / $BATCH_SIZE)

Write-Host "CSV has ~$TOTAL_TRACKS tracks. Running $BATCH_COUNT batches of $BATCH_SIZE..."
Write-Host ""

# Clean output dir
if (Test-Path $OUTPUT_DIR) { Remove-Item -Recurse -Force $OUTPUT_DIR }
New-Item -ItemType Directory -Path $OUTPUT_DIR -Force | Out-Null

# Run batches
for ($i = 0; $i -lt $BATCH_COUNT; $i++) {
  $OFFSET = $i * $BATCH_SIZE
  $BATCH_NUM = $i + 1
  Write-Host "[Batch $BATCH_NUM/$BATCH_COUNT] offset=$OFFSET limit=$BATCH_SIZE" -ForegroundColor Yellow
  & node 1-extract-and-run.js --offset $OFFSET --limit $BATCH_SIZE --output-dir $OUTPUT_DIR
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Batch $BATCH_NUM failed with exit code $LASTEXITCODE" -ForegroundColor Red
    exit 1
  }
  Write-Host ""
}

Write-Host "=========================================================================" -ForegroundColor Cyan
Write-Host "All batches complete. Running findings report..." -ForegroundColor Cyan
Write-Host "=========================================================================" -ForegroundColor Cyan
Write-Host ""

& node 2-report-findings.js --input-dir $OUTPUT_DIR

Write-Host "=========================================================================" -ForegroundColor Cyan
Write-Host "Pipeline coordinator finished." -ForegroundColor Cyan
Write-Host "=========================================================================" -ForegroundColor Cyan
