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
import type { OurSpaceStore, TimelineKind } from "./store.js";

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
        const includeDone = args.include_done === undefined ? true : args.include_done === true;
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

    // ---- v2: social feed (Moments-style, bidirectional) ----
    {
      name: "feed_post",
      description:
        "Post to the Our Space social feed as yourself (the AI). She will see it in the feed and can reply and like. You may include an imageUri when you made an image for her — images ARE allowed in Our Space. Keep posts warm and personal, never generic.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Post text." },
          imageUri: {
            type: "string",
            description: "Optional image URI to attach to the post.",
          },
        },
        required: ["text"],
        additionalProperties: false,
      },
      manualId: "our-space",
      run: async (args) => {
        const text = strArg(args, "text");
        const imageUri = strArg(args, "imageUri") || undefined;
        const post = await store.addFeedPost("ai", text, imageUri);
        return `Posted to the feed (id: ${post.id}).`;
      },
    },
    {
      name: "feed_read",
      description:
        "Read recent posts from the Our Space social feed (newest first), including like state and reply counts. Use to see what she posted so you can reply or like.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max posts (default 20)." },
        },
        additionalProperties: false,
      },
      manualId: "our-space",
      run: async (args) => {
        const posts = await store.listFeed(numArg(args, "limit", 20));
        if (posts.length === 0) return "The feed is empty.";
        const lines: string[] = [];
        for (const p of posts) {
          const who = p.author === "ai" ? "you" : "her";
          const likes: string[] = [];
          if (p.likedByHer) likes.push("her");
          if (p.likedByAi) likes.push("you");
          lines.push(
            `— [${who}] ${p.text}${p.imageUri ? " [has image]" : ""} (id: ${p.id}, ${fmtDate(p.createdAt)}${likes.length ? `, liked by ${likes.join(" + ")}` : ""})`,
          );
          const replies = await store.listReplies(p.id);
          for (const r of replies) {
            lines.push(`    ↳ [${r.author === "ai" ? "you" : "her"}] ${r.text}`);
          }
        }
        return lines.join("\n");
      },
    },
    {
      name: "feed_reply",
      description:
        "Reply to a feed post in Our Space as yourself (the AI). Use when she posts something and you want to respond in the feed.",
      parameters: {
        type: "object",
        properties: {
          postId: { type: "string", description: "The post id (from feed_read)." },
          text: { type: "string", description: "Reply text." },
        },
        required: ["postId", "text"],
        additionalProperties: false,
      },
      manualId: "our-space",
      run: async (args) => {
        const postId = strArg(args, "postId");
        const text = strArg(args, "text");
        if (!postId) throw new ToolError("Missing required argument: postId.");
        if (!text) throw new ToolError("Missing required argument: text.");
        await store.addReply(postId, "ai", text);
        return "Reply posted.";
      },
    },
    {
      name: "feed_like",
      description:
        "Like (or unlike, toggling) a feed post in Our Space as yourself (the AI). Use to like her posts.",
      parameters: {
        type: "object",
        properties: {
          postId: { type: "string", description: "The post id (from feed_read)." },
        },
        required: ["postId"],
        additionalProperties: false,
      },
      manualId: "our-space",
      run: async (args) => {
        const postId = strArg(args, "postId");
        if (!postId) throw new ToolError("Missing required argument: postId.");
        const post = await store.toggleFeedLike(postId, "ai");
        if (!post) throw new ToolError(`No post with id "${postId}".`);
        return post.likedByAi ? "Liked." : "Unliked.";
      },
    },

    // ---- v2: anniversaries ----
    {
      name: "anniversary_add",
      description:
        "Add an anniversary / milestone date in Our Space (e.g. the day you met, her birthday). Shown in the 纪念日 card with a countdown.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Anniversary title." },
          date: { type: "string", description: "Date as YYYY-MM-DD." },
          description: { type: "string", description: "Optional note." },
        },
        required: ["title", "date"],
        additionalProperties: false,
      },
      manualId: "our-space",
      run: async (args) => {
        const item = await store.addAnniversary(
          strArg(args, "title"),
          strArg(args, "date"),
          strArg(args, "description"),
        );
        return `Anniversary saved: "${item.title}" (${item.date}).`;
      },
    },
    {
      name: "anniversary_read",
      description: "List anniversaries in Our Space.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      manualId: "our-space",
      run: async () => {
        const items = await store.listAnniversaries();
        if (items.length === 0) return "No anniversaries yet.";
        return items
          .map((a) => `— ${a.title} (${a.date})${a.description ? ` — ${a.description}` : ""}`)
          .join("\n");
      },
    },

    // ---- v2: works drawer ----
    {
      name: "work_add",
      description:
        "Add something you made for her to the works drawer in Our Space (image, HTML page, theme, file). It appears as a card in the Instagram-style grid; she taps to view it full.",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            description: 'One of: "image", "html", "theme", "file".',
          },
          title: { type: "string", description: "Title for the card." },
          uri: { type: "string", description: "URI to the content." },
          description: { type: "string", description: "Optional note." },
          thumbnailUri: { type: "string", description: "Optional thumbnail URI." },
        },
        required: ["type", "title", "uri"],
        additionalProperties: false,
      },
      manualId: "our-space",
      run: async (args) => {
        const type = strArg(args, "type");
        if (!["image", "html", "theme", "file"].includes(type)) {
          throw new ToolError('type must be one of "image", "html", "theme", "file".');
        }
        const item = await store.addWork(
          type as "image" | "html" | "theme" | "file",
          strArg(args, "title"),
          strArg(args, "uri"),
          strArg(args, "description"),
          strArg(args, "thumbnailUri") || undefined,
        );
        return `Added to works drawer: "${item.title}".`;
      },
    },
    {
      name: "work_read",
      description: "List items in the works drawer.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      manualId: "our-space",
      run: async () => {
        const items = await store.listWorks();
        if (items.length === 0) return "The works drawer is empty.";
        return items.map((w) => `— [${w.type}] ${w.title} (id: ${w.id})`).join("\n");
      },
    },
  ];
}

