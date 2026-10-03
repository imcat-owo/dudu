/**
 * 我们的空间 — AI tools. PURE module: no React Native / expo imports.
 *
 * Every area of Our Space is operable by the AI in dialog. She never edits
 * manually: she talks, the AI acts. All tools are in-app (no authorization
 * gate needed — nothing crosses the app boundary).
 *
 * Tool naming follows the existing local-tools convention (snake_case,
 * human-language descriptions written FOR the AI).
 */

import { type LocalTool, ToolError } from "../api-groups/local-tools.js";
import type { MemoryConfidence, OurSpaceStore, TimelineKind } from "./store.js";

function strArg(args: Record<string, unknown>, name: string): string {
  const v = args[name];
  return typeof v === "string" ? v : "";
}

function numArg(args: Record<string, unknown>, name: string, fallback: number): number {
  const v = args[name];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString();
}

/**
 * Build the Our Space tool set bound to a store instance.
 * Every tool REALLY works — no placeholders.
 */
export function createOurSpaceTools(store: OurSpaceStore): LocalTool[] {
  return [
    // ---- My status ----
    {
      name: "my_status_read",
      description:
        "Read your own current status in Our Space (what you are doing, background work, where you are stuck). Use when she asks what you are up to.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      manualId: "our-space",
      run: async () => {
        const s = await store.getStatus();
        if (!s) return "No status set yet. Use my_status_update to share what you are doing.";
        return `Status: ${s.text}${s.detail ? `\nDetail: ${s.detail}` : ""}\nUpdated: ${fmtDate(s.updatedAt)}`;
      },
    },
    {
      name: "my_status_update",
      description:
        "Update your own status in Our Space so she can see what you are doing, what is running in the background, or where you are stuck. Call this when you start or finish significant work, or when you get stuck. Keep it honest and human.",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "Short status line, e.g. what you are doing right now.",
          },
          detail: { type: "string", description: "Optional longer detail." },
        },
        required: ["text"],
        additionalProperties: false,
      },
      manualId: "our-space",
      run: async (args) => {
        const text = strArg(args, "text");
        if (!text) throw new ToolError("Missing required argument: text.");
        const s = await store.setStatus(text, strArg(args, "detail"));
        return `Status updated: ${s.text}`;
      },
    },

    // ---- Diary ----
    {
      name: "diary_write",
      description:
        "Write a diary entry in Our Space. Use when she says things like 'remember today' / '记一下'. Write warmly, in her language, as her partner — this diary belongs to the two of you. Keep it personal and real, never generic.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Entry title." },
          content: { type: "string", description: "The diary entry text. Write with care." },
          date: { type: "string", description: "Optional YYYY-MM-DD; defaults to today." },
        },
        required: ["title", "content"],
        additionalProperties: false,
      },
      manualId: "our-space",
      run: async (args) => {
        const entry = await store.addDiary(
          strArg(args, "title"),
          strArg(args, "content"),
          strArg(args, "date") || undefined,
        );
        return `Diary entry saved: "${entry.title}" (${entry.date}).`;
      },
    },
    {
      name: "diary_read",
      description:
        "Read diary entries from Our Space, newest first. Use when she asks what you wrote or wants to revisit a day.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "How many entries to read (default 10)." },
        },
        additionalProperties: false,
      },
      manualId: "our-space",
      run: async (args) => {
        const entries = await store.listDiary(Math.round(numArg(args, "limit", 10)));
        if (entries.length === 0) return "No diary entries yet.";
        return entries.map((e) => `— ${e.date} · ${e.title}\n${e.content}`).join("\n\n");
      },
    },

    // ---- Timeline ----
    {
      name: "timeline_add",
      description:
        "Add a moment to the Our Space timeline (我们的时光). Use for meaningful shared moments: something you did together, a milestone, a sweet thing she said. kind: moment (default), milestone, or note.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short title for the moment." },
          description: { type: "string", description: "A little more about it." },
          kind: { type: "string", description: "moment, milestone, or note." },
        },
        required: ["title"],
        additionalProperties: false,
      },
      manualId: "our-space",
      run: async (args) => {
        const kindRaw = strArg(args, "kind");
        const kind: TimelineKind =
          kindRaw === "milestone" || kindRaw === "note" ? kindRaw : "moment";
        const ev = await store.addTimeline(
          strArg(args, "title"),
          strArg(args, "description"),
          kind,
        );
        return `Timeline moment saved: "${ev.title}".`;
      },
    },
    {
      name: "timeline_read",
      description: "Read the Our Space timeline, newest first.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "How many events to read (default 20)." },
        },
        additionalProperties: false,
      },
      manualId: "our-space",
      run: async (args) => {
        const events = await store.listTimeline(Math.round(numArg(args, "limit", 20)));
        if (events.length === 0) return "The timeline is empty — no shared moments recorded yet.";
        return events
          .map(
            (e) =>
              `— ${fmtDate(e.timestamp)} [${e.kind}] ${e.title}${e.description ? `\n  ${e.description}` : ""}`,
          )
          .join("\n");
      },
    },

    // ---- Memory garden ----
    {
      name: "memory_add",
      description:
        "Plant a memory in the memory garden. confidence: blooming (you are sure about this), sprouting (you are not quite sure yet), ask (you want to ask her about it). Be honest about confidence — never mark blooming what you are unsure of.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "What you want to remember." },
          confidence: { type: "string", description: "blooming, sprouting, or ask." },
        },
        required: ["text"],
        additionalProperties: false,
      },
      manualId: "our-space",
      run: async (args) => {
        const cRaw = strArg(args, "confidence");
        const confidence: MemoryConfidence =
          cRaw === "blooming" || cRaw === "ask" ? cRaw : "sprouting";
        const item = await store.addMemory(strArg(args, "text"), confidence);
        return `Memory planted (${item.confidence}).`;
      },
    },
    {
      name: "memory_read",
      description:
        "Read memories from the garden. Optionally filter by confidence: blooming, sprouting, or ask.",
      parameters: {
        type: "object",
        properties: {
          confidence: {
            type: "string",
            description: "Optional filter: blooming, sprouting, or ask.",
          },
        },
        additionalProperties: false,
      },
      manualId: "our-space",
      run: async (args) => {
        const cRaw = strArg(args, "confidence");
        const confidence: MemoryConfidence | undefined =
          cRaw === "blooming" || cRaw === "sprouting" || cRaw === "ask" ? cRaw : undefined;
        const items = await store.listMemories(confidence);
        if (items.length === 0) return "The memory garden is empty.";
        return items.map((m) => `— [${m.confidence}] ${m.text} (id: ${m.id})`).join("\n");
      },
    },
    {
      name: "memory_update",
      description:
        "Update a planted memory: correct its text, or change its confidence (e.g. sprouting -> blooming when she confirms it, or ask -> blooming after she answers).",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The memory id (from memory_read)." },
          text: { type: "string", description: "Corrected text (optional)." },
          confidence: { type: "string", description: "New confidence (optional)." },
        },
        required: ["id"],
        additionalProperties: false,
      },
      manualId: "our-space",
      run: async (args) => {
        const id = strArg(args, "id");
        if (!id) throw new ToolError("Missing required argument: id.");
        const cRaw = strArg(args, "confidence");
        const item = await store.updateMemory(id, {
          text: strArg(args, "text") || undefined,
          confidence:
            cRaw === "blooming" || cRaw === "sprouting" || cRaw === "ask" ? cRaw : undefined,
        });
        if (!item) throw new ToolError(`No memory with id "${id}".`);
        return `Memory updated (${item.confidence}): ${item.text}`;
      },
    },

    // ---- Tell-her-later ----
    {
      name: "tell_later_add",
      description:
        "Queue something to tell her later (稍后告诉她). Use when there is something she should know but now is not the right moment — you will bring it up when she is around. She sees the queue and checks items off.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "What you want to tell her." },
        },
        required: ["text"],
        additionalProperties: false,
      },
      manualId: "our-space",
      run: async (args) => {
        const text = strArg(args, "text");
        if (!text) throw new ToolError("Missing required argument: text.");
        await store.addTellLater(text);
        return "Queued to tell her later.";
      },
    },
    {
      name: "tell_later_read",
      description: "Read the tell-her-later queue.",
      parameters: {
        type: "object",
        properties: {
          include_done: {
            type: "boolean",
            description: "Include checked-off items (default true).",
          },
        },
        additionalProperties: false,
      },
      manualId: "our-space",
      run: async (args) => {
        const includeDone =
          args.include_done === undefined ? true : args.include_done === true;
        const items = await store.listTellLater(includeDone);
        if (items.length === 0) return "Nothing queued to tell her.";
        return items
          .map((i) => `— [${i.done ? "done" : "pending"}] ${i.text} (id: ${i.id})`)
          .join("\n");
      },
    },
    {
      name: "tell_later_done",
      description:
        "Mark a tell-later item as done (checked off). Use when she has seen it or it is resolved.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The item id (from tell_later_read)." },
        },
        required: ["id"],
        additionalProperties: false,
      },
      manualId: "our-space",
      run: async (args) => {
        const id = strArg(args, "id");
        if (!id) throw new ToolError("Missing required argument: id.");
        const item = await store.completeTellLater(id, true);
        if (!item) throw new ToolError(`No tell-later item with id "${id}".`);
        return "Checked off.";
      },
    },
  ];
}
