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

export interface MemoryItem {
  id: string;
  text: string;
  confidence: MemoryConfidence;
  createdAt: number;
  updatedAt: number;
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

/** Minimal storage surface. AsyncStorage satisfies this in production. */
export interface OurSpaceStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

const KEYS = {
  diary: "openmuse.ourspace.v1.diary",
  timeline: "openmuse.ourspace.v1.timeline",
  memory: "openmuse.ourspace.v1.memory",
  tellLater: "openmuse.ourspace.v1.telllater",
  status: "openmuse.ourspace.v1.status",
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

  // ---- Memory garden ----

  async listMemories(confidence?: MemoryConfidence): Promise<MemoryItem[]> {
    const all = await readJson<MemoryItem[]>(this.storage, KEYS.memory, []);
    const filtered = confidence ? all.filter((m) => m.confidence === confidence) : all;
    return newestFirst(filtered, (m) => m.updatedAt);
  }

  async addMemory(text: string, confidence: MemoryConfidence = "sprouting"): Promise<MemoryItem> {
    const t = text.trim();
    if (!t) throw new Error("Memory text is required.");
    const item: MemoryItem = {
      id: newId(),
      text: t,
      confidence,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const all = await readJson<MemoryItem[]>(this.storage, KEYS.memory, []);
    all.push(item);
    await writeJson(this.storage, KEYS.memory, all);
    this.emit();
    return item;
  }

  async updateMemory(
    id: string,
    patch: { text?: string; confidence?: MemoryConfidence },
  ): Promise<MemoryItem | null> {
    const all = await readJson<MemoryItem[]>(this.storage, KEYS.memory, []);
    const item = all.find((m) => m.id === id);
    if (!item) return null;
    if (patch.text?.trim()) item.text = patch.text.trim();
    if (patch.confidence) item.confidence = patch.confidence;
    item.updatedAt = Date.now();
    await writeJson(this.storage, KEYS.memory, all);
    this.emit();
    return item;
  }

  async deleteMemory(id: string): Promise<boolean> {
    const all = await readJson<MemoryItem[]>(this.storage, KEYS.memory, []);
    const next = all.filter((m) => m.id !== id);
    if (next.length === all.length) return false;
    await writeJson(this.storage, KEYS.memory, next);
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
}
