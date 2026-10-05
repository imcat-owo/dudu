/**
 * Harness Phase 1 — tool registry: register/resolve/replace/unregister,
 * mount, definitions, execute, unknown-tool contract, and needsApproval
 * derivation for migrated LocalTools.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LocalTool } from "../src/api-groups/local-tools.js";
import { ToolError } from "../src/api-groups/local-tools.js";
import {
  createHarnessRegistry,
  createHarnessRegistryFromLocalTools,
  type HarnessTool,
  harnessToolFromLocalTool,
} from "../src/harness/tool-registry.js";

function fakeTool(name: string, extra: Partial<HarnessTool> = {}): HarnessTool {
  return {
    name,
    description: `${name} does things`,
    parameters: { type: "object", properties: {} },
    needsApproval: false,
    run: async () => `ran ${name}`,
    ...extra,
  };
}

describe("harness registry: register/resolve", () => {
  it("resolves registered tools and lists them in order", () => {
    const r = createHarnessRegistry();
    r.register(fakeTool("a"));
    r.register(fakeTool("b"));
    assert.equal(r.resolve("a")?.name, "a");
    assert.deepEqual(
      r.list().map((t) => t.name),
      ["a", "b"],
    );
    assert.equal(r.resolve("nope"), undefined);
  });

  it("register throws on duplicates; replace swaps", () => {
    const r = createHarnessRegistry();
    r.register(fakeTool("a"));
    assert.throws(() => r.register(fakeTool("a")), /already registered/);
    r.replace("a", fakeTool("a", { description: "v2", run: async () => "v2" }));
    assert.equal(r.resolve("a")?.description, "v2");
    assert.throws(() => r.replace("ghost", fakeTool("ghost")), /no such tool/);
  });

  it("unregister removes; mount bulk-adds", () => {
    const r = createHarnessRegistry([fakeTool("a")]);
    r.mount([fakeTool("b"), fakeTool("c")]);
    assert.equal(r.list().length, 3);
    r.unregister("b");
    assert.equal(r.resolve("b"), undefined);
    r.unregister("never-there"); // no-op, no throw
  });
});

describe("harness registry: definitions + execute", () => {
  it("definitions() emits the model wire format", () => {
    const r = createHarnessRegistry([fakeTool("a")]);
    const defs = r.definitions();
    assert.equal(defs.length, 1);
    assert.equal(defs[0].type, "function");
    assert.equal(defs[0].function.name, "a");
  });

  it("execute runs the tool; unknown tool throws ToolError", async () => {
    const r = createHarnessRegistry([fakeTool("a")]);
    assert.equal(await r.execute("a", {}, { authorize: async () => true }), "ran a");
    await assert.rejects(
      () => r.execute("ghost", {}, { authorize: async () => true }),
      (e) => {
        assert.ok(e instanceof ToolError);
        assert.match((e as Error).message, /Unknown tool: ghost/);
        return true;
      },
    );
  });
});

describe("harness registry: LocalTool migration", () => {
  function local(name: string, capability?: LocalTool["capability"]): LocalTool {
    return {
      name,
      description: "d",
      parameters: { type: "object", properties: {} },
      capability,
      run: async () => "ok",
    };
  }

  it("capability tools declare needsApproval; in-app tools do not", () => {
    assert.equal(harnessToolFromLocalTool(local("photos", "photos")).needsApproval, true);
    assert.equal(harnessToolFromLocalTool(local("read_manual")).needsApproval, false);
  });

  it("createHarnessRegistryFromLocalTools migrates a whole list", () => {
    const r = createHarnessRegistryFromLocalTools([local("a"), local("b", "photos")]);
    assert.equal(r.list().length, 2);
    assert.equal(r.resolve("b")?.needsApproval, true);
    assert.equal(r.resolve("a")?.needsApproval, false);
  });
});
