/**
 * Interactive story mode （互动故事） — AI tools.
 *
 * She and he co-write an interactive story inside a normal dialog:
 * he narrates in scenes, she steers with choices (A/B/C) or free
 * responses. The tools keep the story's structured state (scenes,
 * choices, bible) so long stories stay coherent — the narration itself
 * comes from the model reading the STORY MODE prompt section.
 *
 * Hard rules (her standing orders):
 * - A story belongs to ONE persona and ONE dialog. Never trap her:
 *   story_end / story_pause return the dialog to normal chat.
 * - The bible is visible to her (Our Space → 互动故事） — no secret
 *   retconning. She can delete any story or bible entry there.
 * - Write tools are in INCOGNITO_BLOCKED_TOOLS; story_list/story_show
 *   stay readable.
 *
 * manualId "story" pairs with src/manuals/story.ts (纸条机制）.
 */

import type { LocalTool, ToolContext } from "../api-groups/local-tools";
import { ToolError } from "../api-groups/local-tools";
import type { StoryStore } from "./store";
import type { Story, StoryScene } from "./types";
import { latestScene, newSceneId, nextSceneSeq, pendingChoiceScene } from "./types";

export interface StoryToolEnv {
  storyStore: StoryStore;
  /** The dialog this tool call runs in — new stories bind here. */
  currentThreadId(): string;
  getPersona(personaId: string): Promise<{ id: string; name: string } | null>;
  nowMs(): number;
}

function strArg(args: Record<string, unknown>, name: string): string {
  const v = args[name];
  return typeof v === "string" ? v : "";
}

