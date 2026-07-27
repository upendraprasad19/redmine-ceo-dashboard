function send500(res, err, context) {
  if (context) {
    console.error(`[API] ${context}:`, err)
  } else {
    console.error('[API] Error:', err)
  }
  return res.status(500).json({ error: 'Internal server error' })
}

module.exports = { send500 }
