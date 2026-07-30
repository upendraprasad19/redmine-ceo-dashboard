#!/usr/bin/env node

/**
 * scripts/board.js
 * Task board management for .opencode/board/
 *
 * Usage:
 *   node scripts/board.js create "slug" "Description"
 *   node scripts/board.js start NNN
 *   node scripts/board.js done NNN "Summary"
 *   node scripts/board.js validate [--warn]
 *   node scripts/board.js sync
 *   node scripts/board.js next
 *   node scripts/board.js retro
 *   node scripts/board.js retro-mark
 */

const fs = require('node:fs')
const path = require('node:path')
const { countDoneSinceLastRetro } = require('../lib/board-utils.js')

const BOARD_DIR = path.resolve(__dirname, '..', '.opencode', 'board')
const INDEX_PATH = path.join(BOARD_DIR, 'INDEX.md')
const DIRS = ['backlog', 'active', 'done']

// --- Helpers ---

function sanitizeSlug(input) {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  if (!slug || slug.length > 60) {
    console.error(`Invalid slug: "${input}" → "${slug}"`)
    process.exit(1)
  }
  if (input.includes('..') || input.includes('/') || input.includes('\\')) {
    console.error(`Slug contains path traversal: "${input}"`)
    process.exit(1)
  }
  return slug
}

function getNextNumber() {
  let max = 0
  for (const dir of DIRS) {
    const dirPath = path.join(BOARD_DIR, dir)
    if (!fs.existsSync(dirPath)) continue
    for (const f of fs.readdirSync(dirPath)) {
      const m = f.match(/^(\d{3})-/)
      if (m) max = Math.max(max, parseInt(m[1], 10))
    }
  }
  return String(max + 1).padStart(3, '0')
}

function findFileByNumber(nnn) {
  const results = []
  for (const dir of DIRS) {
    const dirPath = path.join(BOARD_DIR, dir)
    if (!fs.existsSync(dirPath)) continue
    for (const f of fs.readdirSync(dirPath)) {
      if (f.startsWith(`${nnn}-`)) {
        results.push({ dir, file: f, full: path.join(dirPath, f) })
      }
    }
  }
  return results
}

function extractHeading(filePath) {
  const content = fs.readFileSync(filePath, 'utf8')
  const lines = content.split('\n')
  for (const line of lines) {
    if (line.startsWith('# ')) {
      let heading = line.slice(2).trim()
      // Strip leading "NNN — " or "NNN-" or "NNN:" if present
      heading = heading.replace(/^\d{3}\s*[—–:-]\s*/, '').trim()
      // Strip leading "Task NNN:" if present
      heading = heading.replace(/^Task\s+\d{3}\s*:\s*/, '').trim()
      return heading
    }
  }
  // Fallback: use filename without extension
  return path.basename(filePath, '.md').replace(/^\d{3}-/, '')
}

function dateStr() {
  return new Date().toISOString().slice(0, 10)
}

// --- Commands ---

function cmdCreate(slug, description) {
  const sanitized = sanitizeSlug(slug)
  const nnn = getNextNumber()
  const filename = `${nnn}-${sanitized}.md`
  const dirPath = path.join(BOARD_DIR, 'backlog')

  fs.mkdirSync(dirPath, { recursive: true })

  const content = `# ${nnn} — ${description}

**Status:** backlog
**Date:** ${dateStr()}

## What
Description.

## Changes
- Change 1

## Verification
- [ ] Check 1

## Files touched
- \`path/file.js\`
`

  fs.writeFileSync(path.join(dirPath, filename), content)
  console.log(`Created: backlog/${filename}`)
  cmdSync()
}

function cmdStart(nnn) {
  const matches = findFileByNumber(nnn)
  const inBacklog = matches.filter((m) => m.dir === 'backlog')
  if (inBacklog.length === 0) {
    console.error(`No backlog file found for ${nnn}`)
    process.exit(1)
  }
  if (inBacklog.length > 1) {
    console.error(
      `Multiple backlog files found for ${nnn}: ${inBacklog.map((m) => m.file).join(', ')}`,
    )
    process.exit(1)
  }

  const src = inBacklog[0].full
  const dst = path.join(BOARD_DIR, 'active', inBacklog[0].file)

  fs.mkdirSync(path.join(BOARD_DIR, 'active'), { recursive: true })
  fs.renameSync(src, dst)
  console.log(`Moved: backlog/${inBacklog[0].file} → active/${inBacklog[0].file}`)
  cmdSync()
}

