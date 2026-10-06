/**
 * Coding loop — engine tests incl. the HONEST end-to-end demo.
 *
 * The demo runs the full loop against a scratch git checkout with a tiny
 * TS project: propose → approve → write (pure function + test) → verify
 * (REAL tsc + biome + tsx) → complete → assert done + a real git commit.
 * Binaries come from the repo's own node_modules via symlinks.
 *
 * Hard guarantees under test:
 * 1. Approval gate: write/run/verify/complete all refuse while "proposed".
 * 2. complete("done") without a green verify round throws — no fake success.
 * 3. A broken edit fails verify; the fix round turns it green (the loop).
 * 4. complete() commits the touched files on the task branch (local only).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  type CodingEngineDeps,
  completeTask,
  runTaskCommand,
  verifyTask,
  writeTaskFile,
} from "../src/coding/engine.js";
import { createLocalRunner } from "../src/coding/executor-local.js";
import { createCodingStore } from "../src/coding/store.js";
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

const PROPOSE = {
  title: "加个 add 函数",
  request: "加个纯函数 add",
  steps: [{ title: "写 add.ts", files: ["myapp/src/add.ts"] }],
  expectedOutcome: "有个能用的 add 函数",
  doneCriteria: "tsc/biome/测试全过",
};

let dir = "";
let idSeq = 0;

function sh(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { cwd: dir, encoding: "utf8" });
}

function makeDeps(): { deps: CodingEngineDeps; store: ReturnType<typeof createCodingStore> } {
  const store = createCodingStore(undefined, { newId: () => `ct_e2e${++idSeq}` });
  const deps: CodingEngineDeps = {
    store,
    // The fixture dir IS the workspace root (root ".").
    getRunner: async () => ({ runner: createLocalRunner(dir), root: "." }),
    layout: LAYOUT,
  };
  return { deps, store };
}

before(() => {
  dir = mkdtempSync(path.join(tmpdir(), "coding-engine-"));
  const w = (rel: string, c: string) => {
    const abs = path.join(dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, c, "utf8");
  };
  w("myapp/tsconfig.json", TSCONFIG);
  w("biome.json", BIOME_JSON);
  symlinkSync(path.join(REPO_ROOT, "node_modules"), path.join(dir, "node_modules"));
  symlinkSync(
    path.join(REPO_ROOT, "apps", "mobile", "node_modules"),
    path.join(dir, "myapp", "node_modules"),
  );
  sh("git", ["init", "-b", "main", "."]);
  sh("git", ["config", "user.email", "test@localhost"]);
  sh("git", ["config", "user.name", "test"]);
  sh("git", ["add", "-A"]);
  sh("git", ["commit", "-m", "init", "--quiet"]);
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("coding engine", () => {
  it("approval gate: write/run/verify/complete refuse while proposed", async () => {
    const { deps, store } = makeDeps();
    const t = store.propose("th1", PROPOSE);
    await assert.rejects(writeTaskFile(deps, t.id, "myapp/src/a.ts", "x"), /拍板/);
    await assert.rejects(runTaskCommand(deps, t.id, "echo hi"), /拍板/);
    await assert.rejects(verifyTask(deps, t.id), /拍板/);
    await assert.rejects(completeTask(deps, t.id, "done", "x"), /拍板/);
    assert.equal(store.getTask(t.id)?.status, "proposed");
  });

  it("complete(done) without a green verify throws — no fake success", async () => {
    const { deps, store } = makeDeps();
    const t = store.propose("th1", PROPOSE);
    store.decide(t.id, true);
    await assert.rejects(completeTask(deps, t.id, "done", "做完了"), /验证/);
    // honest failure is always allowed
    const out = await completeTask(deps, t.id, "failed", "沙箱没连上，做不了");
    assert.match(out, /失败/);
    assert.equal(store.getTask(t.id)?.status, "failed");
  });

  it("end-to-end demo: plan → execute → verify green → complete → git commit", async () => {
    const { deps, store } = makeDeps();
    const t = store.propose("th1", PROPOSE);
    store.decide(t.id, true);

    // Execute: write the pure function + its test.
    await writeTaskFile(deps, t.id, "myapp/src/add.ts", GOOD_SRC);
    await writeTaskFile(deps, t.id, "myapp/test/add.test.ts", TEST_SRC);
    assert.deepEqual(store.getTask(t.id)?.touchedFiles, [
      "myapp/src/add.ts",
      "myapp/test/add.test.ts",
    ]);

    // Verify: REAL tsc + biome + tsx, all green.
    const v = await verifyTask(deps, t.id);
    assert.equal(v.ok, true, `verify must pass: ${v.summary}\n${v.tsc.output}`);
    assert.equal(v.attempt, 1);

    // Complete: done + a real local commit on the task branch.
    const out = await completeTask(deps, t.id, "done", "add 函数加上了，测试通过");
    assert.match(out, /完成/);
    assert.equal(store.getTask(t.id)?.status, "done");
    const branch = sh("git", ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
    assert.ok(branch.startsWith("coding/"), `on task branch, got ${branch}`);
    const log = sh("git", ["log", "--oneline", "-1"]).trim();
    assert.match(log, /coding\(/);
    const files = sh("git", ["show", "--name-only", "--format=", "HEAD"]).trim().split("\n");
    assert.ok(files.includes("myapp/src/add.ts"), `commit has add.ts: ${files}`);
  });

  it("broken edit → verify fails → fix → verify green (the fix loop)", async () => {
    const { deps, store } = makeDeps();
    const t = store.propose("th1", PROPOSE);
    store.decide(t.id, true);

    await writeTaskFile(deps, t.id, "myapp/src/add.ts", BROKEN_SRC);
    await writeTaskFile(deps, t.id, "myapp/test/add.test.ts", TEST_SRC);
    const v1 = await verifyTask(deps, t.id);
    assert.equal(v1.ok, false, "broken edit must fail verification");
    assert.match(v1.tsc.output, /error TS/);

    // Fix round: correct the return type, re-verify.
    await writeTaskFile(deps, t.id, "myapp/src/add.ts", GOOD_SRC);
    const v2 = await verifyTask(deps, t.id);
    assert.equal(v2.ok, true, `fixed code must verify green: ${v2.summary}`);
    assert.equal(v2.attempt, 2);

    const out = await completeTask(deps, t.id, "done", "修好了类型错误，验证通过");
    assert.match(out, /完成/);
  });

  it("destructive commands are blocked even when approved", async () => {
    const { deps, store } = makeDeps();
    const t = store.propose("th1", PROPOSE);
    store.decide(t.id, true);
    await assert.rejects(runTaskCommand(deps, t.id, "rm -rf /"), /安全规则/);
    await assert.rejects(writeTaskFile(deps, t.id, "../escape.ts", "x"), /路径不合法/);
  });
});
