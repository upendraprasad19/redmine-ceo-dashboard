# Retro enforcement via shared helper

**Type:** pattern
**Date:** 2026-07-30
**Related:** [[default-sort-indicator-mismatch]], [[discipline-gates]]
**Tags:** #discipline #process #automation

## What
Retro triggers (every 5 done tasks) are enforced by a shared `countDoneSinceLastRetro()` helper in `lib/board-utils.js`. Both `scripts/board.js` (per-task CLI warning) and `.opencode/hook/idle-nudge.js` (session-idle reminder) use the same function, preventing logic drift.

## How it works
- **Sentinel file**: `.opencode/board/.last-retro` — contains ISO timestamp of last retro
- **Missing sentinel**: counts ALL done tasks (correct for first retro)
- **`board.js done`**: Warns via `console.error` when ≥5 tasks done since retro (non-blocking)
- **`board.js retro`**: Prints RETRO.md content for reference
- **`board.js retro-mark`**: Creates/updates sentinel file

## Why shared helper
Previously `idle-nudge.js` used `retroDoneSinceVaultUpdate()` (wrong metric — compared `.last-retro` mtime to vault mtime). `board.js done` had no retro check at all. Extracting to `lib/board-utils.js` ensures both consumers use the same logic.

## Lesson
When two scripts need the same file-system check, extract to a shared `lib/` module (CJS for `lib/`, `scripts/`, `.opencode/hook/`). Don't duplicate logic — it drifts.