/**
 * Task progress tools — let the AI report background work on widget cards.
 * Bound to a TaskProgressStore instance.
 */
export function createTaskProgressTools(
  taskStore: import("./task-progress.js").TaskProgressStore,
): LocalTool[] {
  return [
    {
      name: "task_progress_update",
      description:
        "Update a background task's progress card in Our Space (the iOS-widget-style cards she sees). Use when you start, advance, or finish background work so she can watch it live. progress is 0..1.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Task id (pick a stable one, e.g. 'kb-index-123')." },
          name: { type: "string", description: "Display name, e.g. '知识库索引'." },
          progress: { type: "number", description: "0..1 fraction complete." },
          stage: {
            type: "string",
            description: "Current stage text, e.g. '正在读第 3/10 个文件'.",
          },
          status: {
            type: "string",
            description: "running | stuck | done. Defaults to running; 1.0 auto-completes.",
          },
        },
        required: ["id", "name", "progress"],
        additionalProperties: false,
      },
      manualId: "our-space",
      run: async (args) => {
        const id = strArg(args, "id");
        const name = strArg(args, "name");
        if (!id || !name) throw new ToolError("id and name are required.");
        const statusRaw = strArg(args, "status");
        const status = statusRaw === "stuck" || statusRaw === "done" ? statusRaw : "running";
        const task = await taskStore.upsert({
          id,
          name,
          progress: numArg(args, "progress", 0),
          stage: strArg(args, "stage"),
          status,
          backgroundUri: null,
        });
        await taskStore.saveIndex();
        return `Task card updated: "${task.name}" ${Math.round(task.progress * 100)}% (${task.status}).`;
      },
    },
    {
      name: "task_progress_dismiss",
      description: "Remove a finished task's progress card from Our Space.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Task id to remove." },
        },
        required: ["id"],
        additionalProperties: false,
      },
      manualId: "our-space",
      run: async (args) => {
        const id = strArg(args, "id");
        if (!id) throw new ToolError("id is required.");
        await taskStore.remove(id);
        await taskStore.saveIndex();
        return `Task card "${id}" dismissed.`;
      },
    },
  ];
}
