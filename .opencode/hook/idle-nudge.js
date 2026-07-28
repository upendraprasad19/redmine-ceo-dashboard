/**
 * .opencode/hook/idle-nudge.js
 * Fired by opencode-yaml-hooks on session.idle (Stop).
 * Non-blocking: always exits 0. Nudges only when git has uncommitted changes.
 */

const fs = require('node:fs')
const path = require('node:path')
const { execSync } = require('child_process')

const BOARD_DIR = path.join(__dirname, '..', 'board')
const VAULT_INDEX = path.join(__dirname, '..', '..', 'vault', 'INDEX.md')
const DONE_DIR = path.join(BOARD_DIR, 'done')

function vaultDaysOld() {
  try {
    const stat = fs.statSync(VAULT_INDEX)
    const ageMs = Date.now() - stat.mtimeMs
    return Math.floor(ageMs / 864e5)
  } catch (_) {
    return null
  }
}

function doneTasksSinceVaultUpdate() {
  const vaultMtime = vaultDaysOld()
  if (vaultMtime === null) return 0
  const vaultCutoff = Date.now() - vaultMtime * 864e5
  try {
    if (!fs.existsSync(DONE_DIR)) return 0
    return fs.readdirSync(DONE_DIR)
      .filter(f => f.endsWith('.md'))
      .map(f => path.join(DONE_DIR, f))
      .filter(f => {
        try { return fs.statSync(f).mtimeMs > vaultCutoff } catch (_) { return false }
      }).length
  } catch (_) {
    return 0
  }
}

function runIdleNudge() {
  // ── Board sync + validate (when git is dirty) ──────────
  try {
    const status = execSync('git status --porcelain', { encoding: 'utf8' }).trim()
    if (status.length > 0) {
      try { execSync('node scripts/board.js sync', { encoding: 'utf8', stdio: 'pipe' }) } catch (_) {}
      try { execSync('node scripts/board.js validate', { encoding: 'utf8', stdio: 'pipe' }) } catch (_) {
        console.log('Board INDEX.md may be stale.')
      }
    }
  } catch (err) {
    console.log('idle-nudge: skipped (git not available).')
  }

  // ── Vault stale check ────────────────────────────────────
  const days = vaultDaysOld()
  if (days !== null && days > 7) {
    console.log(`VAULT STALE: .opencode/vault/INDEX.md last updated ${days} days ago`)
  }

  // ── Self-learning reminder ───────────────────────────────
  const doneSince = doneTasksSinceVaultUpdate()
  if (doneSince >= 5) {
    console.log(`SELF-LEARNING DUE: ${doneSince} done tasks since last vault update — run skill self-learning`)
  }
}

runIdleNudge()
process.exit(0)
