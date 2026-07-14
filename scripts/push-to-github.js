/**
 * Push changes to GitHub via API (no git CLI needed)
 * Usage: node scripts/push-to-github.js
 */
import { config } from 'dotenv';
config({ path: process.cwd() + '/.env.local' });
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const TOKEN = process.env.GITHUB_TOKEN;
const REPO = 'upendraprasad19/redmine-ceo-dashboard';
const BRANCH = 'master';

const IGNORE_PATTERNS = [
  '.env.local', '.env', '.env.*', 'node_modules/', '.next/', '.vercel/', '.claude/',
  '.worktrees/', '*.log', '*.pdf', 'tmp/', 'tmp-*.js', '.vercel', 'appscript data.txt',
  '.gitignore', '.git/',
];

function shouldIgnore(filePath) {
  const parts = filePath.replace(/\\/g, '/').split('/');
  if (parts.some(p => p.startsWith('.'))) return true;
  for (const pattern of IGNORE_PATTERNS) {
    if (filePath.includes(pattern)) return true;
  }
  return false;
}

function walkDir(dir, baseDir = dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = relative(baseDir, full).replace(/\\/g, '/');
    if (shouldIgnore(rel)) continue;
    if (entry.isDirectory()) {
      files.push(...walkDir(full, baseDir));
    } else {
      files.push(rel);
    }
  }
  return files;
}

async function githubFetch(path, options = {}) {
  const url = `https://api.github.com/repos/${REPO}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'ceo-dashboard-push',
      ...options.headers,
    },
  });
  if (!res.ok && res.status !== 404) {
    const body = await res.text();
    throw new Error(`GitHub API error ${res.status}: ${body}`);
  }
  return res;
}

async function main() {
  try {
    // 1. Get latest commit SHA from master
    console.log('Fetching latest commit from master...');
    const refRes = await githubFetch(`/git/refs/heads/${BRANCH}`);
    if (!refRes.ok) {
      const body = await refRes.text();
      console.log('Response:', refRes.status, body);
      // Try to get default branch
      const repoRes = await githubFetch('');
      if (repoRes.ok) {
        const repo = await repoRes.json();
        console.log('Repo default branch:', repo.default_branch);
        console.log('Repo exists, but refs/heads/master not found. Maybe branch is different?');
      }
      return;
    }
    const ref = await refRes.json();
    const latestCommitSha = ref.object.sha;
    console.log(`Latest commit: ${latestCommitSha}`);

    // 2. Get the current tree SHA
    const commitRes = await githubFetch(`/git/commits/${latestCommitSha}`);
    const commit = await commitRes.json();
    const baseTreeSha = commit.tree.sha;
    console.log(`Base tree: ${baseTreeSha}`);

    // 3. Get all files to push
    const files = walkDir(process.cwd());
    console.log(`\nFiles to push: ${files.length}`);
    files.forEach(f => console.log(`  ${f}`));

    // 4. Create blobs for each file
    const treeEntries = [];
    for (const file of files) {
      const content = readFileSync(join(process.cwd(), file));
      const blobRes = await githubFetch('/git/blobs', {
        method: 'POST',
        body: JSON.stringify({ content: content.toString('base64'), encoding: 'base64' }),
      });
      const blob = await blobRes.json();
      treeEntries.push({
        path: file,
        mode: '100644',
        type: 'blob',
        sha: blob.sha,
      });
      console.log(`  Created blob for ${file}: ${blob.sha.slice(0, 7)}`);
    }

    // 5. Create a new tree
    const treeRes = await githubFetch('/git/trees', {
      method: 'POST',
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: treeEntries,
      }),
    });
    const newTree = await treeRes.json();
    console.log(`\nNew tree: ${newTree.sha}`);

    // 6. Create a commit
    const commitRes2 = await githubFetch('/git/commits', {
      method: 'POST',
      body: JSON.stringify({
        message: 'fix: add Delivery Owner sync, project filtering, and backfill to /api/sync',
        tree: newTree.sha,
        parents: [latestCommitSha],
      }),
    });
    const newCommit = await commitRes2.json();
    console.log(`New commit: ${newCommit.sha}`);

    // 7. Update the ref
    const updateRes = await githubFetch(`/git/refs/heads/${BRANCH}`, {
      method: 'PATCH',
      body: JSON.stringify({
        sha: newCommit.sha,
        force: false,
      }),
    });
    const update = await updateRes.json();
    console.log(`\n✅ Branch updated: ${update.ref} → ${update.object.sha}`);

  } catch (err) {
    console.error('\n❌ Failed:', err.message);
    console.error(err.stack);
  }
}

main();