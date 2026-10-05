/**
 * B5: dudu tools respect persona isolation.
 *
 * - `dudu list` / `search` only ever see the current persona's dialogs.
 * - `dudu read` on another persona's dialog is refused — the refusal is
 *   indistinguishable from "unknown dialog" (no existence/content leak).
 * - The `dudu` tool is hidden in incognito sessions (same registration path
 *   the app uses: assembleAgentTools + the incognito blocklist backstop).
 * - Same-persona list/read behavior is unchanged.
 *
 * Uses node:test + tsx. All modules under test are PURE (no React Native in
 * the import chain). local-agent.ts itself can't load under tsx (pre-existing:
 * its import graph pulls react-native Flow syntax) — its wiring is a
 * one-line call to createIsolatedDuduDeps, verified by tsc + review.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isBlockedInIncognito } from "../src/api-groups/incognito-guard.js";
import type { LocalTool } from "../src/api-groups/local-tools.js";
import { assembleAgentTools } from "../src/api-groups/tool-assembly.js";
import {
  type CrossDialogStorage,
  createIsolatedDuduDeps,
  DEFAULT_PERSONA_ID,
  setDialogName,
} from "../src/chat/cross-dialog.js";
import { createAgentCliTools } from "../src/mcp/agent-cli.js";

const PERSONA_A = "persona-a";
const PERSONA_B = "persona-b";
const A_SECRET = "A 的独家机密内容";

type FakeStorage = CrossDialogStorage & { __map: Map<string, string> };

function fakeStorage(): FakeStorage {
  const map = new Map<string, string>();
  return {
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => {
      map.set(k, v);
    },
    getAllKeys: async () => [...map.keys()],
    __map: map,
  };
}

function seedHistory(
  storage: FakeStorage,
  threadId: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): void {
  storage.__map.set(
    `dudu.local-chat.${threadId}.v1`,
    JSON.stringify(messages.map((m, i) => ({ id: `m${i}`, ...m }))),
  );
}

async function seed(s: FakeStorage): Promise<void> {
  seedHistory(s, "a1", [
    { role: "user", content: "A 的问题" },
    { role: "assistant", content: A_SECRET },
  ]);
  await setDialogName(s, "a1", "A 秘密", PERSONA_A);
  seedHistory(s, "b1", [
    { role: "user", content: "B 的问题" },
    { role: "assistant", content: "B 的回答" },
  ]);
  await setDialogName(s, "b1", "B 工作", PERSONA_B);
  seedHistory(s, "b2", [{ role: "user", content: "B 的闲聊" }]);
  await setDialogName(s, "b2", "B 生活", PERSONA_B);
  seedHistory(s, "d0", [{ role: "user", content: "默认人设的对话" }]);
  await setDialogName(s, "d0", "默认对话"); // DEFAULT_PERSONA_ID
}

describe("dudu deps persona isolation (B5)", () => {
  it("list returns ONLY the current persona's dialogs", async () => {
    const s = fakeStorage();
    await seed(s);
    const deps = createIsolatedDuduDeps(s, async () => PERSONA_B);
    const dialogs = await deps.listDialogs();
    const ids = dialogs.map((d) => d.id).sort();
    assert.deepEqual(ids, ["b1", "b2"]);
  });

  it("search never matches another persona's dialogs", async () => {
    const s = fakeStorage();
    await seed(s);
    const deps = createIsolatedDuduDeps(s, async () => PERSONA_B);
    assert.deepEqual(await deps.searchDialogs("秘密"), []);
    const hits = await deps.searchDialogs("工作");
    assert.deepEqual(
      hits.map((d) => d.id),
      ["b1"],
    );
  });

  it("read works normally for the same persona's dialog (id or name)", async () => {
    const s = fakeStorage();
    await seed(s);
    const deps = createIsolatedDuduDeps(s, async () => PERSONA_B);
    const byId = await deps.readDialog("b1", 20);
    assert.ok(byId.includes("B 的回答"), "same-persona read by id unchanged");
    const byName = await deps.readDialog("B 工作", 20);
    assert.ok(byName.includes("B 的回答"), "same-persona read by name works");
  });

  it("read on another persona's dialog is refused with no leak", async () => {
    const s = fakeStorage();
    await seed(s);
    const deps = createIsolatedDuduDeps(s, async () => PERSONA_B);
    await assert.rejects(
      () => deps.readDialog("a1", 20),
      (err: unknown) => {
        const msg = String((err as Error)?.message ?? err);
        assert.ok(!msg.includes(A_SECRET), "must not leak dialog content");
        assert.ok(
          !msg.includes("different persona"),
          "must not confirm existence via persona-mismatch wording",
        );
        assert.ok(!msg.includes(PERSONA_A), "must not leak the owner's persona id");
        assert.match(msg, /No dialog "a1" found among this persona's dialogs\./);
        return true;
      },
    );
  });

  it("read on an unknown dialog looks identical to a foreign one", async () => {
    const s = fakeStorage();
    await seed(s);
    const deps = createIsolatedDuduDeps(s, async () => PERSONA_B);
    await assert.rejects(
      () => deps.readDialog("nope", 20),
      /No dialog "nope" found among this persona's dialogs\./,
    );
  });

  it("ambiguous names are refused, not guessed", async () => {
    const s = fakeStorage();
    await seed(s);
    seedHistory(s, "b3", [{ role: "user", content: "重名" }]);
    await setDialogName(s, "b3", "B 工作", PERSONA_B);
    const deps = createIsolatedDuduDeps(s, async () => PERSONA_B);
    await assert.rejects(() => deps.readDialog("B 工作", 20), /Multiple dialogs named/);
  });

  it("personaId is resolved lazily — switches take effect immediately", async () => {
    const s = fakeStorage();
    await seed(s);
    let current = PERSONA_B;
    const deps = createIsolatedDuduDeps(s, async () => current);
    assert.deepEqual((await deps.listDialogs()).map((d) => d.id).sort(), ["b1", "b2"]);
    current = PERSONA_A; // switch mid-session: no stale capture allowed
    assert.deepEqual(
      (await deps.listDialogs()).map((d) => d.id),
      ["a1"],
    );
  });

  it("falls back to the default persona when none is selected", async () => {
    const s = fakeStorage();
    await seed(s);
    const deps = createIsolatedDuduDeps(s, async () => DEFAULT_PERSONA_ID);
    assert.deepEqual(
      (await deps.listDialogs()).map((d) => d.id),
      ["d0"],
    );
  });
});

describe("dudu tool wiring (B5)", () => {
  it("the dudu tool exposes list/search/read through the isolated deps", async () => {
    const s = fakeStorage();
    await seed(s);
    const [tool] = createAgentCliTools(createIsolatedDuduDeps(s, async () => PERSONA_B));
    assert.equal(tool.name, "dudu");
    const list = await tool.run({ command: "list" }, {} as never);
    assert.ok(list.includes("b1") && list.includes("b2"), "lists own dialogs");
    assert.ok(!list.includes("a1"), "never lists another persona's dialog");
    await assert.rejects(() => tool.run({ command: "read", arg: "a1" }, {} as never), /No dialog/);
  });
});

describe("dudu hidden in incognito (B5)", () => {
  function fakeTool(name: string): LocalTool {
    return {
      name,
      description: `${name} description`,
      parameters: { type: "object", properties: {} },
      run: async () => `ok:${name}`,
    };
  }

  it("isBlockedInIncognito refuses the dudu tool", () => {
    assert.equal(isBlockedInIncognito("dudu"), true);
  });

  it("assembleAgentTools drops dudu from the registry in incognito, keeps it otherwise", async () => {
    const baseTools = [fakeTool("dudu"), fakeTool("time_now")];
    const incognito = await assembleAgentTools({
      baseTools,
      externalSupplied: true,
      isIncognito: true,
      loadExternalTools: async () => [],
      applyDescOverrides: async (t) => t,
    });
    assert.ok(
      !incognito.effectiveTools.some((t) => t.name === "dudu"),
      "dudu must not reach the prompt/registry in incognito",
    );
    assert.ok(incognito.effectiveTools.some((t) => t.name === "time_now"));

    const normal = await assembleAgentTools({
      baseTools,
      externalSupplied: true,
      isIncognito: false,
      loadExternalTools: async () => [],
      applyDescOverrides: async (t) => t,
    });
    assert.ok(
      normal.effectiveTools.some((t) => t.name === "dudu"),
      "dudu stays available outside incognito",
    );
  });
});
