#!/bin/bash
# Ingest all project docs into Supabase
# Usage: bash scripts/ingest-projects.sh

DOCS_DIR="scripts/project-docs"
SUCCESS=0
FAILED=0

echo "Ingesting project docs from $DOCS_DIR"
echo ""

for f in "$DOCS_DIR"/*.txt; do
  echo "=== $(basename "$f") ==="
  if node scripts/ingest-one.cjs "$f"; then
    SUCCESS=$((SUCCESS + 1))
  else
    FAILED=$((FAILED + 1))
  fi
  echo ""
done

echo "Done: $SUCCESS ingested, $FAILED failed"
