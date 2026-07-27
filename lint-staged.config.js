module.exports = {
  '*.{js,jsx,mjs,ts,tsx,mts,mdx}': ['biome check --write --no-errors-on-unmatched'],
  '*.{json,md,css,html,yml,yaml,scss}': ['biome check --write --no-errors-on-unmatched'],
}
