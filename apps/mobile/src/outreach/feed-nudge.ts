/**
 * feed_nudge (C3) — the AI no longer ignores HER feed.
 *
 * When she publishes a feed post and the AI hasn't interacted with it
 * within 24 hours, the AI likes it and leaves ONE reply. Exactly once per
 * post; never nagging, never repeated.
 *
 * Design (same shape as the rest of the outreach engine):
 *  - `evaluateFeedNudge` is PURE: posts + nudged-set + now → one candidate
 *    or null. The engine (engine.ts) calls it and wraps the result in an
 *    `OutreachTrigger`, so frequency gates, quiet mode and the per-kind
 *    cooldown apply exactly like every other trigger.
 *  - `runFeedNudge` is the executor. It performs the like + reply through
 *    the EXISTING feed_like / feed_reply tool implementations (passed in
 *    as ports — this module never reimplements liking/replying), records
 *    the post in the outreach store's nudged set, and traces the action.
 *    It never throws: delivery must never break the app lifecycle.
 *  - Exactly-once has two layers: the persisted nudged-set (a post the
 *    executor handled) and the live post state (a post the AI already
 *    liked/replied to by ANY path is never eligible again).
 *  - The nudge is recorded BEFORE acting. Rationale: feed_like toggles —
 *    a double-act would silently UNLIKE, which is worse than a missed
 *    like. The OutreachStore serializes the write.
 *  - Reply copy is crafted, not generated: backgrounded iOS can't run the
 *    model (same constraint as notify.ts documents). 嘟嘟腔: cute but
 *    never greasy, warm in what it says, short like a text, zero emoji.
 *    If the post has no readable text (image-only / blank), the nudge is
 *    like-only — a hollow comment is worse than none.
 */

import { isHerSleepTime } from "../our-space/her-rhythm";

/** A feed post shaped for nudge evaluation. */
export interface FeedNudgePost {
  id: string;
  author: "her" | "ai";
  text: string;
  imageUri?: string;
  createdAt: number;
  likedByAi: boolean;
  /** True when any reply on this post was authored by the AI. */
  hasAiReply: boolean;
}

export interface FeedNudgeEvalInput {
  now: number;
  posts: FeedNudgePost[];
  /** Post ids the executor already nudged (persisted). */
  nudgedPostIds: string[];
}

export interface FeedNudgeCandidate {
  postId: string;
  /** Sanitized snippet for trigger detail / prompt lines. */
  snippet: string;
  /** False for image-only / blank posts → like-only nudge. */
  hasReadableText: boolean;
}

/** Only nudge once 24h have passed with no AI interaction. Never instant (creepy). */
export const FEED_NUDGE_WINDOW_MS = 24 * 3_600_000;

/** Minimum readable text length to justify a reply (else like-only). */
const READABLE_TEXT_MIN = 2;

const nudgedSetOf = (ids: string[]): Set<string> => new Set(ids);

function sanitizeSnippet(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 120);
}

/**
 * Pure eligibility: her post, 24h+ old, no AI like, no AI reply, not
 * already nudged, never AI-authored. Oldest eligible wins (waiting longest).
 */
export function evaluateFeedNudge(input: FeedNudgeEvalInput): FeedNudgeCandidate | null {
  const { now, posts } = input;
  const nudged = nudgedSetOf(input.nudgedPostIds);
  const eligible = posts.filter(
    (p) =>
      p.author === "her" &&
      !nudged.has(p.id) &&
      !p.likedByAi &&
      !p.hasAiReply &&
      now - p.createdAt >= FEED_NUDGE_WINDOW_MS &&
      now - p.createdAt >= 0,
  );
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => a.createdAt - b.createdAt);
  const post = eligible[0];
  const text = post.text.trim();
  return {
    postId: post.id,
    snippet: sanitizeSnippet(text) || (post.imageUri ? "[图片]" : ""),
    hasReadableText: text.length >= READABLE_TEXT_MIN,
  };
}

