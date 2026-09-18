// Cline native install — skills, always-on rule, and cavecrew subagents.
//
// Cline reads the three trees from two roots, and only skills honour $CLINE_DIR:
// $CLINE_DIR/skills/<name>/SKILL.md, ~/Documents/Cline/Rules/*.md (always-on),
// and ~/Documents/Cline/Agents/*.yaml (subagent presets). Pinned from cline
// source — disk.ts clineSkillsDir/ensureRulesDirectoryExists and
// AgentConfigLoader.getAgentsConfigPath — because an earlier version of this
// lane put the rule and the agents under $CLINE_DIR, where nothing reads them.
// The HOME override below is load-bearing for that reason: without it the suite
// writes into the developer's own ~/Documents/Cline.
// This replaced a generic `npx skills add -a cline` lane that could
// not work: its detect rule (`vscode-ext:cline`) never matched Cline's real
// extension dir (saoudrizwan.claude-dev-*) while it DID match Roo Code's
// (rooveterinaryinc.roo-cline), and it passed no -g so a curl|bash run dropped
// the skills into a cwd-relative ./.agents/skills. Both are pinned below.
//
// `--only cline` makes the provider explicit, so no `cline` binary needs to be
// on PATH for the dispatch to run — we drive it purely through a throwaway
// CLINE_DIR. The detection tests do the opposite and never write.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const INSTALLER = path.join(REPO_ROOT, 'bin', 'install.js');
// Same digest function the installer journals with — the migration test has to
// forge a journal the real uninstall path accepts, and a hand-written hash is
// treated (correctly) as user-modified content and left alone.
const OWNED = createRequire(import.meta.url)(path.join(REPO_ROOT, 'bin', 'lib', 'owned-install.js'));

// Derived, not hardcoded: the lane auto-discovers skills/ so that a skill added
// later ships without anyone remembering to edit a list. The test mirrors that
// rule rather than pinning a snapshot, and asserts the derivation separately.
const EXCLUDED = ['caveman-stats'];
const SKILLS = fs.readdirSync(path.join(REPO_ROOT, 'skills'), { withFileTypes: true })
  .filter((e) => e.isDirectory() && !EXCLUDED.includes(e.name))
  .filter((e) => fs.existsSync(path.join(REPO_ROOT, 'skills', e.name, 'SKILL.md')))
  .map((e) => e.name)
  .sort();
const AGENTS = ['cavecrew-investigator.yaml', 'cavecrew-builder.yaml', 'cavecrew-reviewer.yaml'];
const JOURNAL = '.caveman-cline-ownership.json';
const DOCS_JOURNAL = '.caveman-cline-documents-ownership.json';

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'caveman-cline-'));
}

function clineDir(home) {
  return path.join(home, '.cline');
}

function clineDocsDir(home) {
  return path.join(home, 'Documents', 'Cline');
}

function runInstaller(args, home) {
  return spawnSync(process.execPath, [INSTALLER, ...args, '--config-dir', path.join(home, '.claude-test'), '--non-interactive', '--no-mcp-shrink'], {
    env: {
      ...process.env,
      CLINE_DIR: clineDir(home),
      // The documents root is not under $CLINE_DIR, so it needs its own pin.
      // HOME/USERPROFILE stay overridden as belt and braces: they are what an
      // unset CLINE_DOCUMENTS_DIR resolves against.
      CLINE_DOCUMENTS_DIR: clineDocsDir(home),
      HOME: home,
      USERPROFILE: home,
      NO_COLOR: '1',
    },
    encoding: 'utf8',
  });
}