function cmdDone(nnn, summary) {
  const matches = findFileByNumber(nnn)
  const inActive = matches.filter((m) => m.dir === 'active')
  if (inActive.length === 0) {
    console.error(`No active file found for ${nnn}`)
    process.exit(1)
  }
  if (inActive.length > 1) {
    console.error(
      `Multiple active files found for ${nnn}: ${inActive.map((m) => m.file).join(', ')}`,
    )
    process.exit(1)
  }

  const src = inActive[0].full
  const dstDir = path.join(BOARD_DIR, 'done')
  const dst = path.join(dstDir, inActive[0].file)

  fs.mkdirSync(dstDir, { recursive: true })

  let content = fs.readFileSync(src, 'utf8')
  // Update status line
  content = content.replace(/\*\*Status:\*\*\s*\w+/, '**Status:** done')
  // Append completion section
  content += `\n## Completion\n**Done:** ${dateStr()}\n\n${summary}\n`
  fs.writeFileSync(dst, content)
  fs.unlinkSync(src)

  console.log(`Moved: active/${inActive[0].file} → done/${inActive[0].file}`)

  // Plan-review record check
  const slug = inActive[0].file.replace(/\.md$/, '')
  const reviewPath = path.join(__dirname, '..', 'docs', 'reviews', `${slug}.md`)
  if (!fs.existsSync(reviewPath)) {
    console.warn(
      `  \u26a0\ufe0f  Review record missing: docs/reviews/${slug}.md (recommended for T2 tasks)`,
    )
  }

  cmdSync()

  const doneSinceRetro = countDoneSinceLastRetro(BOARD_DIR)
  if (doneSinceRetro >= 5) {
    console.error(`\n  ⚠️  RETRO DUE: ${doneSinceRetro} done tasks since last retro`)
    console.error('  Run: node scripts/board.js retro')
    console.error('  After retro: node scripts/board.js retro-mark\n')
  }

  // Self-learning batch check (ISO timestamp sentinel, every 3 tasks)
  const slSentinel = path.join(BOARD_DIR, '.last-selflearning')
  const doneDirPath = path.join(BOARD_DIR, 'done')
  const slCount = (() => {
    try {
      const ts = fs.readFileSync(slSentinel, 'utf8').trim()
      const cutoff = new Date(ts).getTime()
      return fs
        .readdirSync(doneDirPath)
        .filter((f) => f.endsWith('.md'))
        .filter((f) => fs.statSync(path.join(doneDirPath, f)).mtimeMs > cutoff).length
    } catch {
      return Infinity
    }
  })()
  if (slCount >= 3) {
    console.log('\n  MANDATORY: Run `skill self-learning` to capture patterns/gotchas')
    console.log('  Run: skill self-learning\n')
    fs.writeFileSync(slSentinel, new Date().toISOString())
  }
}

function cmdValidate(warnOnly) {
  const errors = []

  // Check board dir exists
  if (!fs.existsSync(BOARD_DIR)) {
    if (warnOnly) {
      console.log('Board directory does not exist — skipping.')
      return
    }
    console.error('Board directory does not exist.')
    process.exit(1)
  }

  // Collect all files on disk
  const filesOnDisk = new Map() // key: "dir/file" → true
  for (const dir of DIRS) {
    const dirPath = path.join(BOARD_DIR, dir)
    if (!fs.existsSync(dirPath)) continue
    for (const f of fs.readdirSync(dirPath)) {
      if (f.endsWith('.md')) {
        filesOnDisk.set(`${dir}/${f}`, true)
      }
    }
  }

  // Parse INDEX.md links
  if (!fs.existsSync(INDEX_PATH)) {
    if (warnOnly) {
      console.log('INDEX.md does not exist — run sync first.')
      return
    }
    console.error('INDEX.md does not exist.')
    process.exit(1)
  }

  const indexContent = fs.readFileSync(INDEX_PATH, 'utf8')
  const linkPattern = /\[.*?\]\(((?:active|backlog|done)\/.*?\.md)\)/g
  const linksInIndex = new Set()
  let match
  while ((match = linkPattern.exec(indexContent)) !== null) {
    linksInIndex.add(match[1])
  }

  // Check: every file on disk has an INDEX.md entry
  for (const key of filesOnDisk.keys()) {
    if (!linksInIndex.has(key)) {
      errors.push(`File on disk but missing from INDEX.md: ${key}`)
    }
  }

  // Check: every INDEX.md link has a file on disk
  for (const link of linksInIndex) {
    if (!filesOnDisk.has(link)) {
      errors.push(`INDEX.md links to missing file: ${link}`)
    }
  }

  // Check: no duplicate numbers across dirs
  const seen = new Map()
  for (const key of filesOnDisk.keys()) {
    const num = path.basename(key).match(/^(\d{3})-/)?.[1]
    if (num) {
      if (seen.has(num)) {
        errors.push(`Duplicate task number ${num}: ${seen.get(num)} and ${key}`)
      }
      seen.set(num, key)
    }
  }

  if (errors.length > 0) {
    console.error('Board validation errors:')
    for (const e of errors) console.error(`  - ${e}`)
    if (warnOnly) {
      console.log('Board INDEX.md may be stale (warnings only).')
      return
    }
    process.exit(1)
  }

  console.log('Board INDEX.md is in sync.')
}

