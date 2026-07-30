import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const { countDoneSinceLastRetro } = require('../../lib/board-utils.js')

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'board-utils-test-'))
}

function cleanupDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true })
}

function touchFile(filePath) {
  fs.writeFileSync(filePath, `# ${path.basename(filePath)}\n`)
}

describe('countDoneSinceLastRetro', () => {
  it('returns 0 when done dir does not exist', () => {
    const dir = makeTmpDir()
    try {
      const boardDir = path.join(dir, 'board')
      expect(countDoneSinceLastRetro(boardDir)).toBe(0)
    } finally {
      cleanupDir(dir)
    }
  })

  it('returns 0 when done dir is empty', () => {
    const dir = makeTmpDir()
    try {
      const doneDir = path.join(dir, 'done')
      fs.mkdirSync(doneDir, { recursive: true })
      expect(countDoneSinceLastRetro(dir)).toBe(0)
    } finally {
      cleanupDir(dir)
    }
  })

  it('counts all done tasks when no sentinel exists', () => {
    const dir = makeTmpDir()
    try {
      const doneDir = path.join(dir, 'done')
      fs.mkdirSync(doneDir, { recursive: true })
      touchFile(path.join(doneDir, '001-task-a.md'))
      touchFile(path.join(doneDir, '002-task-b.md'))
      touchFile(path.join(doneDir, '003-task-c.md'))
      expect(countDoneSinceLastRetro(dir)).toBe(3)
    } finally {
      cleanupDir(dir)
    }
  })

  it('counts only tasks after sentinel timestamp', () => {
    const dir = makeTmpDir()
    try {
      const doneDir = path.join(dir, 'done')
      fs.mkdirSync(doneDir, { recursive: true })
      touchFile(path.join(doneDir, '001-old-task.md'))
      // Set old task mtime well in the past
      const past = new Date(Date.now() - 10000)
      fs.utimesSync(path.join(doneDir, '001-old-task.md'), past, past)
      // Write sentinel with timestamp now
      const sentinel = path.join(dir, '.last-retro')
      const sentinelTime = new Date()
      fs.writeFileSync(sentinel, sentinelTime.toISOString())
      // Add new task after sentinel
      touchFile(path.join(doneDir, '002-new-task.md'))
      expect(countDoneSinceLastRetro(dir)).toBe(1)
    } finally {
      cleanupDir(dir)
    }
  })

  it('ignores non-md files in done dir', () => {
    const dir = makeTmpDir()
    try {
      const doneDir = path.join(dir, 'done')
      fs.mkdirSync(doneDir, { recursive: true })
      touchFile(path.join(doneDir, '001-real-task.md'))
      fs.writeFileSync(path.join(doneDir, '.gitkeep'), '')
      fs.writeFileSync(path.join(doneDir, 'notes.txt'), 'not a task')
      expect(countDoneSinceLastRetro(dir)).toBe(1)
    } finally {
      cleanupDir(dir)
    }
  })

  it('handles sentinel file with ISO timestamp content', () => {
    const dir = makeTmpDir()
    try {
      const doneDir = path.join(dir, 'done')
      fs.mkdirSync(doneDir, { recursive: true })
      touchFile(path.join(doneDir, '001-task.md'))
      // Set task mtime in the past
      const past = new Date(Date.now() - 10000)
      fs.utimesSync(path.join(doneDir, '001-task.md'), past, past)
      // Sentinel with ISO content parsed as cutoff
      const sentinel = path.join(dir, '.last-retro')
      fs.writeFileSync(sentinel, past.toISOString())
      // Task mtime equals sentinel cutoff — not strictly greater, so 0
      expect(countDoneSinceLastRetro(dir)).toBe(0)
    } finally {
      cleanupDir(dir)
    }
  })
})
