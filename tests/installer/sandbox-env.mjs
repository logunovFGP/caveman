// Shared PATH sandbox for the installer suites.
//
// `--config-dir` scopes hook files and settings.json. It does NOT scope
// `claude plugin uninstall`, `gemini extensions uninstall` or `cline mcp` —
// those talk to whatever binary is on PATH, against the developer's own
// account. A suite that runs a live `--uninstall` with the real PATH therefore
// uninstalls the developer's real Claude Code plugin and Gemini extension.
// Observed twice in one session before this existed.
//
// Not a *.test.mjs file on purpose: the runner globs that pattern.
import fs from 'node:fs';
import path from 'node:path';

// Walk every PATH entry; drop any that holds one of the named binaries.
// Cross-platform: `:` on macOS/Linux, `;` on Windows, plus the Windows
// executable extensions.
export function pathWithout(binNames, fromPath = process.env.PATH) {
  const sep = process.platform === 'win32' ? ';' : ':';
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  const want = new Set(binNames);
  return (fromPath || '')
    .split(sep)
    .filter((dir) => {
      if (!dir) return false;
      for (const bin of want) {
        for (const ext of exts) {
          try { if (fs.existsSync(path.join(dir, bin + ext))) return false; } catch (_) { /* unreadable dir */ }
        }
      }
      return true;
    })
    .join(sep);
}

// The hosts an installer run can reach out and mutate for real.
// `cline` stays ON PATH: the only thing the installer runs through it is
// `cline mcp add`, which needs --with-mcp-shrink, while the detection tests
// require the binary to be findable.
export const HOST_BINARIES = ['claude', 'gemini', 'caveman'];

// PATH with every one of them removed. Use for any spawn that may reach the
// uninstall path.
// Filters a PATH rather than replacing it, so a suite keeps the stub bin dirs
// it built (a fake `opencode`, a fake `caveman`) and loses only the real hosts.
// Callers that spread their own env AFTER a PATH assignment must re-apply this
// to the merged value — that spread is what let a real plugin get uninstalled.
export function hostlessPath(fromPath = process.env.PATH) {
  return pathWithout(HOST_BINARIES, fromPath);
}
