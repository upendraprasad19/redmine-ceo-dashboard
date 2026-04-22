// Company domain is "thinkingcode.com" (no hyphen). Redmine stores the old
// "thinking-code.com" form (including subdomain variants like
// "mail.thinking-code.com") — normalize at every boundary (sync + send) so
// wrong addresses can't come back.
function normalizeEmail(email) {
  if (!email) return null;
  return email.trim().toLowerCase().replace(/thinking-code\.com/g, 'thinkingcode.com');
}

module.exports = { normalizeEmail };
