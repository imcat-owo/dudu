/**
 * Repo workspace inside the sandbox backend.
 *
 * The coding loop never touches the phone's filesystem and never forks a
 * parallel file system: everything runs through the existing
 * SandboxBackend.runCommand, scoped to one repo checkout
 * (<root>, default "dudu-src" under the sandbox env's home).
 *
 * This module is PURE: it builds commands, validates paths, and parses
 * results. The actual command execution is injected (FileRunner).
 */

export const DEFAULT_WORKSPACE_ROOT = "dudu-src";
export const DEFAULT_REPO_URL = "https://github.com/imcat-owo/dudu.git";
export const DEFAULT_BRANCH_BASE = "main";

/** A command denied by the safety seatbelt, with the reason. */
export interface DeniedCommand {
  reason: string;
}

/**
 * Repo-relative path safety: only paths inside the checkout are allowed.
 * Rejects absolute paths, parent escapes, home expansion, and quotes
 * (quotes would break the single-quoted shell wrapping).
 */
export function isPathSafe(path: string): boolean {
  if (!path || typeof path !== "string") return false;
  const p = path.trim();
  if (!p || p.startsWith("/") || p.startsWith("~")) return false;
  if (p.includes("'") || p.includes('"') || p.includes("`") || p.includes("$(")) return false;
  const parts = p.split("/");
  if (parts.some((seg) => seg === ".." || seg === "")) return false;
  if (p.includes("\n") || p.includes("\r")) return false;
  return true;
}

/**
 * Defense-in-depth denylist for run commands. The plan-approval card is the
 * real consent gate; this only stops obviously destructive one-liners that
 * no coding plan should ever contain.
 */
const DENIED_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  {
    re: /(^|[\s;&|])rm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+)*(\/(\s|$)|\/\*|~\/)/,
    reason: "rm -rf on / or ~",
  },
  { re: /\bmkfs(\.|$|\s)/, reason: "mkfs" },
  { re: /\bdd\s+.*of=\/dev\//, reason: "dd to a device" },
  { re: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;?\s*:/, reason: "fork bomb" },
  { re: /\bshutdown\b|\breboot\b|\bhalt\b|\bpoweroff\b/, reason: "shutdown/reboot" },
  { re: />\s*\/dev\/sd[a-z]/, reason: "write to a disk device" },
];

export function checkCommand(cmd: string): DeniedCommand | null {
  if (!cmd?.trim()) return { reason: "empty command" };
  for (const { re, reason } of DENIED_PATTERNS) {
    if (re.test(cmd)) return { reason: `blocked destructive pattern (${reason})` };
  }
  return null;
}

/** Wrap a command so it always runs inside the workspace root. */
export function scopeCommand(root: string, cmd: string): string {
  return `cd '${root}' && ${cmd}`;
}

/** Shell-quote a single-quoted-safe string (callers must pass safe input). */
function sq(s: string): string {
  return `'${s}'`;
}

/** Commands that ensure the checkout exists and the task branch is checked out. */
export function buildEnsureCommands(
  root: string,
  repoUrl: string,
  branch: string,
  baseBranch = DEFAULT_BRANCH_BASE,
): string[] {
  return [
    // Does the checkout exist?
    `if [ -d ${sq(root)}/.git ]; then echo HAS_GIT; else echo NO_GIT; fi`,
    // Clone when missing (shallow — the loop needs history only for diffs).
    `if [ ! -d ${sq(root)}/.git ]; then git clone --depth 50 ${sq(repoUrl)} ${sq(root)}; fi`,
    // Task branch: reuse if it exists (resume), else create from base.
    `cd ${sq(root)} && (git rev-parse --verify --quiet ${sq(branch)} >/dev/null && git checkout ${sq(branch)} || git checkout -b ${sq(branch)} ${sq(baseBranch)}) && git rev-parse --abbrev-ref HEAD`,
  ];
}

export function buildPrereqCommands(): string[] {
  return [
    `command -v node >/dev/null && node --version || echo NO_NODE`,
    `command -v git >/dev/null && git --version || echo NO_GIT_BIN`,
    `if [ -d ${sq("node_modules")} ]; then echo HAS_ROOT_DEPS; else echo NO_ROOT_DEPS; fi`,
    `if [ -d ${sq("apps/mobile/node_modules")} ]; then echo HAS_APP_DEPS; else echo NO_APP_DEPS; fi`,
  ];
}

/** Real verification commands, run from the repo root. */
export function tscCommand(appDir = "apps/mobile"): string {
  return `npx --no-install tsc --noEmit -p ${appDir}`;
}

export function biomeCommand(files: string[]): string {
  const targets = files.length > 0 ? files.map(sq).join(" ") : "apps/mobile/src";
  return `npx --no-install biome check ${targets}`;
}

export function testCommand(testFiles: string[]): string {
  // env -u NODE_TEST_CONTEXT: node:test skips ("recursively within a test
  // file") when it inherits the test-runner context — e.g. when verify
  // itself runs inside a test. Scrubbing it keeps the inner run honest.
  return `env -u NODE_TEST_CONTEXT npx --no-install tsx --test ${testFiles.map(sq).join(" ")}`;
}

/**
 * Derive candidate test files from touched source paths.
 * Convention: <srcDir>/chat/foo.ts -> <testDir>/foo.test.ts
 * (basename-based, matching the repo's actual layout).
 */
export interface ProjectLayout {
  appDir: string;
  srcDir: string;
  testDir: string;
}

export const DUDU_LAYOUT: ProjectLayout = {
  appDir: "apps/mobile",
  srcDir: "apps/mobile/src",
  testDir: "apps/mobile/test",
};

export function deriveTestFiles(
  touchedFiles: string[],
  layout: ProjectLayout = DUDU_LAYOUT,
): string[] {
  const out = new Set<string>();
  const prefix = layout.srcDir.endsWith("/") ? layout.srcDir : `${layout.srcDir}/`;
  for (const f of touchedFiles) {
    if (!f.startsWith(prefix)) continue;
    const base = f.slice(prefix.length).split("/").pop() ?? "";
    const stem = base.replace(/\.(tsx?|jsx?)$/, "");
    if (!stem || stem.endsWith(".test")) continue;
    out.add(`${layout.testDir}/${stem}.test.ts`);
  }
  return [...out];
}

/** Parse `git status --porcelain` into changed repo-relative paths. */
export function parsePorcelain(output: string): string[] {
  const files: string[] = [];
  for (const line of output.split("\n")) {
    const m = /^.{2}\s+(.+)$/.exec(line.trimEnd());
    if (!m) continue;
    let p = m[1].trim();
    // Handle renames: "old -> new".
    const arrow = p.indexOf(" -> ");
    if (arrow >= 0) p = p.slice(arrow + 4);
    // Strip quotes git adds around special names.
    if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
    if (p && isPathSafe(p)) files.push(p);
  }
  return files;
}

/** Commit message for a finished task branch. */
export function buildCommitMessage(taskId: string, title: string, files: string[]): string {
  const list = files.slice(0, 12).join(", ") + (files.length > 12 ? ", …" : "");
  return `coding(${taskId}): ${title}\n\n${list}`;
}
