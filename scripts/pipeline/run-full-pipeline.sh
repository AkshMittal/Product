#!/bin/bash
# run-full-pipeline.sh
# Coordinator: runs 1-extract-and-run.js in batches of 500, then 2-report-findings.js once

set -e

OUTPUT_DIR="pipeline-output/csv"

echo "========================================================================="
echo "Full Pipeline Coordinator — extracting all GPX tracks from hikr.org CSV"
echo "========================================================================="
echo ""

# Count CSV rows to determine batch count
CSV_ROWS=$(wc -l < "dataset/gpx-tracks-from-hikr.org.csv")
TOTAL_TRACKS=$((CSV_ROWS - 1))  # subtract header
BATCH_SIZE=500
BATCH_COUNT=$(( (TOTAL_TRACKS + BATCH_SIZE - 1) / BATCH_SIZE ))

echo "CSV has ~$TOTAL_TRACKS tracks. Running $BATCH_COUNT batches of $BATCH_SIZE..."
echo ""

# Clean output dir
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

# Run batches
for ((i=0; i<BATCH_COUNT; i++)); do
  OFFSET=$((i * BATCH_SIZE))
  BATCH_NUM=$((i + 1))
  echo "[Batch $BATCH_NUM/$BATCH_COUNT] offset=$OFFSET limit=$BATCH_SIZE"
  node 1-extract-and-run.js --offset "$OFFSET" --limit "$BATCH_SIZE" --output-dir "$OUTPUT_DIR"
  echo ""
done

echo "========================================================================="
echo "All batches complete. Running findings report..."
echo "========================================================================="
echo ""

node 2-report-findings.js --input-dir "$OUTPUT_DIR"

echo "========================================================================="
echo "Pipeline coordinator finished."
echo "========================================================================="