function cmdSync() {
  fs.mkdirSync(BOARD_DIR, { recursive: true })
  for (const dir of DIRS) {
    fs.mkdirSync(path.join(BOARD_DIR, dir), { recursive: true })
  }

  const sections = {}
  for (const dir of DIRS) {
    const dirPath = path.join(BOARD_DIR, dir)
    const files = fs
      .readdirSync(dirPath)
      .filter((f) => f.endsWith('.md'))
      .sort()
    sections[dir] = files.map((f) => {
      const filePath = path.join(dirPath, f)
      const heading = extractHeading(filePath)
      const slug = f.replace(/\.md$/, '')
      const label = slug.replace(/^\d{3}-/, '')
      return `- [${label}](${dir}/${f}) — ${heading}`
    })
  }

  const lines = [
    '# Task Board — Redmine CEO Dashboard',
    '',
    '## Active',
    ...(sections.active.length > 0 ? sections.active : ['_No active tasks._']),
    '',
    '## Backlog',
    ...(sections.backlog.length > 0 ? sections.backlog : ['_No backlog tasks._']),
    '',
    '## Done',
    ...(sections.done.length > 0 ? sections.done : ['_No done tasks._']),
    '',
    '## Board protocol',
    '- **Creating a task**: `node scripts/board.js create "slug" "Description"`',
    '- **Starting a task**: `node scripts/board.js start NNN`',
    '- **Done**: `node scripts/board.js done NNN "Summary"`',
    '- **Validate**: `node scripts/board.js validate`',
    '- **Sync INDEX.md**: `node scripts/board.js sync`',
    '- **Retro**: `node scripts/board.js retro` / `retro-mark`',
    '',
  ]

  fs.writeFileSync(INDEX_PATH, lines.join('\n'))
  console.log('INDEX.md rebuilt.')
}

function cmdNext() {
  console.log(getNextNumber())
}

function cmdRetro() {
  const retroPath = path.join(BOARD_DIR, 'RETRO.md')
  if (!fs.existsSync(retroPath)) {
    console.error('RETRO.md not found at .opencode/board/RETRO.md')
    process.exit(1)
  }
  const content = fs.readFileSync(retroPath, 'utf8')
  console.log(content)
}

function cmdRetroMark() {
  const lastRetro = path.join(BOARD_DIR, '.last-retro')
  fs.writeFileSync(lastRetro, new Date().toISOString())
  console.log('Created: .opencode/board/.last-retro')
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2)
  const cmd = args[0]

  switch (cmd) {
    case 'create': {
      const slug = args[1]
      const desc = args[2]
      if (!slug || !desc) {
        console.error('Usage: node scripts/board.js create "slug" "Description"')
        process.exit(1)
      }
      cmdCreate(slug, desc)
      break
    }
    case 'start': {
      const nnn = args[1]
      if (!nnn) {
        console.error('Usage: node scripts/board.js start NNN')
        process.exit(1)
      }
      cmdStart(nnn)
      break
    }
    case 'done': {
      const nnn = args[1]
      const summary = args[2] || 'Completed.'
      if (!nnn) {
        console.error('Usage: node scripts/board.js done NNN "Summary"')
        process.exit(1)
      }
      cmdDone(nnn, summary)
      break
    }
    case 'validate': {
      const warnOnly = args.includes('--warn')
      cmdValidate(warnOnly)
      break
    }
    case 'sync':
      cmdSync()
      break
    case 'next':
      cmdNext()
      break
    case 'retro':
      cmdRetro()
      break
    case 'retro-mark':
      cmdRetroMark()
      break
    default:
      console.error('Commands: create, start, done, validate, sync, next, retro, retro-mark')
      console.error('  create "slug" "Description"')
      console.error('  start NNN')
      console.error('  done NNN "Summary"')
      console.error('  validate [--warn]')
      console.error('  sync')
      console.error('  next')
      console.error('  retro')
      console.error('  retro-mark')
      process.exit(1)
  }
}

main().catch((err) => {
  console.error('board.js failed:', err.message)
  process.exit(1)
})