/**
 * Crafted reply lines (嘟嘟腔). Deterministic rotation by post id — the
 * same post always gets the same line, so a retry never changes its mind.
 * Warm, restrained, zero emoji. These react to her SHARING (true) rather
 * than pretending to understand specifics (would be fake).
 */
const FEED_NUDGE_REPLIES = [
  "这条我认真看完了，喜欢。",
  "看到你发这个，我也跟着开心了一下。",
  "留个言，证明我可没划过去。",
  "嗯，这条我记下了。",
];

export function pickFeedNudgeReply(postId: string): string {
  let h = 0;
  for (let i = 0; i < postId.length; i++) h = (h * 31 + postId.charCodeAt(i)) >>> 0;
  return FEED_NUDGE_REPLIES[h % FEED_NUDGE_REPLIES.length];
}

/** Action ports — implemented by the wiring with the EXISTING tools. */
export interface FeedNudgeActionPorts {
  /** Invoke the existing feed_like tool. Throws on failure. */
  likePost(postId: string): Promise<void>;
  /** Invoke the existing feed_reply tool. Throws on failure. */
  replyToPost(postId: string, text: string): Promise<void>;
  /** Fresh post read for the pre-action re-check. Null = gone. */
  getPost(postId: string): Promise<FeedNudgePost | null>;
}

export interface FeedNudgeRunDeps {
  now?: number;
  posts: FeedNudgePost[];
  nudgedPostIds: string[];
  actions: FeedNudgeActionPorts;
  /** Persist the nudge (serialized in the outreach store). */
  recordNudged(postId: string): Promise<void>;
  /** Audit trace. Best-effort. */
  trace(summary: string, reason: string): Promise<void>;
  /** Defaults to her real sleep window; injectable for tests. */
  isSleepTime?: (nowMs: number) => boolean;
}

export interface FeedNudgeRunResult {
  nudged: boolean;
  postId?: string;
  liked?: boolean;
  replied?: boolean;
  reason?: "no-candidate" | "sleep-window" | "failed";
}

/**
 * Run one feed nudge. Never throws.
 *
 * Order matters: record-first (exactly-once beats at-least-once here —
 * a double-act would toggle the like OFF). The pre-action re-check on
 * fresh state keeps the toggle from ever unliking.
 */
export async function runFeedNudge(deps: FeedNudgeRunDeps): Promise<FeedNudgeRunResult> {
  const now = deps.now ?? Date.now();
  try {
    const candidate = evaluateFeedNudge({
      now,
      posts: deps.posts,
      nudgedPostIds: deps.nudgedPostIds,
    });
    if (!candidate) return { nudged: false, reason: "no-candidate" };
    const sleep = deps.isSleepTime ?? isHerSleepTime;
    if (sleep(now)) return { nudged: false, reason: "sleep-window" };

    await deps.recordNudged(candidate.postId);

    // Re-check on fresh state: only toggle when the like is really absent.
    const fresh = await deps.actions.getPost(candidate.postId).catch(() => null);
    if (!fresh) {
      // Post vanished mid-flight. Recorded = done; nothing to act on.
      return { nudged: true, postId: candidate.postId, liked: false, replied: false };
    }
    let liked = true;
    if (!fresh.likedByAi) {
      await deps.actions.likePost(candidate.postId);
      liked = true;
    }

    let replied = false;
    if (candidate.hasReadableText) {
      await deps.actions.replyToPost(candidate.postId, pickFeedNudgeReply(candidate.postId));
      replied = true;
    }

    await deps
      .trace(
        `feed_nudge: liked her post${replied ? " and left a reply" : ""}`,
        `feed_nudge post ${candidate.postId}`,
      )
      .catch(() => {});
    return { nudged: true, postId: candidate.postId, liked, replied };
  } catch {
    return { nudged: false, reason: "failed" };
  }
}
