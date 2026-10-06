/**
 * Interactive story mode （互动故事） — story store.
 * AsyncStorage-backed, write-serialized, injectable storage for tests.
 *
 * One story per persona per dialog is the norm, but the store doesn't
 * enforce it — the tools do (story_start refuses when this thread already
 * has an active story). Lookup by thread is how the prompt section and
 * the chat choice-chips find "the story being told here".
 */

import { blankBible, isStoryStatus, type Story, type StoryBible, type StoryStatus } from "./types";

const KEY = "dudu.story.v1.stories";
const STORIES_CAP = 200;

export interface StoryStorage {
  getItem(k: string): Promise<string | null>;
  setItem(k: string, v: string): Promise<void>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function sanitizeBible(v: unknown): StoryBible {
  const out = blankBible();
  if (!isRecord(v)) return out;
  if (Array.isArray(v.characters)) {
    for (const c of v.characters) {
      if (isRecord(c) && typeof c.name === "string" && c.name.trim()) {
        out.characters.push({
          name: c.name.trim(),
          desc: typeof c.desc === "string" ? c.desc : "",
        });
      }
    }
  }
  if (Array.isArray(v.places)) {
    for (const p of v.places) {
      if (isRecord(p) && typeof p.name === "string" && p.name.trim()) {
        out.places.push({ name: p.name.trim(), desc: typeof p.desc === "string" ? p.desc : "" });
      }
    }
  }
  if (Array.isArray(v.events)) {
    for (const e of v.events) {
      if (isRecord(e) && typeof e.text === "string" && e.text.trim()) {
        out.events.push({
          text: e.text.trim(),
          at: typeof e.at === "number" && Number.isFinite(e.at) ? e.at : 0,
        });
      }
    }
  }
  return out;
}

function sanitizeStory(v: unknown): Story | null {
  if (!isRecord(v)) return null;
  const {
    id,
    personaId,
    threadId,
    title,
    premise,
    status,
    currentChapter,
    scenes,
    bible,
    createdAt,
    updatedAt,
  } = v;
  if (typeof id !== "string" || !id) return null;
  if (typeof personaId !== "string" || !personaId) return null;
  if (typeof threadId !== "string" || !threadId) return null;
  if (typeof title !== "string" || !title.trim()) return null;
  const st: StoryStatus = isStoryStatus(status) ? status : "active";
  const cleanScenes: Story["scenes"] = [];
  if (Array.isArray(scenes)) {
    for (const s of scenes) {
      if (!isRecord(s) || typeof s.id !== "string" || !s.id) continue;
      if (typeof s.summary !== "string") continue;
      const offered = Array.isArray(s.offeredChoices)
        ? s.offeredChoices
            .filter(
              (c): c is { id: string; label: string } =>
                isRecord(c) && typeof c.id === "string" && typeof c.label === "string",
            )
            .map((c) => ({ id: c.id, label: c.label }))
        : [];
      cleanScenes.push({
        id: s.id,
        chapter: typeof s.chapter === "number" && s.chapter >= 1 ? Math.floor(s.chapter) : 1,
        seq: typeof s.seq === "number" && s.seq >= 1 ? Math.floor(s.seq) : 1,
        summary: s.summary,
        offeredChoices: offered,
        chosenChoiceId:
          typeof s.chosenChoiceId === "string" && offered.some((c) => c.id === s.chosenChoiceId)
            ? s.chosenChoiceId
            : null,
        freeNote: typeof s.freeNote === "string" ? s.freeNote : "",
        at: typeof s.at === "number" && Number.isFinite(s.at) ? s.at : 0,
      });
    }
  }
  return {
    id,
    personaId,
    threadId,
    title: title.trim(),
    premise: typeof premise === "string" ? premise : "",
    status: st,
    currentChapter:
      typeof currentChapter === "number" && currentChapter >= 1 ? Math.floor(currentChapter) : 1,
    scenes: cleanScenes,
    bible: sanitizeBible(bible),
    createdAt: typeof createdAt === "number" ? createdAt : 0,
    updatedAt: typeof updatedAt === "number" ? updatedAt : 0,
  };
}

export interface StoryCreateInput {
  personaId: string;
  threadId: string;
  title: string;
  premise: string;
}

export class StoryStore {
  private queue: Promise<void> = Promise.resolve();

  constructor(private storage: StoryStorage) {}

  private run<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(fn);
    this.queue = p.then(
      () => undefined,
      () => undefined,
    );
    return p;
  }

  private async loadAll(): Promise<Story[]> {
    try {
      const raw = await this.storage.getItem(KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const out: Story[] = [];
      for (const v of parsed) {
        const s = sanitizeStory(v);
        if (s) out.push(s);
      }
      return out;
    } catch {
      return [];
    }
  }

  private async saveAll(stories: Story[]): Promise<void> {
    const capped = stories.slice(-STORIES_CAP);
    await this.storage.setItem(KEY, JSON.stringify(capped));
  }

  /** Create a story. Never throws — returns null on invalid input. */
  async create(input: StoryCreateInput, nowMs: number): Promise<Story | null> {
    const personaId = input.personaId.trim();
    const threadId = input.threadId.trim();
    const title = input.title.trim();
    if (!personaId || !threadId || !title) return null;
    return this.run(async () => {
      const stories = await this.loadAll();
      const now = nowMs;
      const story: Story = {
        id: `st_${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`,
        personaId,
        threadId,
        title,
        premise: input.premise.trim(),
        status: "active",
        currentChapter: 1,
        scenes: [],
        bible: blankBible(),
        createdAt: now,
        updatedAt: now,
      };
      stories.push(story);
      await this.saveAll(stories);
      return story;
    });
  }

  async get(id: string): Promise<Story | null> {
    const stories = await this.loadAll();
    return stories.find((s) => s.id === id) ?? null;
  }

  /**
   * All stories for a persona, newest first. Ended stories included only
   * when includeEnded is true (history view).
   */
  async list(personaId: string, includeEnded = false): Promise<Story[]> {
    const stories = await this.loadAll();
    return stories
      .filter((s) => s.personaId === personaId && (includeEnded || s.status !== "ended"))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** The story being told in this dialog (active or paused). Newest wins. */
  async findByThread(threadId: string): Promise<Story | null> {
    const stories = await this.loadAll();
    const hit = stories
      .filter((s) => s.threadId === threadId && s.status !== "ended")
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    return hit ?? null;
  }

  /** Apply a mutation to one story. Returns the updated story, or null. */
  async update(id: string, nowMs: number, fn: (s: Story) => Story | null): Promise<Story | null> {
    return this.run(async () => {
      const stories = await this.loadAll();
      const idx = stories.findIndex((s) => s.id === id);
      if (idx < 0) return null;
      const next = fn(stories[idx]);
      if (!next) return null;
      next.updatedAt = nowMs;
      stories[idx] = next;
      await this.saveAll(stories);
      return next;
    });
  }

  async remove(id: string): Promise<boolean> {
    return this.run(async () => {
      const stories = await this.loadAll();
      const kept = stories.filter((s) => s.id !== id);
      if (kept.length === stories.length) return false;
      await this.saveAll(kept);
      return true;
    });
  }
}
