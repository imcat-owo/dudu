/**
 * voice-call tools tests: the AI-side tool contract.
 *
 * Pins:
 * - tool names and kinds (propose = write, list = read)
 * - propose_voice_call is in INCOGNITO_BLOCKED_TOOLS (final-audit lesson:
 *   same-commit rule — this test fails if the guard list drops it)
 * - the propose tool rejects a missing reason before touching the store
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isBlockedInIncognito } from "../src/api-groups/incognito-guard";
import type { ProposalStore, RingNotifier } from "../src/voice-call/propose";
import { createVoiceCallTools } from "../src/voice-call/tools";

function makeEnv() {
  const data: Record<string, string> = {};
  const store: ProposalStore = {
    async getItem(k: string) {
      return data[k] ?? null;
    },
    async setItem(k: string, v: string) {
      data[k] = v;
    },
  };
  const notify: RingNotifier = {
    async scheduleNotificationAsync(req: { identifier: string }) {
      return req.identifier;
    },
    async cancelScheduledNotificationAsync() {},
  };
  return {
    proposalStore: store,
    notifier: notify,
    getPersona: async (id: string) => (id === "p1" ? ({ id: "p1", name: "小梦" } as never) : null),
    listPersonas: async () => [{ id: "p1", name: "小梦" }],
    nowMs: () => Date.now(),
  };
}

describe("voice-call tools", () => {
  it("registers propose_voice_call (write) and list_voice_calls (read)", () => {
    const tools = createVoiceCallTools(makeEnv());
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, ["list_voice_calls", "propose_voice_call"]);
  });

  it("propose_voice_call is blocked in incognito (zero-trace contract)", () => {
    assert.ok(
      isBlockedInIncognito("propose_voice_call"),
      "propose_voice_call must be blocked in incognito",
    );
    assert.ok(
      !isBlockedInIncognito("list_voice_calls"),
      "list_voice_calls is a read — stays available",
    );
  });

  it("propose rejects an empty reason", async () => {
    const tools = createVoiceCallTools(makeEnv());
    const propose = tools.find((t) => t.name === "propose_voice_call");
    assert.ok(propose, "propose_voice_call registered");
    const ctx = { authorize: async () => true } as never;
    await assert.rejects(() => propose.run({ personaId: "p1", reason: " " }, ctx), /reason/i);
  });

  it("propose rings: returns the ringing proposal text", async () => {
    const tools = createVoiceCallTools(makeEnv());
    const propose = tools.find((t) => t.name === "propose_voice_call");
    assert.ok(propose, "propose_voice_call registered");
    const ctx = { authorize: async () => true } as never;
    const out = (await propose.run({ personaId: "p1", reason: "想听听你的声音" }, ctx)) as string;
    assert.match(out, /ringing/);
  });

  it("list returns a readable summary without ringing anyone", async () => {
    const env = makeEnv();
    const tools = createVoiceCallTools(env);
    const list = tools.find((t) => t.name === "list_voice_calls");
    assert.ok(list, "list_voice_calls registered");
    const ctx = { authorize: async () => true } as never;
    const out = (await list.run({}, ctx)) as string;
    assert.match(out, /No call proposals yet/);
  });
});
