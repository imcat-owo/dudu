/**
 * 我们的空间 — data layer. PURE module: no React Native / expo imports.
 *
 * Five areas, all AI-operated via dialog (she never edits manually):
 * - status:    the AI's own status (doing / background / stuck)
 * - diary:     the AI's diary, written for the two of them
 * - timeline:  interactive timeline of their moments together
 * - memory:    memory garden — blooming (confident), sprouting (unsure), ask (wants to ask her)
 * - tellLater: queue of things the AI wants to tell her later; she checks them off
 *
 * Storage is injectable (AsyncStorage in production, Map-backed fake in tests).
 * Mutations emit to subscribers so the UI refreshes live when the AI writes
 * via tools during a chat turn.
 */

export type MemoryConfidence = "blooming" | "sprouting" | "ask";
export type TimelineKind = "moment" | "milestone" | "note";

export interface DiaryEntry {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  title: string;
  content: string;
  createdAt: number;
}

export interface TimelineEvent {
  id: string;
  timestamp: number;
  title: string;
  description: string;
  kind: TimelineKind;
}

export interface TellLaterItem {
  id: string;
  text: string;
  createdAt: number;
  done: boolean;
  doneAt?: number;
}

export interface AiStatus {
  text: string;
  detail: string;
  updatedAt: number;
}

// ============ v2 additions (ADDITIVE — v1 areas above are untouched) ============

/** Couple header: her avatar + AI avatar, both customizable (null = default). */
export interface CoupleProfile {
  herAvatarUri: string | null;
  aiAvatarUri: string | null;
  updatedAt: number;
}

export type FeedAuthor = "her" | "ai";

export interface FeedPost {
  id: string;
  author: FeedAuthor;
  text: string;
  /** Optional image URI (her exception: images allowed in Our Space). */
  imageUri?: string;
  createdAt: number;
  likedByHer: boolean;
  likedByAi: boolean;
}

export interface FeedReply {
  id: string;
  postId: string;
  author: FeedAuthor;
  text: string;
  createdAt: number;
}

export interface Anniversary {
  id: string;
  title: string;
  /** YYYY-MM-DD */
  date: string;
  description: string;
  createdAt: number;
}

export type WorkType = "image" | "html" | "theme" | "file";

export interface WorkItem {
  id: string;
  type: WorkType;
  title: string;
  /** URI to the content (image file, html file, theme bundle, etc.). */
  uri: string;
  thumbnailUri?: string;
  description: string;
  createdAt: number;
}

/** Minimal storage surface. AsyncStorage satisfies this in production. */
export interface OurSpaceStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

const KEYS = {
  diary: "openmuse.ourspace.v1.diary",
  timeline: "openmuse.ourspace.v1.timeline",
  tellLater: "openmuse.ourspace.v1.telllater",
  status: "openmuse.ourspace.v1.status",
  // v2 additions (new keys — v1 data untouched)
  couple: "openmuse.ourspace.v2.couple",
  feed: "openmuse.ourspace.v2.feed",
  replies: "openmuse.ourspace.v2.replies",
  anniversaries: "openmuse.ourspace.v2.anniversaries",
  works: "openmuse.ourspace.v2.works",
} as const;

