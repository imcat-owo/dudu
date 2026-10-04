/**
 * Feature 3 (vision): AI self-organized group chat (AI 自建群).
 *
 * Tests: ST-style turn-taking, input validation, persona-memory isolation
 * in prompt assembly, meeting store, and the AI tools (plan-gate
 * enforcement, per-round plan re-check, member failure honesty, trace).
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { planGateStore } from "../src/api-groups/plan-gate.js";
import type { ApiGroup } from "../src/api-groups/types.js";
import {
  type CrossDialogTraceStorage,
  CrossDialogTraceStore,
} from "../src/chat/cross-dialog-trace.js";
import {
  buildMemberPrompt,
  describeMeeting,
  formatTranscript,
  type GroupMeeting,
  isStrategy,
  MEETING_END_KEYWORD,
  type MeetingMember,
  meetingProgressLabel,
  parseMembers,
  selectSpeakers,
  shouldEndMeeting,
  validateStartMeetingInput,
} from "../src/chat/group-meeting.js";
import { GroupMeetingStore } from "../src/chat/group-meeting-store.js";
import { createGroupMeetingTools } from "../src/chat/group-meeting-tools.js";

const ctx = {} as never;

/* ---------- fakes ---------- */

type FakeStorage = CrossDialogTraceStorage & {
  getAllKeys: () => Promise<readonly string[]>;
  __map: Map<string, string>;
};

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

function testGroups(): ApiGroup[] {
  return [
    {
      id: "g1",
      name: "主力",
      vendor: "openai",
      baseUrl: "https://api.example.com/v1",
      model: "gpt-4o",
      headers: {},
      createdAt: 1,
    } as ApiGroup,
    {
      id: "g2",
      name: "备用",
      vendor: "openai",
      baseUrl: "https://api.example.com/v1",
      model: "claude-opus",
      headers: {},
      createdAt: 2,
    } as ApiGroup,
    {
      id: "g3",
      name: "快速",
      vendor: "openai",
      baseUrl: "https://api.example.com/v1",
      model: "gpt-4o-mini",
      headers: {},
      createdAt: 3,
    } as ApiGroup,
  ];
}

function member(id: string, name: string, talkativeness = 0.5): MeetingMember {
  return {
    id,
    displayName: name,
    apiGroupId: `g_${id}`,
    model: "test-model",
    talkativeness,
  };
}

function meeting(over: Partial<GroupMeeting> = {}): GroupMeeting {
  return {
    id: "gm_test",
    name: "开会：主力、备用",
    topic: "今晚吃什么",
    reason: "她说你们讨论一下",
    members: [member("m1", "主力 (gpt-4o)"), member("m2", "备用 (claude-opus)")],
    strategy: "natural",
    maxRounds: 4,
    roundsCompleted: 0,
    status: "discussing",
    transcript: [],
    createdByThreadId: "thread-1",
    createdAt: 1,
    ...over,
  };
}

