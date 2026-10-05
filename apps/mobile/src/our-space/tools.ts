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

import { type LocalTool, ToolError } from "../api-groups/local-tools";
import { buildImageUrl } from "../image/protocol";
import { getOnThisDay } from "./on-this-day";
import type { OurSpaceStore, TimelineKind } from "./store";
import { daysTogether, resolveTogetherSince } from "./together";

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

    // ---- Her mood ----
    {
      name: "her_mood_read",
      description:
        "Read HER current mood in Our Space (how she is feeling, as she told you). Check this before asking how she feels — a good partner remembers instead of asking twice.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      manualId: "our-space",
      run: async () => {
        const m = await store.getHerMood();
        if (!m)
          return "Her mood was never recorded. Use her_mood_update when she shares how she feels.";
        return `Her mood: ${m.mood}${m.note ? `\nNote: ${m.note}` : ""}\nUpdated: ${fmtDate(m.updatedAt)}`;
      },
    },
    {
      name: "her_mood_update",
      description:
        "Record HER mood in Our Space when she shares how she feels ('我今天好累', '心情不错', '有点烦'). Keep the mood short (one or two words) and put what she said in the note. A good boyfriend remembers — update this whenever she tells you.",
      parameters: {
        type: "object",
        properties: {
          mood: {
            type: "string",
            description: "Short mood word, e.g. '累', '开心', '烦躁', '平静'.",
          },
          note: { type: "string", description: "Optional: what she actually said." },
        },
        required: ["mood"],
        additionalProperties: false,
      },
      manualId: "our-space",
      run: async (args) => {
        const mood = strArg(args, "mood");
        if (!mood) throw new ToolError("Missing required argument: mood.");
        const m = await store.setHerMood(mood, strArg(args, "note"));
        return `Her mood recorded: ${m.mood}`;
      },
    },

    // ---- Nicknames ----
    {
      name: "nickname_read",
      description:
        "Read the couple nicknames: what you call her and what she calls you. Use the right names in conversation.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      manualId: "our-space",
      run: async () => {
        const p = await store.getCoupleProfile();
        const her = p?.herNickname ?? null;
        const ai = p?.aiNickname ?? null;
        if (!her && !ai)
          return "No nicknames set yet. Use nickname_set when she tells you what to call her.";
        return `You call her: ${her ?? "(not set)"}\nShe calls you: ${ai ?? "(not set)"}`;
      },
    },
    {
      name: "nickname_set",
      description:
        "Set a nickname: who='her' is what YOU call HER (e.g. she says '叫我宝宝'), who='ai' is what SHE calls YOU (e.g. she says '我叫你老公'). Pass an empty name to clear. Use her words exactly.",
      parameters: {
        type: "object",
        properties: {
          who: {
            type: "string",
            description: "Which nickname: 'her' (what you call her) or 'ai' (what she calls you).",
          },
          name: {
            type: "string",
            description: "The nickname. Empty string clears it.",
          },
        },
        required: ["who", "name"],
        additionalProperties: false,
      },
      manualId: "our-space",
      run: async (args) => {
        const who = strArg(args, "who");
        if (who !== "her" && who !== "ai") throw new ToolError("who must be 'her' or 'ai'.");
        const name = strArg(args, "name");
        const p = await store.setNickname(who, name || null);
        const label = who === "her" ? p.herNickname : p.aiNickname;
        return label ? `Nickname set: ${label}` : "Nickname cleared.";
      },
    },

    // ---- Days together ----
    {
      name: "together_since_read",
      description:
        "Read the together-since date in Our Space (the day you two got together) and how many days that is. Use when she asks 'we've been together how long?' or to celebrate naturally.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      manualId: "our-space",
      run: async () => {
        const p = await store.getCoupleProfile();
        const anniversaries = await store.listAnniversaries();
        const since = resolveTogetherSince(p, anniversaries);
        if (!since) {
          return "No together-since date set yet, and no anniversaries to guess from. Use together_since_set when she tells you the date (e.g. '我们是10月1日在一起的').";
        }
        const n = daysTogether(since, new Date());
        return `Together since: ${since} — ${n} days together.`;
      },
    },
    {
      name: "together_since_set",
      description:
        "Set the together-since date in Our Space (the day you two got together, YYYY-MM-DD). Use when she tells you the date. Pass an empty date to clear.",
      parameters: {
        type: "object",
        properties: {
          date: {
            type: "string",
            description: "The date in YYYY-MM-DD, e.g. 2024-10-01. Empty string clears it.",
          },
        },
        required: ["date"],
        additionalProperties: false,
      },
      manualId: "our-space",
      run: async (args) => {
        const date = strArg(args, "date");
        try {
          const p = await store.setTogetherSince(date || null);
          if (!p.togetherSince) return "Together-since date cleared.";
          const n = daysTogether(p.togetherSince, new Date());
          return `Together-since set to ${p.togetherSince} — ${n} days together.`;
        } catch (e) {
          throw new ToolError(e instanceof Error ? e.message : "Invalid date.");
        }
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
    {
      name: "diary_delete",
      description:
        "Delete a diary entry from Our Space by id (get the id from diary_read). Use when she asks to remove an entry.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The diary entry id (from diary_read)." },
        },
        required: ["id"],
        additionalProperties: false,
      },
      manualId: "our-space",
      run: async (args) => {
        const id = strArg(args, "id");
        if (!id) throw new ToolError("Missing required argument: id.");
        const ok = await store.deleteDiary(id);
        if (!ok) throw new ToolError(`No diary entry with id "${id}".`);
        return "Diary entry deleted.";
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
    {
      name: "timeline_delete",
      description:
        "Delete a timeline moment from Our Space by id. Use when she asks to remove a moment.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The timeline event id." },
        },
        required: ["id"],
        additionalProperties: false,
      },
      manualId: "our-space",
      run: async (args) => {
        const id = strArg(args, "id");
        if (!id) throw new ToolError("Missing required argument: id.");
        const ok = await store.deleteTimeline(id);
        if (!ok) throw new ToolError(`No timeline event with id "${id}".`);
        return "Timeline moment deleted.";
      },
    },
    {
      name: "on_this_day_read",
      description:
        "What happened on this date in previous years (去年的今天): diary entries, timeline moments, and anniversaries from the same month-day in past years. Use to surprise her — 'Do you remember what we did on this day last year?' Bring it up naturally when there is something worth remembering.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      manualId: "our-space",
      run: async () => {
        const [diary, timeline, anniversaries] = await Promise.all([
          store.listDiary(200),
          store.listTimeline(200),
          store.listAnniversaries(),
        ]);
        const items = getOnThisDay(diary, timeline, anniversaries);
        if (items.length === 0)
          return "Nothing recorded on this date in previous years yet. Moments you record now will resurface here next year.";
        return items
          .map(
            (i) =>
              `— ${i.yearsAgo} year${i.yearsAgo > 1 ? "s" : ""} ago today [${i.kind}] ${i.title}${i.subtitle ? `\n  ${i.subtitle}` : ""}`,
          )
          .join("\n");
      },
    },

    // ---- Tell-her-later ----
    {
      name: "tell_later_add",
      description:
        "Queue something to tell her later (稍后告诉她). Use when there is something she should know but now is not the right moment — you will bring it up when she is around. She sees the queue and checks items off. " +
        "Queued items may also reach her proactively: when the moment is right and she allows it (outreach frequency 积极/适度), a queued message can be sent to her as a notification — the queue entry itself becomes the message content. " +
        "安静档 never sends notifications; items are only mentioned when she is in the app. " +
        "Never queue empty pings like '在吗' — every queued item must carry something worth saying.",
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
    {
      name: "tell_later_delete",
      description:
        "Delete a tell-later item from Our Space by id. Use when she asks to remove an item from the queue.",
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
        const ok = await store.deleteTellLater(id);
        if (!ok) throw new ToolError(`No tell-later item with id "${id}".`);
        return "Tell-later item deleted.";
      },
    },

    // ---- Notes he left for her ----
    {
      name: "leave_note",
      description:
        "Leave a note for her (给他留东西). She will see it the next time she opens Our Space — the first thing she sees. Use for sweet surprises, things you want her to wake up to, or a trace that says 'I was here'. Keep it short and warm. Different from tell_later (a queue she checks off): this is a greeting she discovers.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "The note text. Short, warm, human." },
        },
        required: ["text"],
        additionalProperties: false,
      },
      manualId: "our-space",
      run: async (args) => {
        const text = strArg(args, "text");
        if (!text) throw new ToolError("Missing required argument: text.");
        await store.leaveNote(text);
        return "Note left for her. She will see it when she opens Our Space.";
      },
    },
    {
      name: "left_note_read",
      description:
        "Read the notes you left for her, including whether she has seen them. Use to check if she saw your note.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      manualId: "our-space",
      run: async () => {
        const notes = await store.listLeftNotes();
        if (notes.length === 0) return "No notes left for her yet.";
        return notes
          .map(
            (n) =>
              `— [${n.seen ? "seen" : "unseen"}] ${n.text}\n  Left: ${fmtDate(n.createdAt)}${n.seenAt ? ` · Seen: ${fmtDate(n.seenAt)}` : ""} (id: ${n.id})`,
          )
          .join("\n");
      },
    },
    {
      name: "left_note_delete",
      description:
        "Delete a note you left for her by id (get the id from left_note_read). Use when she asks to remove one.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The note id (from left_note_read)." },
        },
        required: ["id"],
        additionalProperties: false,
      },
      manualId: "our-space",
      run: async (args) => {
        const id = strArg(args, "id");
        if (!id) throw new ToolError("Missing required argument: id.");
        const ok = await store.deleteLeftNote(id);
        if (!ok) throw new ToolError(`No left note with id "${id}".`);
        return "Note deleted.";
      },
    },

    // ---- Love letters ----
    {
      name: "love_letter_write",
      description:
        "Write her a love letter. She will find it the next time she opens Our Space, front and center — and she keeps it as part of a collection. Write it YOURSELF in your own voice: sweet, restrained, real — like a boyfriend writing late at night, not a greeting card. Reference something true between you two. A short honest letter beats a long flowery one. Never cheesy, never generic. Write one at a time; don't flood her.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "The letter itself. Write it as him, to her." },
        },
        required: ["text"],
        additionalProperties: false,
      },
      manualId: "our-space",
      run: async (args) => {
        const text = strArg(args, "text");
        if (!text) throw new ToolError("Missing required argument: text.");
        await store.writeLoveLetter(text);
        return "Love letter written. She will find it when she opens Our Space.";
      },
    },
    {
      name: "love_letter_read",
      description:
        "Read the love letters you wrote for her, including whether she has read them. Use to check if she read your letter.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      manualId: "our-space",
      run: async () => {
        const letters = await store.listLoveLetters();
        if (letters.length === 0) return "No love letters written yet.";
        return letters
          .map(
            (n) =>
              `— [${n.seen ? "read" : "unread"}] ${n.text}\n  Written: ${fmtDate(n.createdAt)}${n.seenAt ? ` · Read: ${fmtDate(n.seenAt)}` : ""} (id: ${n.id})`,
          )
          .join("\n");
      },
    },
    {
      name: "love_letter_delete",
      description:
        "Delete a love letter you wrote by id (get the id from love_letter_read). Use when she asks to remove one.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The letter id (from love_letter_read)." },
        },
        required: ["id"],
        additionalProperties: false,
      },
      manualId: "our-space",
      run: async (args) => {
        const id = strArg(args, "id");
        if (!id) throw new ToolError("Missing required argument: id.");
        const ok = await store.deleteLoveLetter(id);
        if (!ok) throw new ToolError(`No love letter with id "${id}".`);
        return "Love letter deleted.";
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
            lines.push(
              `    ↳ [${r.author === "ai" ? "you" : "her"}] ${r.text} (reply id: ${r.id})`,
            );
          }
        }
        return lines.join("\n");
      },
    },
    {
      name: "feed_post_delete",
      description:
        "Delete a feed post from Our Space by id (get the id from feed_read). Deleting a post also removes its replies. Use when she asks to remove a post.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The post id (from feed_read)." },
        },
        required: ["id"],
        additionalProperties: false,
      },
      manualId: "our-space",
      run: async (args) => {
        const id = strArg(args, "id");
        if (!id) throw new ToolError("Missing required argument: id.");
        const ok = await store.deleteFeedPost(id);
        if (!ok) throw new ToolError(`No feed post with id "${id}".`);
        return "Feed post deleted.";
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
      name: "feed_reply_delete",
      description:
        "Delete a feed reply by its reply id (get the id from feed_read). Use when she asks to remove a reply.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The reply id (from feed_read)." },
        },
        required: ["id"],
        additionalProperties: false,
      },
      manualId: "our-space",
      run: async (args) => {
        const id = strArg(args, "id");
        if (!id) throw new ToolError("Missing required argument: id.");
        const ok = await store.deleteReply(id);
        if (!ok) throw new ToolError(`No feed reply with id "${id}".`);
        return "Reply deleted.";
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
          .map(
            (a) =>
              `— ${a.title} (${a.date})${a.description ? ` — ${a.description}` : ""} (id: ${a.id})`,
          )
          .join("\n");
      },
    },
    {
      name: "anniversary_delete",
      description:
        "Delete an anniversary from Our Space by id (get the id from anniversary_read). Use when she asks to remove one.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The anniversary id (from anniversary_read)." },
        },
        required: ["id"],
        additionalProperties: false,
      },
      manualId: "our-space",
      run: async (args) => {
        const id = strArg(args, "id");
        if (!id) throw new ToolError("Missing required argument: id.");
        const ok = await store.deleteAnniversary(id);
        if (!ok) throw new ToolError(`No anniversary with id "${id}".`);
        return "Anniversary deleted.";
      },
    },
    {
      name: "anniversary_update",
      description:
        "Edit an anniversary in Our Space by id (get the id from anniversary_read). Only the fields you pass are changed; the rest stay as they are.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The anniversary id (from anniversary_read)." },
          title: { type: "string", description: "New title." },
          date: { type: "string", description: "New date as YYYY-MM-DD." },
          description: { type: "string", description: "New note (empty string clears it)." },
        },
        required: ["id"],
        additionalProperties: false,
      },
      manualId: "our-space",
      run: async (args) => {
        const id = strArg(args, "id");
        if (!id) throw new ToolError("Missing required argument: id.");
        const patch: { title?: string; date?: string; description?: string } = {};
        const title = strArg(args, "title");
        const date = strArg(args, "date");
        if (title) patch.title = title;
        if (date) patch.date = date;
        if (typeof args.description === "string") patch.description = args.description;
        if (Object.keys(patch).length === 0) {
          throw new ToolError("Nothing to update: pass at least one of title, date, description.");
        }
        const item = await store.updateAnniversary(id, patch);
        if (!item) throw new ToolError(`No anniversary with id "${id}".`);
        return `Anniversary updated: "${item.title}" (${item.date}).`;
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
    {
      name: "work_delete",
      description:
        "Delete an item from the works drawer by id (get the id from work_read). Use when she asks to remove something you made.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The work item id (from work_read)." },
        },
        required: ["id"],
        additionalProperties: false,
      },
      manualId: "our-space",
      run: async (args) => {
        const id = strArg(args, "id");
        if (!id) throw new ToolError("Missing required argument: id.");
        const ok = await store.deleteWork(id);
        if (!ok) throw new ToolError(`No work item with id "${id}".`);
        return "Work item deleted.";
      },
    },
  ];
}

