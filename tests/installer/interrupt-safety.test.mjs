// Two failure modes that used to abort a whole install run.
//
// 1. A native-lane installer that throws instead of returning a failure record
//    escaped main() and killed every provider below it in PROVIDERS order. A
//    symlinked ~/.openclaw/workspace/skills (dotfile manager, Syncthing, bind
//    mount) is the real-world trigger: openclaw sits 4th of ~40 providers, so
//    cline/cursor/windsurf/codex/copilot were all silently skipped.
// 2. A ^C during a scratch-dir lifetime left the directory behind under
//    ~/.caveman/tmp, because the signal killed the process with the cleanup
//    `finally` still pending.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const INSTALLER = path.join(REPO_ROOT, 'bin', 'install.js');
const POSIX_ONLY = { skip: process.platform === 'win32' ? 'POSIX-only sandbox' : false };

function sandbox(tag) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `caveman-${tag}-`));
  return { home, env: { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: path.join(home, '.claude') } };
}

test('a provider that throws does not abort the providers below it', POSIX_ONLY, () => {
  const { home, env } = sandbox('interrupt-isolation');
  // openclaw refuses to write through a symlinked skills dir — by design.
  fs.mkdirSync(path.join(home, '.openclaw', 'workspace'), { recursive: true });
  fs.mkdirSync(path.join(home, 'elsewhere'));
  fs.symlinkSync(path.join(home, 'elsewhere'), path.join(home, '.openclaw', 'workspace', 'skills'));

  // hermes is declared after openclaw, writes only under $HOME, and needs no network.
  const r = spawnSync(process.execPath,
    [INSTALLER, '--only', 'openclaw', '--only', 'hermes', '--non-interactive'],
    { env, encoding: 'utf8' });
  const out = `${r.stdout || ''}${r.stderr || ''}`;

  assert.doesNotMatch(out, /at ensureRealDirectory/, 'the throw escaped as an unhandled stack trace');
  assert.match(out, /openclaw install failed: .*refusing non-directory or symlink/);
  assert.match(out, /🪨 done/, 'the run never reached its summary');
  assert.ok(fs.existsSync(path.join(home, '.hermes', 'skills')),
    'a provider declared after the failing one was skipped');
});

test('SIGINT exits 130 and leaves no scratch directory behind', POSIX_ONLY, async () => {
  const { home, env } = sandbox('interrupt-signal');
  // Fake gemini: advertises --skip-trust (so the installer takes the scratch-dir
  // branch), then blocks long enough for the test to interrupt the installer.
  const binDir = path.join(home, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const stub = path.join(binDir, 'gemini');
  fs.writeFileSync(stub, '#!/bin/sh\ncase "$1" in --help) echo "--skip-trust"; exit 0;; esac\nsleep 1\n', { mode: 0o755 });

  const child = spawn(process.execPath, [INSTALLER, '--only', 'gemini', '--non-interactive'],
    { env: { ...env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` } });
  let stdout = '', stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });

  // Interrupt once the scratch directory exists.
  await new Promise((resolve) => {
    const timer = setInterval(() => {
      if (/GEMINI_CLI_TRUST_WORKSPACE/.test(stdout)) { clearInterval(timer); resolve(); }
    }, 25);
  });
  child.kill('SIGINT');
  const [code, signal] = await new Promise((resolve) => child.on('exit', (c, s) => resolve([c, s])));

  assert.equal(signal, null, 'the installer died from the raw signal instead of handling it');
  assert.equal(code, 130, 'SIGINT must exit 128+2');
  assert.match(stderr, /interrupted \(SIGINT\)/);
  const scratchParent = path.join(home, '.caveman', 'tmp');
  const leftovers = fs.existsSync(scratchParent)
    ? fs.readdirSync(scratchParent).filter((n) => n.startsWith('gemini-install-'))
    : [];
  assert.deepEqual(leftovers, [], `scratch directories survived the interrupt: ${leftovers}`);
});
