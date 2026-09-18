// --repo retargets every REMOTE lane at a fork.
//
// The native lanes (cline, opencode, openclaw, hermes) copy from the local
// clone and are unaffected. The remote ones take the slug as an argv token or
// interpolate it into a URL — `claude plugin marketplace add <slug>`,
// `gemini extensions install https://github.com/<slug>`, `npx skills add
// <slug>`, and the raw.githubusercontent hook downloads — so a fork can only
// be reached if all four move together, and the slug has to be validated
// before it becomes part of a spawned command line.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INSTALLER = path.join(path.resolve(HERE, '..', '..'), 'bin', 'install.js');
const FORK = 'someone/caveman-fork';

function run(args) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'caveman-repo-'));
  try {
    return spawnSync(process.execPath, [INSTALLER, ...args, '--non-interactive', '--no-mcp-shrink'], {
      env: { ...process.env, HOME: home, USERPROFILE: home, CLINE_DIR: path.join(home, '.cline'), NO_COLOR: '1' },
      encoding: 'utf8',
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test('--repo retargets the Claude Code marketplace and the Gemini extension URL', () => {
  const r = run(['--repo', FORK, '--only', 'claude', '--only', 'gemini', '--dry-run']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`marketplace add ${FORK}`), 'marketplace still points upstream');
  assert.match(r.stdout, new RegExp(`https://github\\.com/${FORK}`), 'gemini URL still points upstream');
  assert.doesNotMatch(r.stdout, /JuliusBrussee\/caveman/, 'an upstream reference survived --repo');
});

test('--repo=<slug> is accepted in the GNU form', () => {
  const r = run([`--repo=${FORK}`, '--only', 'claude', '--dry-run']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`marketplace add ${FORK}`));
});

test('--repo rejects anything that is not owner/name', () => {
  for (const bad of ['nope', 'a/b/c', 'owner/name; rm -rf /', '--only']) {
    const r = run(['--repo', bad, '--dry-run']);
    assert.equal(r.status, 2, `installer accepted ${JSON.stringify(bad)}`);
    assert.match(r.stderr, /--repo/, `no actionable error for ${JSON.stringify(bad)}`);
  }
});

test('without --repo the default upstream slug is used', () => {
  const r = run(['--only', 'claude', '--dry-run']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /marketplace add JuliusBrussee\/caveman/);
});
