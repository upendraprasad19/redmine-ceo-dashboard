# Gates that ban words catch their own documentation

When a pre-commit gate bans a word/phrase (e.g., "defer"), the documentation describing the gate will contain that word and trigger false positives.

**Example:** deferral-euphemism gate caught `.opencode/AGENTS.md` line "Pre-commit runs deferral-euphemism gate" and vault pattern "Pre-commit/pre-push gate system (deferral gate...)".

**Fix:** Add an EXCLUDE regex that matches self-referential context:
```javascript
const EXCLUDE = /gate|check-no-deferral|deferral-euphemism|deferral gate/i
```

**Pattern:** For any new gate that bans a term, add exclusion for lines that describe the gate itself (contain "gate", the script name, or the feature name).

**Source:** Task 025 — deferral gate false positive on first commit.
