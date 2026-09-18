// caveman-shrink is asked for, not discovered in --help.
//
// The question goes to the CONTROLLING TERMINAL, not to stdin: `curl … | bash`
// hands the script itself to stdin, so gating on process.stdin.isTTY made the
// headline install command silently skip every prompt. openTerminal() opens
// /dev/tty instead, the way rustup and nvm do.
//
// What this suite pins is the other half — the runs that must never be asked,
// because nobody is there to answer and a readline prompt would hang with no
// visible cause: no controlling terminal at all (CI, cron, a detached
// container), and every flag that already states an answer. The spawns below
// inherit no tty from the runner, which is what makes them stand in for the
// first case. The curl|bash path itself needs a pty to exercise and is
// verified by hand — script(1) does not survive spawnSync on macOS.

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
  // CI=1 is belt and braces: a developer running this suite from a terminal has
  // a controlling tty that the spawned installer could otherwise open.
  try {
    return spawnSync(process.execPath, [INSTALLER, ...args], {
      // stdin is a pipe here, exactly like curl|bash.
      input,
      timeout: 60_000,
      env: { ...process.env, CI: '1', HOME: home, USERPROFILE: home, CLINE_DIR: path.join(home, '.cline'), CLINE_DOCUMENTS_DIR: path.join(home, 'Documents', 'Cline'), NO_COLOR: '1' },
      encoding: 'utf8',
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test('a run with no controlling terminal is never asked the question', () => {
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

// The installer must not gate its prompts on stdin being a terminal again:
// under the headline install command stdin is the script, and that gate is what
// made `curl … | bash` skip every question.
test('prompts read the controlling terminal, not stdin', () => {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'bin', 'install.js'), 'utf8');
  assert.match(source, /function openTerminal\(/, 'the terminal helper is gone');
  assert.match(source, /'\/dev\/tty'/, 'no controlling-terminal device is opened');
  const prompts = source.slice(source.indexOf('async function promptForOnly'));
  assert.doesNotMatch(
    prompts.slice(0, prompts.indexOf('// ── --list')),
    /if \(!process\.stdin\.isTTY/,
    'a prompt went back to gating on stdin.isTTY — curl | bash would skip it',
  );
});

// NOT covered here: the prompt answered on a real terminal, whether through a
// tty or through /dev/tty with stdin piped. Both need a pty, and script(1) does
// not survive spawnSync on macOS (exits 1, no stdout), so a test would be
// platform-flaky rather than useful. Verified by hand in the curl|bash shape
// (`printf "" | node bin/install.js --only cline` under script(1)): the
// question appears, answering y plus an upstream command runs
// `cline mcp add caveman-shrink --yes --transport stdio -- npx -y caveman-shrink <upstream>`,
// and declining installs all 23 owned paths and registers nothing.
