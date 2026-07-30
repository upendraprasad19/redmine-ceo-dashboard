#!/bin/bash
# audit-gates.sh — Run all audit gate scripts
# Usage: bash scripts/audit-gates.sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

echo "=== Audit Gates ==="
echo ""

GATES=(
  "check-api-auth-required"
  "check-email-normalization"
  "check-engineering-filter"
  "check-approved-projects-sync"
  "check-error-sanitization"
  "check-audit-readers-writers"
  "check-module-system"
  "check-regression-tests"
  "check-constant-drift"
  "check-secrets-not-committed"
)

PASSED=0
FAILED=0

for gate in "${GATES[@]}"; do
  if node "scripts/${gate}.js" 2>/dev/null; then
    PASSED=$((PASSED + 1))
  else
    FAILED=$((FAILED + 1))
  fi
done

echo ""
echo "=== Results: ${PASSED} passed, ${FAILED} failed ==="

if [ $FAILED -gt 0 ]; then
  exit 1
fi
