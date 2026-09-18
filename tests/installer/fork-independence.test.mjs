// This repo is a self-sustaining fork: nothing in the install path may reach
// upstream unless the user asks for it with --repo.
//
// Four separate places hardcode a slug — the installer, the native-skills
// lane, and the two curl|bash shims — and they drifted apart once already
// (bin/lib/provider-skills.js kept pulling JuliusBrussee/caveman while
// --repo retargeted everything else). The behavioural check below is the one
// that matters; the static checks name the file to edit when it fails.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FORK = 'logunovFGP/caveman';
const UPSTREAM = 'JuliusBrussee/caveman';

function read(rel) {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

test('every hardcoded install slug is this fork', () => {
  const pinned = [
    ['bin/install.js', `let REPO = '${FORK}';`],
    ['bin/lib/provider-skills.js', `const DEFAULT_REPO = '${FORK}';`],
    ['install.sh', `REPO="${FORK}"`],
    ['install.ps1', `$Repo = "${FORK}"`],
  ];
  for (const [file, needle] of pinned) {
    assert.ok(read(file).includes(needle), `${file} does not pin ${FORK}`);
  }
});

test('the package and plugin manifests point at the fork', () => {
  for (const file of ['package.json', '.claude-plugin/marketplace.json', '.claude-plugin/plugin.json']) {
    assert.doesNotMatch(read(file), /JuliusBrussee/, `${file} still points upstream`);
  }
});

test('a default install run names upstream nowhere', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'caveman-fork-'));
  try {
    const r = spawnSync(process.execPath, [
      path.join(REPO_ROOT, 'bin', 'install.js'),
      '--dry-run', '--non-interactive', '--no-mcp-shrink',
      '--only', 'claude', '--only', 'gemini', '--only', 'codex',
    ], {
      env: { ...process.env, HOME: home, USERPROFILE: home, NO_COLOR: '1' },
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /JuliusBrussee/, 'an upstream reference is still in the install path');
    assert.match(r.stdout, new RegExp(FORK));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('upstream is still reachable on request', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'caveman-fork-up-'));
  try {
    const r = spawnSync(process.execPath, [
      path.join(REPO_ROOT, 'bin', 'install.js'),
      '--repo', UPSTREAM, '--dry-run', '--non-interactive', '--no-mcp-shrink', '--only', 'claude',
    ], {
      env: { ...process.env, HOME: home, USERPROFILE: home, NO_COLOR: '1' },
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`marketplace add ${UPSTREAM}`));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// The hook downloads and the checksum manifest are fetched from
// <slug>/<PINNED_REF>. A ref that only exists upstream would quietly reintroduce
// the dependency this fork removes, so it must be a tag this fork cut itself.
test('the pinned ref is a fork-owned tag', () => {
  const m = read('bin/install.js').match(/const PINNED_REF = process\.env\.CAVEMAN_REF \|\| '([^']+)'/);
  assert.ok(m, 'PINNED_REF is no longer a literal default');
  assert.match(m[1], /-fork\.\d+$/, `PINNED_REF ${m[1]} is not a fork tag`);
});
