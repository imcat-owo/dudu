/**
 * Coding loop — verification tests with a REAL fixture project.
 *
 * Nothing is faked here: a scratch workspace gets a tiny TS project, and
 * runVerification shells out to the real tsc / biome / tsx. Symlinks point
 * the fixture's node_modules at the repo's real ones (no installs).
 *
 * Hard guarantees under test:
 * 1. A clean fixture verifies green (tsc + biome + tests all pass).
 * 2. An injected type error is CAUGHT by tsc — the loop reports failure,
 *    never success.
 * 3. summarizeVerify: a prerequisite-blocked check fails the round
 *    (a skip is not a pass).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { after, before, describe, it } from "node:test";
import { createLocalRunner } from "../src/coding/executor-local.js";
import { runVerification, summarizeVerify } from "../src/coding/verify.js";
import type { ProjectLayout } from "../src/coding/workspace.js";

const REPO_ROOT = path.resolve("..", ".."); // tests run with cwd=apps/mobile → repo root
const LAYOUT: ProjectLayout = { appDir: "myapp", srcDir: "myapp/src", testDir: "myapp/test" };

const TSCONFIG = JSON.stringify(
  {
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "bundler",
      strict: true,
      noEmit: true,
      skipLibCheck: true,
    },
    include: ["src"],
  },
  null,
  2,
);

const BIOME_JSON = JSON.stringify(
  {
    formatter: { enabled: true, indentStyle: "space" },
    javascript: { formatter: { quoteStyle: "double" } },
  },
  null,
  2,
);
const GOOD_SRC = `export function add(a: number, b: number): number {
  return a + b;
}
`;

const BROKEN_SRC = `export function add(a: number, b: number): string {
  return a + b;
}
`;

const TEST_SRC = `import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { add } from "../src/add.js";

describe("add", () => {
  it("adds two numbers", () => {
    assert.equal(add(1, 2), 3);
  });
});
`;

let dir = "";

function write(rel: string, content: string): void {
  const abs = path.join(dir, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
}

before(() => {
  dir = mkdtempSync(path.join(tmpdir(), "coding-verify-"));
  write("myapp/tsconfig.json", TSCONFIG);
  write("biome.json", BIOME_JSON);
  write("myapp/src/add.ts", GOOD_SRC);
  write("myapp/test/add.test.ts", TEST_SRC);
  // Real binaries via symlinks — no installs, no network.
  symlinkSync(path.join(REPO_ROOT, "node_modules"), path.join(dir, "node_modules"));
  symlinkSync(
    path.join(REPO_ROOT, "apps", "mobile", "node_modules"),
    path.join(dir, "myapp", "node_modules"),
  );
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("coding verify (real toolchain)", () => {
  it("a clean fixture verifies green", async () => {
    const runner = createLocalRunner(dir);
    const r = await runVerification({ runner, touchedFiles: ["myapp/src/add.ts"], layout: LAYOUT });
    assert.equal(r.tsc.ok, true, `tsc output: ${r.tsc.output}`);
    assert.equal(r.tsc.skipped, undefined);
    assert.equal(r.biome.ok, true, `biome output: ${r.biome.output}`);
    assert.equal(r.tests.ok, true, `tests output: ${r.tests.output.slice(0, 500)}`);
    const s = summarizeVerify(r);
    assert.equal(s.ok, true, s.summary);
  });

  it("an injected type error is caught — the loop reports failure, not success", async () => {
    write("myapp/src/add.ts", BROKEN_SRC);
    try {
      const runner = createLocalRunner(dir);
      const r = await runVerification({
        runner,
        touchedFiles: ["myapp/src/add.ts"],
        layout: LAYOUT,
      });
      assert.equal(r.tsc.ok, false, "tsc must fail on the type error");
      assert.match(r.tsc.output, /error TS/, "output carries the real tsc error");
      // biome/tests may still pass — the round as a whole must fail.
      const s = summarizeVerify(r);
      assert.equal(s.ok, false, `round must fail: ${s.summary}`);
    } finally {
      write("myapp/src/add.ts", GOOD_SRC);
    }
  });

  it("a failing test is caught too", async () => {
    write(
      "myapp/test/add.test.ts",
      TEST_SRC.replace("assert.equal(add(1, 2), 3)", "assert.equal(add(1, 2), 999)"),
    );
    try {
      const runner = createLocalRunner(dir);
      const r = await runVerification({
        runner,
        touchedFiles: ["myapp/src/add.ts"],
        layout: LAYOUT,
      });
      assert.equal(r.tests.ok, false, "tests must fail");
      const s = summarizeVerify(r);
      assert.equal(s.ok, false);
    } finally {
      write("myapp/test/add.test.ts", TEST_SRC);
    }
  });

  it("a prerequisite-blocked check fails the round (a skip is not a pass)", () => {
    const blocked = { ok: false, skipped: "no node", blocked: true, output: "" };
    const na = { ok: true, skipped: "no test files", output: "" };
    const good = { ok: true, output: "clean" };
    assert.equal(summarizeVerify({ tsc: blocked, biome: good, tests: good }).ok, false);
    assert.equal(summarizeVerify({ tsc: good, biome: good, tests: na }).ok, true);
  });

  it("missing app node_modules blocks tsc honestly", async () => {
    execFileSync("rm", [path.join(dir, "myapp", "node_modules")]);
    try {
      const runner = createLocalRunner(dir);
      const r = await runVerification({
        runner,
        touchedFiles: ["myapp/src/add.ts"],
        layout: LAYOUT,
      });
      assert.ok(r.tsc.skipped, "tsc skipped with a reason");
      assert.equal(r.tsc.blocked, true);
      assert.equal(summarizeVerify(r).ok, false, "round fails when tsc is blocked");
    } finally {
      symlinkSync(
        path.join(REPO_ROOT, "apps", "mobile", "node_modules"),
        path.join(dir, "myapp", "node_modules"),
      );
    }
  });
});