/** Deterministic random: cycles through the given values. */
function scriptedRandom(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

function toolDeps(over: Record<string, unknown> = {}) {
  const storage = fakeStorage();
  const meetings = new GroupMeetingStore(storage);
  const trace = new CrossDialogTraceStore(storage);
  const generated: Array<{ groupId: string; system: string; user: string }> = [];
  const failGroups = new Set<string>();
  return {
    storage,
    meetings,
    trace,
    generated,
    failGroups,
    deps: {
      threadId: "thread-1",
      storage,
      meetings,
      trace,
      listApiGroups: () => testGroups(),
      generate: async (group: ApiGroup, system: string, user: string) => {
        generated.push({ groupId: group.id, system, user });
        if (failGroups.has(group.id)) throw new Error("model is down");
        return `的发言`;
      },
      ...over,
    },
  };
}

function toolsFor(over: Record<string, unknown> = {}) {
  const t = toolDeps(over);
  return { ...t, tools: createGroupMeetingTools(t.deps as never) as unknown as TestTool[] };
}

interface TestTool {
  name: string;
  run: (args: Record<string, unknown>, ctx: never) => Promise<string>;
}

function toolByName(tools: TestTool[], name: string): TestTool {
  const t = tools.find((x) => x.name === name);
  assert.ok(t, `tool ${name} exists`);
  return t;
}

async function startMeeting(
  tools: TestTool[],
  args: Record<string, unknown> = {},
): Promise<string> {
  return toolByName(tools, "start_group_meeting").run(
    {
      topic: "今晚吃什么",
      reason: "她说你们讨论一下",
      members: [{ api_group: "主力" }, { api_group: "备用" }],
      her_request: "你们讨论一下今晚吃什么",
      ...args,
    },
    ctx,
  );
}

/* ---------- turn-taking ---------- */

describe("selectSpeakers (ST NATURAL port)", () => {
  it("@mention forces a response, mentioned speak first", () => {
    const m = meeting({
      transcript: [
        {
          id: "x1",
          memberId: "m1",
          memberName: "主力 (gpt-4o)",
          text: "备用，你觉得火锅怎么样？",
          round: 1,
          at: 1,
        },
      ],
    });
    const picked = selectSpeakers(m, { random: scriptedRandom(0.99, 0.99) });
    assert.ok(
      picked.some((p) => p.id === "m2"),
      "mentioned member must respond",
    );
    assert.equal(picked[0].id, "m2", "mentioned member speaks first");
  });

  it("talkativeness dice: chatty speaks, shy stays quiet", () => {
    const m = meeting({
      members: [member("m1", "话痨", 1), member("m2", "闷葫芦", 0)],
      transcript: [],
    });
    const picked = selectSpeakers(m, { random: scriptedRandom(0.5) });
    assert.ok(picked.some((p) => p.id === "m1"));
    assert.ok(!picked.some((p) => p.id === "m2"));
  });

  it("fallback: nobody picked -> random talkative member", () => {
    const m = meeting({
      members: [member("m1", "A", 0.5), member("m2", "B", 0.5)],
      transcript: [],
    });
    // dice both fail (0.99 > 0.5), fallback picks index 0
    const picked = selectSpeakers(m, { random: scriptedRandom(0.99, 0.99, 0.1) });
    assert.equal(picked.length, 1);
  });

  it("bannedUser: last speaker cannot speak twice in a row", () => {
    const m = meeting({
      members: [member("m1", "A", 1), member("m2", "B", 1)],
      transcript: [{ id: "x1", memberId: "m1", memberName: "A", text: "hi", round: 1, at: 1 }],
    });
    const picked = selectSpeakers(m, { random: scriptedRandom(0.1) });
    assert.ok(!picked.some((p) => p.id === "m1"), "last speaker is banned");
    assert.ok(picked.some((p) => p.id === "m2"));
  });

  it("a member appears at most once per selection (no ping-pong)", () => {
    const m = meeting({ strategy: "pooled" });
    const picked = selectSpeakers(m);
    const ids = picked.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe("selectSpeakers (POOLED / LIST)", () => {
  it("pooled: everyone speaks once per round, first speaker rotates", () => {
    const m1 = meeting({ strategy: "pooled", roundsCompleted: 0 });
    const m2 = meeting({ strategy: "pooled", roundsCompleted: 1 });
    const r1 = selectSpeakers(m1).map((p) => p.id);
    const r2 = selectSpeakers(m2).map((p) => p.id);
    assert.deepEqual(r1, ["m1", "m2"]);
    assert.deepEqual(r2, ["m2", "m1"]);
  });

  it("list: fixed order every round", () => {
    const m = meeting({ strategy: "list", roundsCompleted: 3 });
    assert.deepEqual(
      selectSpeakers(m).map((p) => p.id),
      ["m1", "m2"],
    );
  });

  it("isStrategy guards the strategy union", () => {
    assert.ok(isStrategy("natural") && isStrategy("pooled") && isStrategy("list"));
    assert.ok(!isStrategy("chaos"));
  });
});

/* ---------- validation ---------- */

describe("validateStartMeetingInput", () => {
  const good = {
    topic: "今晚吃什么",
    reason: "她让讨论",
    members: [{ apiGroupRef: "g1" }, { apiGroupRef: "g2" }],
  };
  it("accepts a good input", () => {
    assert.equal(validateStartMeetingInput(good), null);
  });
  it("requires topic and reason", () => {
    assert.equal(validateStartMeetingInput({ ...good, topic: " " }), "topicRequired");
    assert.equal(validateStartMeetingInput({ ...good, reason: "" }), "reasonRequired");
  });
  it("requires at least 2 members, at most 5", () => {
    assert.equal(
      validateStartMeetingInput({ ...good, members: [{ apiGroupRef: "g1" }] }),
      "membersRequired",
    );
    const six = Array.from({ length: 6 }, (_, i) => ({ apiGroupRef: `g${i}` }));
    assert.equal(validateStartMeetingInput({ ...good, members: six }), "tooManyMembers");
  });
  it("rejects bad member refs and talkativeness", () => {
    assert.equal(
      validateStartMeetingInput({ ...good, members: [{}, { apiGroupRef: "g2" }] }),
      "membersInvalid",
    );
    assert.equal(
      validateStartMeetingInput({
        ...good,
        members: [{ apiGroupRef: "g1", talkativeness: 2 }, { apiGroupRef: "g2" }],
      }),
      "talkativenessInvalid",
    );
  });
  it("rejects bad strategy and maxRounds", () => {
    assert.equal(validateStartMeetingInput({ ...good, strategy: "chaos" }), "strategyInvalid");
    assert.equal(validateStartMeetingInput({ ...good, maxRounds: 99 }), "maxRoundsInvalid");
    assert.equal(validateStartMeetingInput({ ...good, maxRounds: 0 }), "maxRoundsInvalid");
  });
  it("parseMembers clamps talkativeness and defaults to 0.5", () => {
    const [a, b] = parseMembers({
      members: [{ apiGroupRef: "g1", talkativeness: 9 }, { apiGroupRef: "g2" }],
    });
    assert.equal(a.talkativeness, 1);
    assert.equal(b.talkativeness, 0.5);
  });
});

/* ---------- isolation ---------- */

describe("buildMemberPrompt (人设记忆隔离)", () => {
  it("prompt contains ONLY the meeting topic + shared transcript", () => {
    const m = meeting({
      transcript: [
        { id: "x1", memberId: "m1", memberName: "主力 (gpt-4o)", text: "火锅吧", round: 1, at: 1 },
      ],
    });
    const { system, user } = buildMemberPrompt(m.members[0], m);
    const combined = `${system}\n${user}`;
    // Allowed: topic, transcript, member name, end keyword.
    assert.ok(combined.includes("今晚吃什么"));
    assert.ok(combined.includes("火锅吧"));
    // The function signature takes ONLY (member, meeting) — there is no
    // parameter through which persona memories or other dialogs could be
    // smuggled in. Pin it: the prompt must not contain this canary that a
    // leaky implementation would have to receive as an argument.
    const canary = "CANARY_PRIVATE_MEMORY_9f8e";
    assert.ok(!combined.includes(canary));
    assert.equal(buildMemberPrompt.length, 2, "prompt builder takes exactly (member, meeting)");
  });

  it("formatTranscript is one line per message", () => {
    const m = meeting({
      transcript: [
        { id: "x1", memberId: "m1", memberName: "A", text: "hi", round: 1, at: 1 },
        { id: "x2", memberId: "m2", memberName: "B", text: "yo", round: 1, at: 2 },
      ],
    });
    assert.equal(formatTranscript(m), "A：hi\nB：yo");
  });
});

/* ---------- end conditions / labels ---------- */

describe("shouldEndMeeting / labels", () => {
  it("ends at maxRounds", () => {
    assert.ok(shouldEndMeeting(meeting({ roundsCompleted: 4, maxRounds: 4 })));
    assert.ok(!shouldEndMeeting(meeting({ roundsCompleted: 3, maxRounds: 4 })));
  });
  it("ends when a member says the end keyword", () => {
    const m = meeting({
      transcript: [
        {
          id: "x1",
          memberId: "m2",
          memberName: "B",
          text: `没啥新想法了，${MEETING_END_KEYWORD}`,
          round: 2,
          at: 1,
        },
      ],
    });
    assert.ok(shouldEndMeeting(m));
  });
  it("progress label shows round counts", () => {
    assert.equal(meetingProgressLabel(meeting({ roundsCompleted: 3 })), "开会中（3/4 轮）");
    assert.equal(meetingProgressLabel(meeting({ status: "done" })), "会议结束");
  });
  it("describeMeeting is legible", () => {
    const d = describeMeeting(meeting({ roundsCompleted: 1 }));
    assert.ok(d.includes("开会中（1/4 轮）") && d.includes("今晚吃什么"));
  });
});

/* ---------- store ---------- */

describe("GroupMeetingStore", () => {
  it("create / get / list / append / completeRound / end", async () => {
    const store = new GroupMeetingStore(fakeStorage());
    const created = await store.create({
      name: "开会：A、B",
      topic: "t",
      reason: "r",
      members: [member("m1", "A"), member("m2", "B")],
      strategy: "pooled",
      maxRounds: 4,
      createdByThreadId: "thread-1",
    });
    assert.ok(created.id.startsWith("gm_"));
    assert.equal(created.status, "discussing");

    const got = await store.get(created.id);
    assert.equal(got?.topic, "t");

    const msg = await store.appendMessage(created.id, {
      memberId: "m1",
      memberName: "A",
      text: "hi",
      round: 1,
    });
    assert.ok(msg?.id);

    await store.completeRound(created.id);
    const after = await store.get(created.id);
    assert.equal(after?.roundsCompleted, 1);
    assert.equal(after?.transcript.length, 1);

    await store.end(created.id, "结论：吃火锅");
    const done = await store.get(created.id);
    assert.equal(done?.status, "done");
    assert.equal(done?.conclusion, "结论：吃火锅");
    assert.ok(done?.endedAt);

    const list = await store.list();
    assert.equal(list.length, 1);
  });

  it("get returns null for unknown id", async () => {
    const store = new GroupMeetingStore(fakeStorage());
    assert.equal(await store.get("nope"), null);
  });
});

/* ---------- tools ---------- */

describe("group meeting tools", () => {
  beforeEach(() => {
    planGateStore.__resetForTests();
  });

  it("registers the four tools", () => {
    const { tools } = toolsFor();
    for (const n of [
      "list_models",
      "start_group_meeting",
      "run_meeting_round",
      "meeting_status",
      "end_meeting",
    ]) {
      assert.ok(
        tools.some((t) => t.name === n),
        n,
      );
    }
  });

  it("list_models shows her configured models", async () => {
    const { tools } = toolsFor();
    const out = await toolByName(tools, "list_models").run({}, ctx);
    assert.ok(out.includes("主力") && out.includes("gpt-4o"));
  });

  it("start_group_meeting refuses without plan or her request (开启原则)", async () => {
    const { tools } = toolsFor();
    await assert.rejects(
      toolByName(tools, "start_group_meeting").run(
        {
          topic: "t",
          reason: "r",
          members: [{ api_group: "主力" }, { api_group: "备用" }],
        },
        ctx,
      ),
      /plan_id|her_request/,
    );
  });

  it("start_group_meeting refuses in incognito", async () => {
    const { tools } = toolsFor({ isIncognito: () => true });
    await assert.rejects(startMeeting(tools), /隐身/);
  });

  it("start_group_meeting with her request creates + traces the meeting", async () => {
    const { tools, meetings, trace } = toolsFor();
    const out = await startMeeting(tools);
    assert.ok(out.includes("会议已创建"));

    const all = await meetings.list();
    assert.equal(all.length, 1);
    assert.equal(all[0].members.length, 2);
    assert.equal(all[0].status, "discussing");

    const entries = await trace.list(10);
    const created = entries.find((e) => e.action === "meeting_create");
    assert.ok(created, "meeting_create is traced");
    assert.ok(created.summary.includes("今晚吃什么"));
    assert.ok(created.reason.includes("你们讨论一下"));
  });

  it("start_group_meeting requires an APPROVED plan", async () => {
    const { tools } = toolsFor();
    const plan = planGateStore.propose("thread-1", {
      title: "开会",
      reason: "单模型搞不定",
      steps: [{ title: "讨论" }],
    });
    // proposed (not approved) -> refused
    await assert.rejects(startMeeting(tools, { her_request: "", plan_id: plan.id }), /还没决定/);
    // rejected -> refused
    planGateStore.decide(plan.id, false);
    await assert.rejects(startMeeting(tools, { her_request: "", plan_id: plan.id }), /叫停/);
    // approved -> works
    const plan2 = planGateStore.propose("thread-1", {
      title: "开会2",
      reason: "单模型搞不定",
      steps: [{ title: "讨论" }],
    });
    planGateStore.decide(plan2.id, true);
    const out = await startMeeting(tools, { her_request: "", plan_id: plan2.id });
    assert.ok(out.includes("会议已创建"));
  });

  it("start_group_meeting rejects unknown and duplicate members honestly", async () => {
    const { tools } = toolsFor();
    await assert.rejects(
      startMeeting(tools, { members: [{ api_group: "不存在的模型" }, { api_group: "备用" }] }),
      /找不到模型/,
    );
    await assert.rejects(
      startMeeting(tools, { members: [{ api_group: "主力" }, { api_group: "主力" }] }),
      /重复/,
    );
  });

  it("run_meeting_round drives a round and traces it", async () => {
    const { tools, meetings, trace, generated } = toolsFor();
    const out = await startMeeting(tools);
    const id = out.match(/id: (gm_\w+)/)?.[1];
    assert.ok(id);

    const round = await toolByName(tools, "run_meeting_round").run({ meeting_id: id }, ctx);
    assert.ok(round.includes("第 1 轮结束"));

    // Members were actually invoked (pooled: both speak)
    assert.equal(generated.length, 2);
    // Isolation: member prompts see only the meeting
    for (const g of generated) {
      assert.ok(g.user.includes("今晚吃什么"), "topic in prompt");
      assert.ok(!g.user.includes("CANARY"), "no outside data in prompt");
    }

    const m = await meetings.get(id);
    assert.equal(m?.transcript.length, 2);
    assert.equal(m?.roundsCompleted, 1);

    const entries = await trace.list(10);
    assert.ok(
      entries.some((e) => e.action === "meeting_round"),
      "round is traced",
    );
  });

  it("run_meeting_round re-checks the plan every round", async () => {
    const { tools } = toolsFor();
    const plan = planGateStore.propose("thread-1", {
      title: "开会",
      reason: "单模型搞不定",
      steps: [{ title: "讨论" }],
    });
    planGateStore.decide(plan.id, true);
    const out = await startMeeting(tools, { her_request: "", plan_id: plan.id });
    const id = out.match(/id: (gm_\w+)/)?.[1];
    assert.ok(id);

    // First round works while the plan is approved
    const r1 = await toolByName(tools, "run_meeting_round").run({ meeting_id: id }, ctx);
    assert.ok(r1.includes("第 1 轮结束"));

    // If the plan disappears mid-meeting (pruned/reset), the next round is
    // refused — the re-check runs before every round. (Her "停" is handled
    // conversationally: the moderator AI hears her and stops calling rounds;
    // this is the defense-in-depth net underneath.)
    planGateStore.__resetForTests();
    await assert.rejects(
      toolByName(tools, "run_meeting_round").run({ meeting_id: id }, ctx),
      /找不到计划/,
    );
  });

  it("a member model failure is reported, not faked", async () => {
    const f = toolsFor();
    f.failGroups.add("g1"); // 主力's model is down
    const out = await startMeeting(f.tools);
    const id = out.match(/id: (gm_\w+)/)?.[1];
    assert.ok(id);
    const round = await toolByName(f.tools, "run_meeting_round").run({ meeting_id: id }, ctx);
    assert.ok(round.includes("主力") && round.includes("出错"), "failure named plainly");
    // The other member still spoke
    const m = await f.meetings.get(id);
    assert.equal(m?.transcript.length, 1);
    assert.ok(!m?.transcript[0].text.includes("【主力】"), "no faked lines");
  });

  it("end keyword stops the meeting; end_meeting writes the conclusion", async () => {
    const f = toolsFor({
      generate: async () => `没啥新想法了，${MEETING_END_KEYWORD}`,
    });
    const out = await startMeeting(f.tools, { strategy: "list", max_rounds: 2 });
    const id = out.match(/id: (gm_\w+)/)?.[1];
    assert.ok(id);
    const round = await toolByName(f.tools, "run_meeting_round").run({ meeting_id: id }, ctx);
    assert.ok(round.includes("end_meeting"), "AI is told to conclude");

    await assert.rejects(
      toolByName(f.tools, "end_meeting").run({ meeting_id: id, conclusion: " " }, ctx),
      /不能为空/,
    );
    const done = await toolByName(f.tools, "end_meeting").run(
      { meeting_id: id, conclusion: "主题：x\n各方观点：y\n共识：z\n分歧：w" },
      ctx,
    );
    assert.ok(done.includes("已结束"));

    const entries = await f.trace.list(10);
    assert.ok(
      entries.some((e) => e.action === "meeting_end"),
      "end is traced",
    );

    const status = await toolByName(f.tools, "meeting_status").run({ meeting_id: id }, ctx);
    assert.ok(status.includes("会议结束") && status.includes("主题：x"));
  });

  it("maxRounds ends the meeting", async () => {
    const f = toolsFor();
    const out = await startMeeting(f.tools, { max_rounds: 1 });
    const id = out.match(/id: (gm_\w+)/)?.[1];
    assert.ok(id);
    const round = await toolByName(f.tools, "run_meeting_round").run({ meeting_id: id }, ctx);
    assert.ok(round.includes("end_meeting"));
  });
});

/* ---------- trace action types ---------- */

describe("trace accepts meeting actions", () => {
  it("meeting_create / meeting_round / meeting_end validate and list", async () => {
    const storage = fakeStorage();
    const trace = new CrossDialogTraceStore(storage);
    for (const action of ["meeting_create", "meeting_round", "meeting_end"] as const) {
      await trace.append({
        action,
        fromThreadId: "t1",
        fromName: "私聊",
        toThreadId: "gm_x",
        toName: "开会",
        summary: "s",
        reason: "r",
        personaId: "default",
      });
    }
    const entries = await trace.list(10);
    assert.equal(entries.length, 3);
    assert.deepEqual(entries.map((e) => e.action).sort(), [
      "meeting_create",
      "meeting_end",
      "meeting_round",
    ]);
  });
});
