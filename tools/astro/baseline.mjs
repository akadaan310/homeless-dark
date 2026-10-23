// Stage 0 baseline / after manifest: refs, SHA-256 of governing docs and key sources, test command results.
// node tools/astro/baseline.mjs <out.json> [label]
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
const [out, label = 'baseline'] = process.argv.slice(2);
const sh = (c, cwd = '.') => { try { return execSync(c, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); } catch (e) { return `ERROR: ${e.message.split('\n')[0]}`; } };
const sha = (f) => fs.existsSync(f) ? createHash('sha256').update(fs.readFileSync(f)).digest('hex') : null;
const files = ['HOMELESS_DARK_WEB_CONSTITUTION.md', 'HOMELESS_DARK_ASTRO_UI_CONSTITUTION_V4.md', 'HOMELESS_DARK_STANDALONE_CONSTITUTION.md', 'CURRENT_STATE_AND_CONTINUATION.md', 'docs/checkpoint.md', 'docs/renderer-migration.md', 'university-source.lock.json', 'assets/web-selection.lock.json', 'package-lock.json'];
const homeless = '/home/user/akadaan310/homeless.git';
const manifest = {
  schema: 'astro.baseline/1', label, at: new Date().toISOString(),
  repo: { head: sh('git rev-parse HEAD'), branch: sh('git rev-parse --abbrev-ref HEAD'), status: sh('git status --porcelain') || 'clean',
    refs: sh("git for-each-ref --format='%(refname) %(objectname)'").split('\n'), worktrees: sh('git worktree list').split('\n') },
  crossRepo: fs.existsSync(homeless) ? {
    repo: 'akadaan310/HOMELESS (read-only blobless clone)', refs: sh("git for-each-ref --format='%(refname) %(objectname) %(subject)'", homeless).split('\n'),
    oneShotVsMain: sh('git rev-list --left-right --count main...codex/one-shot-implementation', homeless),
  } : 'not inspected',
  files: Object.fromEntries(files.map((f) => [f, sha(f)])),
  tests: { vitest: sh('npx vitest run 2>&1 | grep -E "Tests|Test Files"') },
};
fs.writeFileSync(out, JSON.stringify(manifest, null, 1) + '\n');
console.log(out, manifest.repo.head, manifest.tests.vitest);
