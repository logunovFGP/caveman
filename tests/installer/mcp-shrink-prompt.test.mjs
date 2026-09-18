// caveman-shrink is now asked for, not discovered in --help.
//
// The dangerous failure mode is the one this suite pins: a question asked on a
// pipe. `curl … | bash` hands the script itself to stdin, so a readline prompt
// there waits forever on an answer nobody can type — the install hangs with no
// visible cause. Every non-TTY path must therefore keep the old silent default.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const INSTALLER = path.join(REPO_ROOT, 'bin', 'install.js');
const QUESTION = /Register caveman-shrink\?/;

function run(args, { input = '' } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'caveman-mcpq-'));
  try {
    return spawnSync(process.execPath, [INSTALLER, ...args], {
      // stdin is a pipe here, exactly like curl|bash.
      input,
      timeout: 60_000,
      env: { ...process.env, HOME: home, USERPROFILE: home, CLINE_DIR: path.join(home, '.cline'), NO_COLOR: '1' },
      encoding: 'utf8',
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test('a piped stdin is never asked the question', () => {
  const r = run(['--only', 'cline', '--dry-run', '--non-interactive']);
  assert.equal(r.signal, null, 'installer was killed — it hung waiting for an answer');
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, QUESTION);
  assert.doesNotMatch(r.stdout, /caveman-shrink/, 'shrink was registered without being asked');
});

test('--non-interactive keeps the old silent default', () => {
  const r = run(['--only', 'claude', '--dry-run', '--non-interactive']);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, QUESTION);
});

test('--no-mcp-shrink answers up front', () => {
  const r = run(['--only', 'cline', '--dry-run', '--no-mcp-shrink']);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, QUESTION);
  assert.doesNotMatch(r.stdout, /would run: cline mcp add/);
});

test('--with-mcp-shrink still registers without a question', () => {
  const r = run(['--only', 'cline', '--dry-run', '--with-mcp-shrink=npx -y upstream-server /tmp']);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, QUESTION);
  assert.match(r.stdout, /would run: cline mcp add caveman-shrink .*upstream-server \/tmp/);
});

// --dry-run prints a plan; a plan that asks a question is not a plan.
test('--dry-run never prompts', () => {
  const r = run(['--only', 'claude', '--only', 'cline', '--dry-run']);
  assert.equal(r.signal, null, 'dry run hung on a prompt');
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, QUESTION);
});

// NOT covered here: the prompt answered on a real terminal, and a prompt that
// reaches EOF before an answer arrives. Both need a pty, and script(1) does not
// survive spawnSync on macOS (exits 1, no stdout), so a test for them would be
// platform-flaky rather than useful. askOnce() in bin/install.js carries the
// reasoning; the EOF path was verified by hand under script(1): declining
// installs all 23 owned paths and registers nothing, accepting runs
// `cline mcp add caveman-shrink --yes --transport stdio -- npx -y caveman-shrink <upstream>`.
