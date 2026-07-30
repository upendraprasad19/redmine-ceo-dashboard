const fs = require('node:fs')
const path = require('node:path')

function countDoneSinceLastRetro(boardDir) {
  const sentinel = path.join(boardDir, '.last-retro')
  const doneDir = path.join(boardDir, 'done')
  if (!fs.existsSync(doneDir)) return 0

  let cutoffMs = 0 // no sentinel = count everything
  if (fs.existsSync(sentinel)) {
    try {
      const content = fs.readFileSync(sentinel, 'utf8').trim()
      const parsed = new Date(content)
      if (!isNaN(parsed.getTime())) {
        cutoffMs = parsed.getTime()
      } else {
        cutoffMs = fs.statSync(sentinel).mtimeMs
      }
    } catch (_) {
      cutoffMs = fs.statSync(sentinel).mtimeMs
    }
  }

  return fs
    .readdirSync(doneDir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => path.join(doneDir, f))
    .filter((f) => {
      try {
        return fs.statSync(f).mtimeMs > cutoffMs
      } catch (_) {
        return false
      }
    }).length
}

module.exports = { countDoneSinceLastRetro }