// ── 1. Fresh install lands all three trees ─────────────────────────────────
test('cline fresh install lands skills, the always-on rule, and cavecrew agents', () => {
  const home = freshHome();
  try {
    const r = runInstaller(['--only', 'cline'], home);
    assert.equal(r.status, 0, `installer failed: ${r.stderr}`);

    const root = clineDir(home);
    for (const name of SKILLS) {
      assert.ok(fs.existsSync(path.join(root, 'skills', name, 'SKILL.md')), `skill ${name}/SKILL.md missing`);
    }
    // caveman-compress ships executable scripts — ensure the recursive copy kept them.
    assert.ok(fs.existsSync(path.join(root, 'skills', 'caveman-compress', 'scripts')), 'caveman-compress/scripts/ not copied');

    // caveman-stats is hook-delivered under Claude Code and would be an inert
    // /caveman-stats here, so the lane must NOT ship it.
    assert.equal(fs.existsSync(path.join(root, 'skills', 'caveman-stats')), false, 'caveman-stats must not ship to Cline');

    const docs = clineDocsDir(home);
    const rule = fs.readFileSync(path.join(docs, 'Rules', 'caveman.md'), 'utf8');
    assert.match(rule, /^Respond terse like smart caveman/, 'rule body is not the caveman ruleset');

    for (const name of AGENTS) {
      const body = fs.readFileSync(path.join(docs, 'Agents', name), 'utf8');
      // Cline's agent loader requires frontmatter with name + description.
      assert.match(body, /^---\r?\n/, `${name} lost its frontmatter fence`);
      assert.match(body, /^name:\s*cavecrew-/m, `${name} missing name:`);
      assert.match(body, /^description:/m, `${name} missing description:`);
    }
    // .md in Agents/ is never read by Cline — the copy must change the extension.
    assert.equal(fs.existsSync(path.join(docs, 'Agents', 'cavecrew-builder.md')), false);

    // $CLINE_DIR holds skills only. Anything here is a path Cline never reads.
    assert.equal(fs.existsSync(path.join(root, 'rules')), false, 'rule written where Cline does not read it');
    assert.equal(fs.existsSync(path.join(root, 'agents')), false, 'agents written where Cline does not read them');

    assert.ok(fs.existsSync(path.join(root, JOURNAL)), 'ownership journal not written');
    assert.ok(fs.existsSync(path.join(docs, DOCS_JOURNAL)), 'documents ownership journal not written');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// ── 1b. The lane ships the WHOLE skill set, not a stale hand-maintained slice ──
// Regression guard for the first cut of this lane, which copied the Hermes
// lane's 6-skill list and silently dropped 13 shippable skills — every
// token-discipline work pattern and every Caveman Cloud driver.
test('cline ships every skill except the hook-delivered one', () => {
  const home = freshHome();
  try {
    assert.ok(SKILLS.length >= 19, `expected the full skill set, derived only ${SKILLS.length}`);
    for (const name of ['investigate-first', 'lean-build', 'migration', 'safe-refactor', 'surgical-patch', 'verify-and-stop']) {
      assert.ok(SKILLS.includes(name), `work-pattern skill ${name} missing from the derived set`);
    }
    for (const name of ['caveman-setup', 'caveman-discover', 'caveman-learn', 'caveman-manage', 'caveman-optimize', 'caveman-evidence-review']) {
      assert.ok(SKILLS.includes(name), `cloud driver skill ${name} missing from the derived set`);
    }
    // skills/generated/ holds native packs, not a SKILL.md — it must not ship.
    assert.equal(SKILLS.includes('generated'), false, 'skills/generated is not a skill');

    const r = runInstaller(['--only', 'cline'], home);
    assert.equal(r.status, 0, r.stderr);
    const installed = fs.readdirSync(path.join(clineDir(home), 'skills')).sort();
    assert.deepEqual(installed, SKILLS, 'installed skill set does not match the derived set');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// ── 2. Uninstall removes everything we installed (no orphans) ──────────────
test('cline uninstall removes skills, rule, agents and the journal', () => {
  const home = freshHome();
  try {
    const r1 = runInstaller(['--only', 'cline'], home);
    assert.equal(r1.status, 0, r1.stderr);

    const root = clineDir(home);
    const r2 = runInstaller(['--uninstall'], home);
    assert.equal(r2.status, 0, r2.stderr);

    for (const name of SKILLS) {
      assert.equal(fs.existsSync(path.join(root, 'skills', name)), false, `${name} survived uninstall`);
    }
    const docs = clineDocsDir(home);
    assert.equal(fs.existsSync(path.join(docs, 'Rules', 'caveman.md')), false, 'rule survived uninstall');
    for (const name of AGENTS) {
      assert.equal(fs.existsSync(path.join(docs, 'Agents', name)), false, `${name} survived uninstall`);
    }
    assert.equal(fs.existsSync(path.join(root, JOURNAL)), false, 'journal survived uninstall');
    assert.equal(fs.existsSync(path.join(docs, DOCS_JOURNAL)), false, 'documents journal survived uninstall');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// ── 2b. One-time migration off the old (unread) $CLINE_DIR layout ──────────
// Installs produced before the path fix journaled rules/ and agents/ under
// $CLINE_DIR. Re-running must move them, not leave two copies with only one
// of them live.
test('cline install migrates a legacy $CLINE_DIR rule and agents to the documents root', () => {
  const home = freshHome();
  try {
    const root = clineDir(home);
    // Simulate the old layout by installing, then relocating what the new
    // installer writes into the documents root back under $CLINE_DIR, with a
    // journal that claims them — exactly the on-disk state the old lane left.
    assert.equal(runInstaller(['--only', 'cline'], home).status, 0);
    const docs = clineDocsDir(home);
    fs.mkdirSync(path.join(root, 'rules'), { recursive: true });
    fs.mkdirSync(path.join(root, 'agents'), { recursive: true });
    fs.renameSync(path.join(docs, 'Rules', 'caveman.md'), path.join(root, 'rules', 'caveman.md'));
    for (const name of AGENTS) {
      fs.renameSync(path.join(docs, 'Agents', name), path.join(root, 'agents', name));
    }
    fs.rmSync(docs, { recursive: true, force: true });
    const journalPath = path.join(root, JOURNAL);
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
    journal.entries['rules/caveman.md'] = {
      installedDigest: OWNED.digestPath(path.join(root, 'rules', 'caveman.md')),
    };
    for (const name of AGENTS) {
      journal.entries[`agents/${name}`] = {
        installedDigest: OWNED.digestPath(path.join(root, 'agents', name)),
      };
    }
    fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2) + '\n');

    const r = runInstaller(['--only', 'cline', '--force'], home);
    assert.equal(r.status, 0, r.stderr);

    assert.equal(fs.existsSync(path.join(root, 'rules', 'caveman.md')), false, 'legacy rule was left behind');
    for (const name of AGENTS) {
      assert.equal(fs.existsSync(path.join(root, 'agents', name)), false, `legacy ${name} was left behind`);
    }
    assert.ok(fs.existsSync(path.join(docs, 'Rules', 'caveman.md')), 'rule missing from the documents root');
    for (const name of AGENTS) {
      assert.ok(fs.existsSync(path.join(docs, 'Agents', name)), `${name} missing from the documents root`);
    }
    for (const name of SKILLS) {
      assert.ok(fs.existsSync(path.join(root, 'skills', name, 'SKILL.md')), `${name} lost during migration`);
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// ── 3. Dry runs write and delete nothing ───────────────────────────────────
test('cline dry-run install writes nothing', () => {
  const home = freshHome();
  try {
    const r = runInstaller(['--only', 'cline', '--dry-run'], home);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.existsSync(path.join(clineDir(home), 'skills')), false);
    assert.equal(fs.existsSync(clineDocsDir(home)), false, 'dry run created the documents root');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('cline dry-run uninstall leaves the install in place', () => {
  const home = freshHome();
  try {
    runInstaller(['--only', 'cline'], home);
    const r = runInstaller(['--uninstall', '--dry-run'], home);
    assert.notEqual(r.status, 2);

    const root = clineDir(home);
    for (const name of SKILLS) {
      assert.ok(fs.existsSync(path.join(root, 'skills', name)), `${name} was deleted by a dry-run uninstall`);
    }
    assert.ok(fs.existsSync(path.join(clineDocsDir(home), 'Rules', 'caveman.md')));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// ── 4. Unowned user content is never overwritten ───────────────────────────
test('cline refuses unowned same-named content without writing a partial install', () => {
  const home = freshHome();
  try {
    const root = clineDir(home);
    const userSkill = path.join(root, 'skills', 'caveman');
    fs.mkdirSync(userSkill, { recursive: true });
    fs.writeFileSync(path.join(userSkill, 'SKILL.md'), '# user-owned\n');

    const result = runInstaller(['--only', 'cline'], home);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /ownership conflict/);
    assert.equal(fs.readFileSync(path.join(userSkill, 'SKILL.md'), 'utf8'), '# user-owned\n');
    assert.equal(fs.existsSync(path.join(root, 'skills', 'caveman-review')), false, 'conflict must fail before partial copy');
    assert.equal(fs.existsSync(path.join(clineDocsDir(home), 'Rules', 'caveman.md')), false, 'conflict must fail before writing the rule');
    assert.equal(fs.existsSync(path.join(root, JOURNAL)), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('cline uninstall never deletes unjournaled same-named user content', () => {
  const home = freshHome();
  try {
    const userRule = path.join(clineDocsDir(home), 'Rules', 'caveman.md');
    fs.mkdirSync(path.dirname(userRule), { recursive: true });
    fs.writeFileSync(userRule, '# user-owned\n');

    const removed = runInstaller(['--uninstall'], home);
    assert.equal(removed.status, 0, removed.stderr);
    assert.equal(fs.readFileSync(userRule, 'utf8'), '# user-owned\n');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('cline --force backs up conflicts and uninstall restores the original bytes', () => {
  const home = freshHome();
  try {
    const root = clineDir(home);
    const userSkill = path.join(root, 'skills', 'caveman');
    fs.mkdirSync(userSkill, { recursive: true });
    fs.writeFileSync(path.join(userSkill, 'SKILL.md'), '# user-owned\n');

    const installed = runInstaller(['--only', 'cline', '--force'], home);
    assert.equal(installed.status, 0, installed.stderr);
    assert.notEqual(fs.readFileSync(path.join(userSkill, 'SKILL.md'), 'utf8'), '# user-owned\n');

    const removed = runInstaller(['--uninstall'], home);
    assert.equal(removed.status, 0, removed.stderr);
    assert.equal(fs.readFileSync(path.join(userSkill, 'SKILL.md'), 'utf8'), '# user-owned\n');
    assert.equal(fs.existsSync(path.join(root, 'skills', 'caveman-review')), false);
    assert.equal(fs.existsSync(path.join(root, JOURNAL)), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// ── 5. Detection ───────────────────────────────────────────────────────────
// Both cases are --dry-run so a false positive cannot write to the real HOME.
function runDetect(home, { fakeBin } = {}) {
  const pathEntries = fakeBin ? [fakeBin, '/usr/bin', '/bin'] : ['/usr/bin', '/bin'];
  return spawnSync(process.execPath, [INSTALLER, '--dry-run', '--non-interactive', '--no-hooks', '--no-mcp-shrink', '--skip-skills', '--config-dir', path.join(home, '.claude-test')], {
    env: {
      PATH: pathEntries.join(path.delimiter),
      HOME: home,
      USERPROFILE: home,
      CLINE_DIR: clineDir(home),
      NO_COLOR: '1',
    },
    encoding: 'utf8',
  });
}

test('cline is detected from the CLI binary on PATH', { skip: process.platform === 'win32' }, () => {
  const home = freshHome();
  try {
    const fakeBin = path.join(home, 'bin');
    fs.mkdirSync(fakeBin, { recursive: true });
    fs.writeFileSync(path.join(fakeBin, 'cline'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });

    const r = runDetect(home, { fakeBin });
    assert.match(r.stdout, /Cline detected/, `cline CLI on PATH was not detected:\n${r.stdout}\n${r.stderr}`);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('an installed Roo Code extension does not masquerade as Cline', { skip: process.platform === 'win32' }, () => {
  const home = freshHome();
  try {
    // The old `vscode-ext:cline` substring probe matched this directory.
    fs.mkdirSync(path.join(home, '.vscode', 'extensions', 'rooveterinaryinc.roo-cline-1.0.0'), { recursive: true });

    const r = runDetect(home);
    assert.doesNotMatch(r.stdout, /Cline detected/, `Roo Code's extension dir false-positived as Cline:\n${r.stdout}`);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('the real Cline extension directory is detected', { skip: process.platform === 'win32' }, () => {
  const home = freshHome();
  try {
    fs.mkdirSync(path.join(home, '.vscode', 'extensions', 'saoudrizwan.claude-dev-3.0.0'), { recursive: true });

    const r = runDetect(home);
    assert.match(r.stdout, /Cline detected/, `Cline's real extension dir was not detected:\n${r.stdout}`);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