function newId(): string {
  return `os_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Newest-first sort with insertion-order tiebreak. Entries are appended on
 * add, so a higher index means newer. Without the tiebreak, two entries in
 * the same millisecond (common when the AI writes via dialog) sort unstably.
 */
function newestFirst<T>(items: T[], ts: (e: T) => number): T[] {
  return items
    .map((e, i) => ({ e, i }))
    .sort((a, b) => ts(b.e) - ts(a.e) || b.i - a.i)
    .map(({ e }) => e);
}

function todayStr(d: Date = new Date()): string {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

async function readJson<T>(storage: OurSpaceStorage, key: string, fallback: T): Promise<T> {
  try {
    const raw = await storage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(storage: OurSpaceStorage, key: string, value: unknown): Promise<void> {
  await storage.setItem(key, JSON.stringify(value));
}

export type OurSpaceListener = () => void;

export class OurSpaceStore {
  private listeners = new Set<OurSpaceListener>();

  constructor(private storage: OurSpaceStorage) {}

  /** Subscribe to any mutation. Returns unsubscribe. */
  subscribe(listener: OurSpaceListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const l of this.listeners) {
      try {
        l();
      } catch {
        // A broken listener must never break the store.
      }
    }
  }

  // ---- Status ----

  async getStatus(): Promise<AiStatus | null> {
    return readJson<AiStatus | null>(this.storage, KEYS.status, null);
  }

  async setStatus(text: string, detail = ""): Promise<AiStatus> {
    const s: AiStatus = { text: text.trim(), detail: detail.trim(), updatedAt: Date.now() };
    await writeJson(this.storage, KEYS.status, s);
    this.emit();
    return s;
  }

  // ---- Diary ----

  async listDiary(limit = 50): Promise<DiaryEntry[]> {
    const all = await readJson<DiaryEntry[]>(this.storage, KEYS.diary, []);
    return newestFirst(all, (e) => e.createdAt).slice(0, Math.max(1, limit));
  }

  async addDiary(title: string, content: string, date?: string): Promise<DiaryEntry> {
    const t = title.trim();
    const c = content.trim();
    if (!t) throw new Error("Diary title is required.");
    if (!c) throw new Error("Diary content is required.");
    const entry: DiaryEntry = {
      id: newId(),
      date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayStr(),
      title: t,
      content: c,
      createdAt: Date.now(),
    };
    const all = await readJson<DiaryEntry[]>(this.storage, KEYS.diary, []);
    all.push(entry);
    await writeJson(this.storage, KEYS.diary, all);
    this.emit();
    return entry;
  }

  async deleteDiary(id: string): Promise<boolean> {
    const all = await readJson<DiaryEntry[]>(this.storage, KEYS.diary, []);
    const next = all.filter((e) => e.id !== id);
    if (next.length === all.length) return false;
    await writeJson(this.storage, KEYS.diary, next);
    this.emit();
    return true;
  }

  // ---- Timeline ----

  async listTimeline(limit = 100): Promise<TimelineEvent[]> {
    const all = await readJson<TimelineEvent[]>(this.storage, KEYS.timeline, []);
    return newestFirst(all, (e) => e.timestamp).slice(0, Math.max(1, limit));
  }

  async addTimeline(
    title: string,
    description = "",
    kind: TimelineKind = "moment",
  ): Promise<TimelineEvent> {
    const t = title.trim();
    if (!t) throw new Error("Timeline title is required.");
    const ev: TimelineEvent = {
      id: newId(),
      timestamp: Date.now(),
      title: t,
      description: description.trim(),
      kind,
    };
    const all = await readJson<TimelineEvent[]>(this.storage, KEYS.timeline, []);
    all.push(ev);
    await writeJson(this.storage, KEYS.timeline, all);
    this.emit();
    return ev;
  }

  async deleteTimeline(id: string): Promise<boolean> {
    const all = await readJson<TimelineEvent[]>(this.storage, KEYS.timeline, []);
    const next = all.filter((e) => e.id !== id);
    if (next.length === all.length) return false;
    await writeJson(this.storage, KEYS.timeline, next);
    this.emit();
    return true;
  }

  // ---- Tell-her-later ----

  async listTellLater(includeDone = true): Promise<TellLaterItem[]> {
    const all = await readJson<TellLaterItem[]>(this.storage, KEYS.tellLater, []);
    const filtered = includeDone ? all : all.filter((i) => !i.done);
    return filtered.slice().sort((a, b) => a.createdAt - b.createdAt);
  }

  async addTellLater(text: string): Promise<TellLaterItem> {
    const t = text.trim();
    if (!t) throw new Error("Tell-later text is required.");
    const item: TellLaterItem = { id: newId(), text: t, createdAt: Date.now(), done: false };
    const all = await readJson<TellLaterItem[]>(this.storage, KEYS.tellLater, []);
    all.push(item);
    await writeJson(this.storage, KEYS.tellLater, all);
    this.emit();
    return item;
  }

  async completeTellLater(id: string, done = true): Promise<TellLaterItem | null> {
    const all = await readJson<TellLaterItem[]>(this.storage, KEYS.tellLater, []);
    const item = all.find((i) => i.id === id);
    if (!item) return null;
    item.done = done;
    item.doneAt = done ? Date.now() : undefined;
    await writeJson(this.storage, KEYS.tellLater, all);
    this.emit();
    return item;
  }

  async deleteTellLater(id: string): Promise<boolean> {
    const all = await readJson<TellLaterItem[]>(this.storage, KEYS.tellLater, []);
    const next = all.filter((i) => i.id !== id);
    if (next.length === all.length) return false;
    await writeJson(this.storage, KEYS.tellLater, next);
    this.emit();
    return true;
  }

  // ============ v2: couple profile ============

  async getCoupleProfile(): Promise<CoupleProfile | null> {
    return readJson<CoupleProfile | null>(this.storage, KEYS.couple, null);
  }

  async setAvatar(who: "her" | "ai", uri: string | null): Promise<CoupleProfile> {
    const cur = (await this.getCoupleProfile()) ?? {
      herAvatarUri: null,
      aiAvatarUri: null,
      updatedAt: 0,
    };
    const next: CoupleProfile = {
      ...cur,
      herAvatarUri: who === "her" ? uri : cur.herAvatarUri,
      aiAvatarUri: who === "ai" ? uri : cur.aiAvatarUri,
      updatedAt: Date.now(),
    };
    await writeJson(this.storage, KEYS.couple, next);
    this.emit();
    return next;
  }

  // ============ v2: social feed ============

  async listFeed(limit = 100): Promise<FeedPost[]> {
    const all = await readJson<FeedPost[]>(this.storage, KEYS.feed, []);
    return newestFirst(all, (p) => p.createdAt).slice(0, Math.max(1, limit));
  }

  async addFeedPost(author: FeedAuthor, text: string, imageUri?: string): Promise<FeedPost> {
    const t = text.trim();
    if (!t && !imageUri) throw new Error("Feed post needs text or an image.");
    const post: FeedPost = {
      id: newId(),
      author,
      text: t,
      imageUri: imageUri?.trim() || undefined,
      createdAt: Date.now(),
      likedByHer: false,
      likedByAi: false,
    };
    const all = await readJson<FeedPost[]>(this.storage, KEYS.feed, []);
    all.push(post);
    await writeJson(this.storage, KEYS.feed, all);
    this.emit();
    return post;
  }

  async deleteFeedPost(id: string): Promise<boolean> {
    const all = await readJson<FeedPost[]>(this.storage, KEYS.feed, []);
    const next = all.filter((p) => p.id !== id);
    if (next.length === all.length) return false;
    await writeJson(this.storage, KEYS.feed, next);
    // Cascade: drop replies to the deleted post.
    const replies = await readJson<FeedReply[]>(this.storage, KEYS.replies, []);
    await writeJson(
      this.storage,
      KEYS.replies,
      replies.filter((r) => r.postId !== id),
    );
    this.emit();
    return true;
  }

  async toggleFeedLike(id: string, who: FeedAuthor): Promise<FeedPost | null> {
    const all = await readJson<FeedPost[]>(this.storage, KEYS.feed, []);
    const post = all.find((p) => p.id === id);
    if (!post) return null;
    if (who === "her") post.likedByHer = !post.likedByHer;
    else post.likedByAi = !post.likedByAi;
    await writeJson(this.storage, KEYS.feed, all);
    this.emit();
    return post;
  }

  async listReplies(postId: string): Promise<FeedReply[]> {
    const all = await readJson<FeedReply[]>(this.storage, KEYS.replies, []);
    return all.filter((r) => r.postId === postId).sort((a, b) => a.createdAt - b.createdAt);
  }

  async addReply(postId: string, author: FeedAuthor, text: string): Promise<FeedReply> {
    const t = text.trim();
    if (!t) throw new Error("Reply text is required.");
    const posts = await readJson<FeedPost[]>(this.storage, KEYS.feed, []);
    if (!posts.some((p) => p.id === postId)) throw new Error("Post not found.");
    const reply: FeedReply = { id: newId(), postId, author, text: t, createdAt: Date.now() };
    const all = await readJson<FeedReply[]>(this.storage, KEYS.replies, []);
    all.push(reply);
    await writeJson(this.storage, KEYS.replies, all);
    this.emit();
    return reply;
  }

  async deleteReply(id: string): Promise<boolean> {
    const all = await readJson<FeedReply[]>(this.storage, KEYS.replies, []);
    const next = all.filter((r) => r.id !== id);
    if (next.length === all.length) return false;
    await writeJson(this.storage, KEYS.replies, next);
    this.emit();
    return true;
  }

  // ============ v2: anniversaries ============

  async listAnniversaries(): Promise<Anniversary[]> {
    const all = await readJson<Anniversary[]>(this.storage, KEYS.anniversaries, []);
    return all.slice().sort((a, b) => a.date.localeCompare(b.date));
  }

  async addAnniversary(title: string, date: string, description = ""): Promise<Anniversary> {
    const t = title.trim();
    if (!t) throw new Error("Anniversary title is required.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Date must be YYYY-MM-DD.");
    const [y, m, d] = date.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) {
      throw new Error("Date is not a real calendar date.");
    }
    const item: Anniversary = {
      id: newId(),
      title: t,
      date,
      description: description.trim(),
      createdAt: Date.now(),
    };
    const all = await readJson<Anniversary[]>(this.storage, KEYS.anniversaries, []);
    all.push(item);
    await writeJson(this.storage, KEYS.anniversaries, all);
    this.emit();
    return item;
  }

  async deleteAnniversary(id: string): Promise<boolean> {
    const all = await readJson<Anniversary[]>(this.storage, KEYS.anniversaries, []);
    const next = all.filter((a) => a.id !== id);
    if (next.length === all.length) return false;
    await writeJson(this.storage, KEYS.anniversaries, next);
    this.emit();
    return true;
  }

  // ============ v2: works drawer ============

  async listWorks(limit = 200): Promise<WorkItem[]> {
    const all = await readJson<WorkItem[]>(this.storage, KEYS.works, []);
    return newestFirst(all, (w) => w.createdAt).slice(0, Math.max(1, limit));
  }

  async addWork(
    type: WorkType,
    title: string,
    uri: string,
    description = "",
    thumbnailUri?: string,
  ): Promise<WorkItem> {
    const t = title.trim();
    const u = uri.trim();
    if (!t) throw new Error("Work title is required.");
    if (!u) throw new Error("Work URI is required.");
    const item: WorkItem = {
      id: newId(),
      type,
      title: t,
      uri: u,
      thumbnailUri: thumbnailUri?.trim() || undefined,
      description: description.trim(),
      createdAt: Date.now(),
    };
    const all = await readJson<WorkItem[]>(this.storage, KEYS.works, []);
    all.push(item);
    await writeJson(this.storage, KEYS.works, all);
    this.emit();
    return item;
  }

  async deleteWork(id: string): Promise<boolean> {
    const all = await readJson<WorkItem[]>(this.storage, KEYS.works, []);
    const next = all.filter((w) => w.id !== id);
    if (next.length === all.length) return false;
    await writeJson(this.storage, KEYS.works, next);
    this.emit();
    return true;
  }
}
