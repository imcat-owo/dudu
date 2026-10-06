/**
 * Coding loop — workspace tests (PURE).
 *
 * Hard guarantees under test:
 * 1. isPathSafe rejects escapes (.., absolute, ~, quotes, $()).
 * 2. checkCommand blocks destructive patterns, allows normal commands.
 * 3. Command builders produce the exact expected strings.
 * 4. deriveTestFiles maps src layout → test layout (basename convention).
 * 5. parsePorcelain extracts changed paths (incl. renames).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  biomeCommand,
  buildCommitMessage,
  buildEnsureCommands,
  checkCommand,
  DUDU_LAYOUT,
  deriveTestFiles,
  isPathSafe,
  parsePorcelain,
  scopeCommand,
  testCommand,
  tscCommand,
} from "../src/coding/workspace.js";

describe("coding workspace", () => {
  it("isPathSafe allows repo-relative paths only", () => {
    assert.equal(isPathSafe("apps/mobile/src/foo.ts"), true);
    assert.equal(isPathSafe("a/b/c.tsx"), true);
    assert.equal(isPathSafe("../escape.ts"), false);
    assert.equal(isPathSafe("a/../../escape.ts"), false);
    assert.equal(isPathSafe("/etc/passwd"), false);
    assert.equal(isPathSafe("~/x"), false);
    assert.equal(isPathSafe(""), false);
    assert.equal(isPathSafe("a'b.ts"), false);
    assert.equal(isPathSafe('a"b.ts'), false);
    assert.equal(isPathSafe("a`b.ts"), false);
    assert.equal(isPathSafe("a$(b).ts"), false);
    assert.equal(isPathSafe("a\nb.ts"), false);
    assert.equal(isPathSafe("a//b.ts"), false);
  });

  it("checkCommand blocks destructive patterns", () => {
    assert.ok(checkCommand("rm -rf /") !== null);
    assert.ok(checkCommand("rm -rf ~/") !== null);
    assert.ok(checkCommand("sudo rm -rf /") !== null);
    assert.ok(checkCommand("mkfs.ext4 /dev/sda1") !== null);
    assert.ok(checkCommand("dd if=/dev/zero of=/dev/sda") !== null);
    assert.ok(checkCommand("shutdown -h now") !== null);
    assert.ok(checkCommand("") !== null);
    assert.equal(checkCommand("npx tsc --noEmit -p apps/mobile"), null);
    assert.equal(checkCommand("git status --porcelain"), null);
    assert.equal(checkCommand("rm -rf node_modules/.cache"), null);
    assert.equal(checkCommand("npm install"), null);
  });

  it("scopeCommand locks cwd to the workspace root", () => {
    assert.equal(scopeCommand("dudu-src", "git status"), "cd 'dudu-src' && git status");
  });

  it("buildEnsureCommands clones when missing and checks out the branch", () => {
    const cmds = buildEnsureCommands("dudu-src", "https://example.com/r.git", "coding/abc", "main");
    assert.equal(cmds.length, 3);
    assert.match(cmds[0], /HAS_GIT/);
    assert.match(cmds[1], /git clone/);
    assert.match(cmds[1], /example\.com\/r\.git/);
    assert.match(cmds[2], /coding\/abc/);
    assert.match(cmds[2], /git checkout -b/);
  });

  it("verification command builders", () => {
    assert.equal(tscCommand("apps/mobile"), "npx --no-install tsc --noEmit -p apps/mobile");
    assert.equal(
      biomeCommand(["apps/mobile/src/a.ts"]),
      "npx --no-install biome check 'apps/mobile/src/a.ts'",
    );
    assert.equal(
      testCommand(["x.test.ts"]),
      "env -u NODE_TEST_CONTEXT npx --no-install tsx --test 'x.test.ts'",
    );
  });

  it("deriveTestFiles maps src basenames to test files", () => {
    assert.deepEqual(deriveTestFiles(["apps/mobile/src/chat/persona-group.ts"], DUDU_LAYOUT), [
      "apps/mobile/test/persona-group.test.ts",
    ]);
    assert.deepEqual(deriveTestFiles(["apps/mobile/src/a.tsx", "other/x.ts"], DUDU_LAYOUT), [
      "apps/mobile/test/a.test.ts",
    ]);
    // already-a-test and non-src files produce nothing
    assert.deepEqual(deriveTestFiles(["apps/mobile/test/a.test.ts"], DUDU_LAYOUT), []);
    assert.deepEqual(deriveTestFiles([], DUDU_LAYOUT), []);
  });

  it("parsePorcelain extracts changed paths incl. renames", () => {
    const out = ` M apps/mobile/src/a.ts\n?? apps/mobile/src/new.ts\nR  apps/mobile/src/old.ts -> apps/mobile/src/renamed.ts\n`;
    assert.deepEqual(parsePorcelain(out), [
      "apps/mobile/src/a.ts",
      "apps/mobile/src/new.ts",
      "apps/mobile/src/renamed.ts",
    ]);
    assert.deepEqual(parsePorcelain(""), []);
  });

  it("buildCommitMessage includes task id and files", () => {
    const m = buildCommitMessage("ct_x", "加按钮", ["a.ts", "b.ts"]);
    assert.match(m, /coding\(ct_x\)/);
    assert.match(m, /加按钮/);
    assert.match(m, /a\.ts, b\.ts/);
  });
});