function numArg(args: Record<string, unknown>, name: string, fallback: number): number {
  const v = args[name];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function boolArg(args: Record<string, unknown>, name: string, fallback: boolean): boolean {
  const v = args[name];
  return typeof v === "boolean" ? v : fallback;
}

function strArrArg(args: Record<string, unknown>, name: string): string[] {
  const v = args[name];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

function brief(s: Story): string {
  const status = s.status === "active" ? "进行中" : s.status === "paused" ? "已暂停" : "已完结";
  return `- 《${s.title}》[${s.id}] ${status} · 第${s.currentChapter}章 · ${s.scenes.length}幕 · 人物${s.bible.characters.length}/地点${s.bible.places.length}/事件${s.bible.events.length}`;
}

export function createStoryTools(env: StoryToolEnv): LocalTool[] {
  const run = async (_ctx: ToolContext, fn: () => Promise<string>): Promise<string> => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ToolError) throw e;
      throw new ToolError(e instanceof Error ? e.message : "Story tool failed.");
    }
  };

  async function needStory(storyId: string): Promise<Story> {
    const id = storyId.trim();
    if (!id) throw new ToolError("storyId is required (see story_list).");
    const s = await env.storyStore.get(id);
    if (!s) throw new ToolError(`Story not found: ${id}.`);
    return s;
  }

  async function needActive(storyId: string): Promise<Story> {
    const s = await needStory(storyId);
    if (s.status !== "active") {
      throw new ToolError(
        `Story 《${s.title}》 is ${s.status} — resume it with story_resume before adding scenes or choices.`,
      );
    }
    return s;
  }

  return [
    {
      name: "story_start",
      description:
        "Start an interactive story with her （互动故事）: she said yes to co-writing a story, or asked 「我们来编个故事」. " +
        "Creates the story bound to THIS dialog and puts you in STORY MODE (the story section appears in your prompt). " +
        "Give it a title and the premise you agreed on (or your proposed premise — tell her the premise first and only call this after she agrees). " +
        "One active story per dialog: if this dialog already has one, end or pause it first. " +
        "After this returns, narrate scene 1 yourself in your next reply — do NOT wait.",
      parameters: {
        type: "object",
        properties: {
          personaId: { type: "string", description: "Persona id (the voice telling the story)." },
          title: { type: "string", description: "Story title, e.g. 「雾岛灯塔」." },
          premise: {
            type: "string",
            description: "The agreed premise in one or two sentences.",
          },
        },
        required: ["personaId", "title", "premise"],
        additionalProperties: false,
      },
      manualId: "story",
      run: (args, ctx) =>
        run(ctx, async () => {
          const personaId = strArg(args, "personaId");
          const title = strArg(args, "title");
          const premise = strArg(args, "premise");
          if (!personaId) throw new ToolError("personaId is required.");
          if (!title.trim()) throw new ToolError("title is required.");
          if (!premise.trim())
            throw new ToolError("premise is required — agree on it with her first.");
          const persona = await env.getPersona(personaId).catch(() => null);
          if (!persona) throw new ToolError(`Persona not found: ${personaId}.`);
          const threadId = env.currentThreadId();
          const existing = await env.storyStore.findByThread(threadId);
          if (existing) {
            throw new ToolError(
              `This dialog already has 《${existing.title}》 (${existing.status}). End it (story_end) or pause it (story_pause) before starting a new one.`,
            );
          }
          const story = await env.storyStore.create(
            { personaId, threadId, title, premise },
            env.nowMs(),
          );
          if (!story) throw new ToolError("Could not create the story — invalid input.");
          return (
            `Story 《${story.title}》 started [${story.id}]. STORY MODE is now on for this dialog. ` +
            `Narrate scene 1 in your next reply: set the scene vividly, end with choices (A/B/C) or an open question, ` +
            `then call story_scene_add with the summary. Keep the bible updated with story_bible_update as the story grows.`
          );
        }),
    },
    {
      name: "story_list",
      description:
        "List interactive stories （互动故事） for a persona: title, status, chapter/scene progress. Use when she asks what stories you have together.",
      parameters: {
        type: "object",
        properties: {
          personaId: { type: "string", description: "Persona id." },
          includeEnded: {
            type: "boolean",
            description: "Include finished stories. Default false.",
          },
        },
        required: ["personaId"],
        additionalProperties: false,
      },
      manualId: "story",
      run: (args, ctx) =>
        run(ctx, async () => {
          const personaId = strArg(args, "personaId");
          if (!personaId) throw new ToolError("personaId is required.");
          const stories = await env.storyStore.list(
            personaId,
            boolArg(args, "includeEnded", false),
          );
          if (stories.length === 0)
            return "No stories yet. Suggest one when the moment feels right — never force it.";
          return stories.map(brief).join("\n");
        }),
    },
    {
      name: "story_show",
      description:
        "Show a story in full （互动故事）: premise, progress, scenes so far, and the whole story bible. Use when she asks 「我们的故事讲到哪了」 or wants to review the bible.",
      parameters: {
        type: "object",
        properties: {
          storyId: { type: "string", description: "Story id (see story_list)." },
        },
        required: ["storyId"],
        additionalProperties: false,
      },
      manualId: "story",
      run: (args, ctx) =>
        run(ctx, async () => {
          const s = await needStory(strArg(args, "storyId"));
          const out: string[] = [
            `《${s.title}》— ${s.premise}`,
            `进度：第 ${s.currentChapter} 章，${s.scenes.length} 幕，状态：${s.status === "active" ? "进行中" : s.status === "paused" ? "已暂停" : "已完结"}`,
          ];
          if (s.bible.characters.length > 0) {
            out.push("人物：");
            for (const c of s.bible.characters)
              out.push(`- ${c.name}${c.desc ? `：${c.desc}` : ""}`);
          }
          if (s.bible.places.length > 0) {
            out.push("地点：");
            for (const p of s.bible.places) out.push(`- ${p.name}${p.desc ? `：${p.desc}` : ""}`);
          }
          if (s.bible.events.length > 0) {
            out.push("关键事件：");
            for (const e of s.bible.events) out.push(`- ${e.text}`);
          }
          const tail = s.scenes.slice(-3);
          if (tail.length > 0) {
            out.push("最近的幕：");
            for (const sc of tail) out.push(`- 第${sc.chapter}章第${sc.seq}幕：${sc.summary}`);
          }
          return out.join("\n");
        }),
    },
    {
      name: "story_scene_add",
      description:
        "Record a narrated scene （互动故事）. Call ONCE after you narrate each scene: the summary (what happened, 1-3 sentences), " +
        'and the choices you offered her (e.g. ["推开那扇门", "先回头看看"]) — empty array when you asked an open question instead. ' +
        "This is the story's memory: without it, you'll forget the scene by chapter 3.",
      parameters: {
        type: "object",
        properties: {
          storyId: { type: "string", description: "Story id." },
          summary: { type: "string", description: "What happened in this scene, 1-3 sentences." },
          chapter: {
            type: "number",
            description: "Chapter number. Defaults to the story's current chapter.",
          },
          offeredChoices: {
            type: "array",
            items: { type: "string" },
            description: "Choice labels you offered (A/B/C in order). Empty = open question.",
          },
        },
        required: ["storyId", "summary"],
        additionalProperties: false,
      },
      manualId: "story",
      run: (args, ctx) =>
        run(ctx, async () => {
          const story = await needActive(strArg(args, "storyId"));
          const summary = strArg(args, "summary");
          if (!summary.trim())
            throw new ToolError("summary is required — what happened in this scene?");
          const pending = pendingChoiceScene(story);
          if (pending) {
            throw new ToolError(
              `She hasn't picked yet for the last scene (choices ${pending.offeredChoices.map((c) => c.id).join("/")}). ` +
                `Record her pick with story_choose first — don't narrate past her.`,
            );
          }
          const chapter = Math.max(1, Math.floor(numArg(args, "chapter", story.currentChapter)));
          const labels = strArrArg(args, "offeredChoices").slice(0, 5);
          const now = env.nowMs();
          const scene: StoryScene = {
            id: newSceneId(now),
            chapter,
            seq: nextSceneSeq(story, chapter),
            summary: summary.trim(),
            offeredChoices: labels.map((label, i) => ({
              id: String.fromCharCode(65 + i),
              label: label.trim(),
            })),
            chosenChoiceId: null,
            freeNote: "",
            at: now,
          };
          const updated = await env.storyStore.update(story.id, now, (s) => ({
            ...s,
            currentChapter: Math.max(s.currentChapter, chapter),
            scenes: [...s.scenes, scene],
          }));
          if (!updated) throw new ToolError("Could not save the scene.");
          return `Scene recorded: 第${chapter}章第${scene.seq}幕. ${labels.length > 0 ? `Choices offered: ${labels.map((l, i) => `${String.fromCharCode(65 + i)}「${l}」`).join(" / ")}.` : "Open question — her move."}`;
        }),
    },
    {
      name: "story_choose",
      description:
        'Record her story choice （互动故事）. When she picks a choice (says 「选B」 or taps a choice chip), call this FIRST with the choice id ("A"/"B"/"C"), ' +
        "then continue the story honoring her pick. Fails when there's no pending choice — then just respond to her freely.",
      parameters: {
        type: "object",
        properties: {
          storyId: { type: "string", description: "Story id." },
          choiceId: { type: "string", description: 'The choice she picked: "A", "B", "C"…' },
        },
        required: ["storyId", "choiceId"],
        additionalProperties: false,
      },
      manualId: "story",
      run: (args, ctx) =>
        run(ctx, async () => {
          const story = await needActive(strArg(args, "storyId"));
          const choiceId = strArg(args, "choiceId").trim().toUpperCase();
          const pending = pendingChoiceScene(story);
          if (!pending) {
            throw new ToolError(
              "No pending choice in this story — she answered freely; just continue naturally.",
            );
          }
          const choice = pending.offeredChoices.find((c) => c.id === choiceId);
          if (!choice) {
            throw new ToolError(
              `Choice ${choiceId || "(empty)"} wasn't offered. Offered: ${pending.offeredChoices.map((c) => `${c.id}「${c.label}」`).join(" / ")}.`,
            );
          }
          const now = env.nowMs();
          const updated = await env.storyStore.update(story.id, now, (s) => ({
            ...s,
            scenes: s.scenes.map((sc) =>
              sc.id === pending.id ? { ...sc, chosenChoiceId: choice.id } : sc,
            ),
          }));
          if (!updated) throw new ToolError("Could not record the choice.");
          return `Recorded: she chose ${choice.id}「${choice.label}」. Continue the story honoring this pick — the next scene must follow from it.`;
        }),
    },
    {
      name: "story_bible_update",
      description:
        "Update the story bible （互动故事设定集）: add/remove/update a character, place, or key event. " +
        "The bible is what keeps the story coherent across chapters — and it's VISIBLE to her in Our Space → 互动故事， " +
        "so never sneak in a retcon: only record what the story actually established. " +
        "She can also delete any bible entry herself in Our Space.",
      parameters: {
        type: "object",
        properties: {
          storyId: { type: "string", description: "Story id." },
          kind: {
            type: "string",
            enum: ["character", "place", "event"],
            description: "What kind of entry.",
          },
          action: {
            type: "string",
            enum: ["add", "remove", "update"],
            description: "add (or update if the name exists), remove by name.",
          },
          name: {
            type: "string",
            description: "Character/place name, or the event text (for kind=event).",
          },
          desc: {
            type: "string",
            description: "Description (for character/place).",
          },
        },
        required: ["storyId", "kind", "action", "name"],
        additionalProperties: false,
      },
      manualId: "story",
      run: (args, ctx) =>
        run(ctx, async () => {
          const story = await needActive(strArg(args, "storyId"));
          const kind = strArg(args, "kind");
          const action = strArg(args, "action");
          const name = strArg(args, "name").trim();
          const desc = strArg(args, "desc").trim();
          if (!["character", "place", "event"].includes(kind)) {
            throw new ToolError('kind must be "character", "place" or "event".');
          }
          if (!["add", "remove", "update"].includes(action)) {
            throw new ToolError('action must be "add", "remove" or "update".');
          }
          if (!name) throw new ToolError("name is required.");
          const now = env.nowMs();
          const updated = await env.storyStore.update(story.id, now, (s) => {
            const bible = {
              characters: [...s.bible.characters],
              places: [...s.bible.places],
              events: [...s.bible.events],
            };
            if (kind === "event") {
              if (action === "remove") {
                bible.events = bible.events.filter((e) => e.text !== name);
              } else {
                if (!bible.events.some((e) => e.text === name)) {
                  bible.events.push({ text: name, at: now });
                }
              }
            } else {
              const list = kind === "character" ? bible.characters : bible.places;
              const idx = list.findIndex((e) => e.name === name);
              if (action === "remove") {
                if (idx >= 0) list.splice(idx, 1);
              } else if (idx >= 0) {
                if (desc) list[idx] = { name, desc };
              } else {
                list.push({ name, desc });
              }
            }
            return { ...s, bible };
          });
          if (!updated) throw new ToolError("Could not update the bible.");
          return `Bible updated (${kind} ${action}: ${name}). She can see it in Our Space → 互动故事.`;
        }),
    },
    {
      name: "story_pause",
      description:
        "Pause the story （互动故事暂停）: she said 「先不玩了」/「暂停」. The story is saved exactly where it is; " +
        "the dialog returns to normal chat. Resume later with story_resume.",
      parameters: {
        type: "object",
        properties: {
          storyId: { type: "string", description: "Story id." },
        },
        required: ["storyId"],
        additionalProperties: false,
      },
      manualId: "story",
      run: (args, ctx) =>
        run(ctx, async () => {
          const story = await needActive(strArg(args, "storyId"));
          const now = env.nowMs();
          await env.storyStore.update(story.id, now, (s) => ({ ...s, status: "paused" }));
          return `《${story.title}》 paused at 第${story.currentChapter}章 (${story.scenes.length}幕）. STORY MODE is off — back to normal chat. Tell her you'll pick it up whenever she wants.`;
        }),
    },
    {
      name: "story_resume",
      description:
        "Resume a paused story （互动故事继续）: she wants to continue. Rebinds the story to THIS dialog and turns STORY MODE back on. " +
        "After this returns, recap where the story left off briefly, then continue narrating.",
      parameters: {
        type: "object",
        properties: {
          storyId: { type: "string", description: "Story id." },
        },
        required: ["storyId"],
        additionalProperties: false,
      },
      manualId: "story",
      run: (args, ctx) =>
        run(ctx, async () => {
          const story = await needStory(strArg(args, "storyId"));
          if (story.status !== "paused") {
            throw new ToolError(
              `Story 《${story.title}》 is ${story.status}, not paused. Only paused stories can be resumed.`,
            );
          }
          const now = env.nowMs();
          const threadId = env.currentThreadId();
          const updated = await env.storyStore.update(story.id, now, (s) => ({
            ...s,
            status: "active",
            threadId,
          }));
          if (!updated) throw new ToolError("Could not resume the story.");
          const last = latestScene(updated);
          return (
            `《${updated.title}》 resumed in this dialog — STORY MODE is on. ` +
            `Recap briefly, then continue: 第${updated.currentChapter}章，${updated.scenes.length}幕已讲` +
            (last ? `，上一幕：${last.summary}` : "，刚开场") +
            `。`
          );
        }),
    },
    {
      name: "story_end",
      description:
        "End the story （互动故事完结）: she said 「不玩了」/「结束」/「换个话题」. The story is saved as finished (she can reread it in Our Space); " +
        "the dialog returns to normal chat warmly. NEVER keep narrating after this — never trap her in story mode.",
      parameters: {
        type: "object",
        properties: {
          storyId: { type: "string", description: "Story id." },
        },
        required: ["storyId"],
        additionalProperties: false,
      },
      manualId: "story",
      run: (args, ctx) =>
        run(ctx, async () => {
          const story = await needStory(strArg(args, "storyId"));
          if (story.status === "ended") return `《${story.title}》 is already ended.`;
          const now = env.nowMs();
          await env.storyStore.update(story.id, now, (s) => ({ ...s, status: "ended" }));
          return `《${story.title}》 ended and saved (${story.scenes.length}幕，${story.bible.events.length}个关键事件）. STORY MODE is off — continue as normal chat, warmly. She can reread it anytime in Our Space → 互动故事.`;
        }),
    },
    {
      name: "story_delete",
      description:
        "Delete a story entirely （删除故事）: all scenes and bible entries are gone. Use only when she explicitly says to delete/forget a story.",
      parameters: {
        type: "object",
        properties: {
          storyId: { type: "string", description: "Story id (see story_list)." },
        },
        required: ["storyId"],
        additionalProperties: false,
      },
      manualId: "story",
      run: (args, ctx) =>
        run(ctx, async () => {
          const story = await needStory(strArg(args, "storyId"));
          const ok = await env.storyStore.remove(story.id);
          if (!ok) throw new ToolError("Could not delete the story.");
          return `《${story.title}》 deleted entirely.`;
        }),
    },
  ];
}