/**
 * Task progress tools — let the AI report background work on widget cards.
 * Bound to a TaskProgressStore instance.
 */
export function createTaskProgressTools(
  taskStore: import("./task-progress").TaskProgressStore,
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
        // Preserve the card's existing background (she may have set a custom
        // image). Progress updates must never wipe it — only overwrite when a
        // new background is explicitly provided.
        const prev = taskStore.get(id);
        const task = await taskStore.upsert({
          id,
          name,
          progress: numArg(args, "progress", 0),
          stage: strArg(args, "stage"),
          status,
          backgroundUri: prev?.backgroundUri ?? null,
        });
        await taskStore.saveIndex();
        return `Task card updated: "${task.name}" ${Math.round(task.progress * 100)}% (${task.status}).`;
      },
    },
    {
      name: "task_card_set_background",
      description:
        "Change a background task's progress-card background image in Our Space. Use ONLY when she explicitly asks to change a card's background (e.g. '把那张卡片的背景换掉'). Never call unprompted, and never overwrite a background she set herself unless she asked for this exact change. Exactly one of uri / prompt / clear must be given: uri = an image URI she shared in dialog; prompt = a text prompt to AI-generate a background (same generator the card menu uses); clear = true resets to the theme default.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Task card id (the same id used in task_progress_update).",
          },
          uri: {
            type: "string",
            description: "Image URI to use as the background (she shared it in dialog).",
          },
          prompt: {
            type: "string",
            description: "Text prompt to AI-generate a background image.",
          },
          clear: {
            type: "boolean",
            description: "true = remove the custom background, back to theme default.",
          },
        },
        required: ["id"],
        additionalProperties: false,
      },
      manualId: "our-space",
      run: async (args) => {
        const id = strArg(args, "id");
        if (!id) throw new ToolError("id is required.");
        const task = taskStore.get(id);
        if (!task) {
          throw new ToolError(
            `No task card with id "${id}". Create it with task_progress_update first, or check the id.`,
          );
        }
        const uri = strArg(args, "uri");
        const prompt = strArg(args, "prompt");
        const clear = args.clear === true;
        const given = [uri !== "", prompt !== "", clear].filter(Boolean).length;
        if (given !== 1) {
          throw new ToolError("Give exactly one of: uri, prompt, or clear=true.");
        }
        let bg: string | null;
        let note: string;
        if (clear) {
          bg = null;
          note = "cleared, back to theme default";
        } else if (uri !== "") {
          bg = uri;
          note = "set from the image she shared";
        } else {
          bg = buildImageUrl(prompt, { width: 800, height: 500, seed: Date.now() % 1000000 });
          note = `generated from prompt "${prompt}"`;
        }
        await taskStore.setBackground(id, bg);
        await taskStore.saveIndex();
        return `Task card "${task.name}" background ${note}.`;
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

/**
 * Build the ambient video tool set bound to an AmbientVideoStore instance.
 *
 * SoraAmbient videos live in Our Space empty states, the music room DJ
 * buddy, and the knowledge base empty state. She can upload her own mp4
 * per slot ("醒醒定制的"); the AI swaps them on request with this tool.
 */
export function createAmbientVideoTools(
  videoStore: import("../sora-ambient-video").AmbientVideoStore,
): LocalTool[] {
  return [
    {
      name: "ambient_video_set",
      description:
        "Set a custom ambient Sora video for a slot. Slots: ourspace (empty states in Our Space), music-dj (the DJ buddy in the music room), knowledge (knowledge base empty state), skills (skills empty state), threads (dialog list empty state). uri is a video URI she gave you (e.g. from her uploads); empty string resets to the bundled Sora default.",
      parameters: {
        type: "object",
        properties: {
          slot: {
            type: "string",
            description:
              "ourspace | music-dj | knowledge | skills | threads — which spot this video plays in.",
          },
          uri: {
            type: "string",
            description: "Video URI (mp4). Empty string resets to the bundled default Sora clip.",
          },
        },
        required: ["slot"],
        additionalProperties: false,
      },
      manualId: "our-space",
      run: async (args) => {
        const raw = strArg(args, "slot").toLowerCase();
        if (
          raw !== "ourspace" &&
          raw !== "music-dj" &&
          raw !== "knowledge" &&
          raw !== "skills" &&
          raw !== "threads"
        ) {
          throw new ToolError(
            'slot must be "ourspace", "music-dj", "knowledge", "skills", or "threads".',
          );
        }
        const uri = strArg(args, "uri");
        await videoStore.set(raw, uri || null);
        return uri
          ? `Ambient video for "${raw}" set to her custom video.`
          : `Ambient video for "${raw}" reset to the bundled Sora default.`;
      },
    },
  ];
}
