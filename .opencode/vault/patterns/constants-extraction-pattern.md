---
created: 2026-07-30
tags: [patterns, constants, deduplication]
related: [[sync-status-map-duplication], [constant-drift-12-files]]
---

# constants-extraction-pattern

## Summary
Extract duplicated constants (STATUS_MAP, PRIORITY_MAP, EXPECTED_TIME_TEAMS, APPROVED_PROJECT_IDS) to `lib/constants.js` as single source of truth.

## Pattern
1. Create `lib/constants.js` with CommonJS exports
2. Import in CJS files: `const { STATUS_MAP } = require('../lib/constants')`
3. Import in ESM files: `import constants from '../lib/constants.js'; const { STATUS_MAP } = constants`
4. Update gate script to check all consumer files
5. Gate script must handle both array and Set definitions

## Gate script update
The `check-approved-projects-sync.js` gate was updated to:
- Check 12 files (was 4)
- Handle `new Set([...])` syntax (not just `[...]`)
- Follow imports to `lib/constants.js` when local definition not found

## Verification
- All 140 unit tests pass
- Gate script detects all 12 files
- No drift between files

## Related
- [[sync-status-map-duplication]]
- [[constant-drift-12-files]]
