/**
 * Standing test runner for the MDP suite (dependency-free — uses Node's built-in test runner).
 *
 * Why a script and not `node --test test/`?
 *   On this Windows + Node 24 setup, `node --test <dir>` tries to RUN the directory as a module,
 *   and a quoted glob of an absolute path (with spaces / parentheses in "…/Middleware Delivery
 *   Portal (MDP)/…") doesn't expand reliably. Driving the runner programmatically with an explicit
 *   file list avoids both problems and gives one portable command:
 *
 *       node run-tests.mjs
 *
 * Each *.test.mjs runs in its own process (isolation: 'process' is the default), so every file's
 * `useTempDb()` gets a clean throwaway SQLite DB and the real mdp.db / mdp-sample.db are untouched.
 */
import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import { readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testDir = join(__dirname, 'test');

const files = readdirSync(testDir)
  .filter((f) => f.endsWith('.test.mjs'))
  .map((f) => join(testDir, f))
  .sort();

let passed = 0;
let failed = 0;

const stream = run({ files, concurrency: false });
stream.on('test:pass', (e) => { if (!e.skip && !e.todo) passed += 1; });
stream.on('test:fail', () => { failed += 1; });
stream.compose(spec()).pipe(process.stdout);

stream.on('end', () => {
  // Explicit, ASCII-only summary so it survives terminals that mangle the reporter's tail.
  const line = `\n==== MDP test summary: ${passed} passed, ${failed} failed, across ${files.length} files ====\n`;
  process.stdout.write(line);
  // Also write the one-line summary to a sidecar file so it can be read even if the captured
  // stdout is truncated by a wrapping shell. (Harmless; overwritten each run.)
  try {
    writeFileSync(join(__dirname, '.last-test-summary.txt'), line.trim() + '\n');
  } catch { /* non-fatal */ }
  process.exitCode = failed > 0 ? 1 : 0;
});
