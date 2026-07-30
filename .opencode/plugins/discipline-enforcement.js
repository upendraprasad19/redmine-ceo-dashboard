/**
 * .opencode/plugins/discipline-enforcement.js
 *
 * Machine-enforced discipline gates via opencode plugin.
 * Implements:
 *   Gate 1: Session-start gate (blocks tools until bootstrap runs)
 *   Gate 2: Plan-first gate (blocks code edits until plan exists)
 *
 * Audit: logs blocked actions to .opencode/.blocked-actions.log
 * Error handling: fail-open (gate errors allow execution, logged to stderr)
 */

import fs from "node:fs"
import path from "node:path"

const SENTINEL = ".opencode/.bootstrap-done"
const AUDIT_LOG = ".opencode/.blocked-actions.log"
const ACTIVE_DIR = ".opencode/board/active"

const CODE_EXTENSIONS = new Set([".js", ".ts", ".jsx", ".tsx"])
const CODE_DIRS = ["pages", "lib", "components", "scripts", "bots", "crons", "tests"]
const T0_PATTERNS = [/\.env/, /\.md$/, /\.json$/, /\.yml$/, /\.yaml$/]

function sentinelPath(directory) {
  return path.join(directory, SENTINEL)
}

function auditPath(directory) {
  return path.join(directory, AUDIT_LOG)
}

function logBlocked(directory, gate, tool, target) {
  const line = `${new Date().toISOString()} | ${gate} | ${tool} | ${target || "(none)"}\n`
  try {
    fs.appendFileSync(auditPath(directory), line)
  } catch {
    // silent
  }
}

function checkSentinelFresh(directory) {
  try {
    const content = fs.readFileSync(sentinelPath(directory), "utf8").trim()
    const written = new Date(content)
    const now = Date.now() - written.getTime()
    return now < 24 * 60 * 60 * 1000 // within 24 hours
  } catch {
    return false
  }
}

function hasActiveTaskWithPlan(directory) {
  try {
    const activeDir = path.join(directory, ACTIVE_DIR)
    if (!fs.existsSync(activeDir)) return false
    const files = fs.readdirSync(activeDir).filter((f) => f.endsWith(".md"))
    if (files.length === 0) return false
    return files.some((f) => {
      const content = fs.readFileSync(path.join(activeDir, f), "utf8")
      return /##\s*(Plan|What|Files|Why)/i.test(content)
    })
  } catch {
    return false
  }
}

function isCodeFile(filePath, directory) {
  const ext = path.extname(filePath)
  if (!CODE_EXTENSIONS.has(ext)) return false
  const relative = path.relative(directory, filePath)
  return CODE_DIRS.some((d) => relative.startsWith(d + path.sep))
}

function isT0File(filePath) {
  return T0_PATTERNS.some((p) => p.test(filePath))
}

function isTaskFile(filePath, directory) {
  const relative = path.relative(directory, filePath)
  return relative.startsWith(path.join(ACTIVE_DIR) + path.sep) && relative.endsWith(".md")
}

function isBootstrapScript(filePath, directory) {
  const relative = path.relative(directory, filePath)
  return relative === "scripts" + path.sep + "session-bootstrap.js"
}

export const DisciplineEnforcement = async ({ project, client, $, directory, worktree }) => {
  const state = {
    bootstrapComplete: false,
    editedFiles: new Set(),
  }

  return {
    "session.created": async () => {
      state.bootstrapComplete = false
      state.editedFiles.clear()
    },

    "tool.execute.before": async (input, output) => {
      try {
        // Gate 1: Session-start gate — block until bootstrap sentinel exists and is fresh
        if (!state.bootstrapComplete && !checkSentinelFresh(directory)) {
          if (input.tool === "bash") {
            const cmd = output.args?.command || ""
            if (/bootstrap/.test(cmd)) {
              state.bootstrapComplete = true
              return
            }
          }
          if (["edit", "write", "bash"].includes(input.tool)) {
            const target = output.args?.filePath || output.args?.command?.slice(0, 60) || ""
            logBlocked(directory, "session-start", input.tool, target)
            throw new Error(
              "DISCIPLINE GATE: Run `npm run bootstrap` first to initialize session."
            )
          }
        }

        // Gate 2: Plan-first gate — block code edits without active task + plan
        if (["edit", "write"].includes(input.tool)) {
          const filePath = output.args?.filePath || ""
          if (filePath && isCodeFile(filePath, directory) && !isT0File(filePath)) {
            // Allow editing task files and bootstrap script
            if (isTaskFile(filePath, directory) || isBootstrapScript(filePath, directory)) {
              return
            }
            if (!hasActiveTaskWithPlan(directory)) {
              logBlocked(directory, "plan-first", input.tool, filePath)
              throw new Error(
                "DISCIPLINE GATE: No active task with plan. Create a task file in board/active/ with a ## Plan section first."
              )
            }
          }
        }
      } catch (err) {
        if (err.message.startsWith("DISCIPLINE GATE")) {
          throw err
        }
        console.error(`DISCIPLINE WARN: Gate error: ${err.message}`)
        // fail-open: allow the tool to execute
      }
    },

    "tool.execute.after": async (input, output) => {
      // After bash runs bootstrap, check if sentinel was created
      if (input.tool === "bash" && !state.bootstrapComplete) {
        const cmd = output.args?.command || ""
        if (/bootstrap/.test(cmd)) {
          if (checkSentinelFresh(directory)) {
            state.bootstrapComplete = true
          }
        }
      }
    },
  }
}

export function getDisciplineState(directory) {
  const bootstrapFresh = checkSentinelFresh(directory)
  let activeTasks = []
  let blockedCount = 0

  try {
    const activeDir = path.join(directory, ACTIVE_DIR)
    if (fs.existsSync(activeDir)) {
      activeTasks = fs.readdirSync(activeDir).filter((f) => f.endsWith(".md"))
    }
  } catch {
    // silent
  }

  try {
    const logContent = fs.readFileSync(auditPath(directory), "utf8")
    blockedCount = logContent.trim().split("\n").filter(Boolean).length
  } catch {
    // no log yet
  }

  return {
    bootstrapComplete: bootstrapFresh,
    activeTasks,
    blockedCount,
  }
}
