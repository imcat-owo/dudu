/**
 * Interactive story mode （互动故事） — types. PURE module: no React
 * Native / expo imports, no I/O. All time flows through injected `nowMs`
 * in the store/tools layer.
 *
 * A story is a co-written interactive narrative: he narrates in scenes,
 * she steers with choices (A/B/C) or free responses. The story bible
 * (characters, places, key events) keeps long stories coherent — it is
 * visible to her (Our Space → 互动故事） and editable by her, never a
 * secret the AI retcons behind her back.
 *
 * A story is bound to ONE dialog (threadId) and ONE persona. Stories are
 * part of normal chat, not a separate app: ending/pausing a story returns
 * the dialog to normal chat. The AI must NEVER trap her in story mode.
 */

export type StoryStatus = "active" | "paused" | "ended";

export interface StoryCharacter {
  name: string;
  desc: string;
}

export interface StoryPlace {
  name: string;
  desc: string;
}

export interface StoryEvent {
  text: string;
  at: number;
}

export interface StoryBible {
  characters: StoryCharacter[];
  places: StoryPlace[];
  events: StoryEvent[];
}

export interface StoryChoice {
  /** Stable within a scene: "A", "B", "C"... */
  id: string;
  /** Short label, e.g. "推开那扇门". */
  label: string;
}

export interface StoryScene {
  id: string;
  chapter: number;
  /** 1-based scene number within the chapter. */
  seq: number;
  /** The AI's own summary of what happened in this scene (not the full text). */
  summary: string;
  /** Choices offered at the end of this scene. Empty = open response. */
  offeredChoices: StoryChoice[];
  /** The choice she picked. null = open response, or not picked yet. */
  chosenChoiceId: string | null;
  /** When offeredChoices was empty: her free-response gist (optional). */
  freeNote: string;
  at: number;
}

export interface Story {
  id: string;
  personaId: string;
  /** The dialog where this story is being told. Rebound on resume. */
  threadId: string;
  title: string;
  /** The agreed premise, e.g. "雾岛上的灯塔，潮汐里捡到黄铜钥匙". */
  premise: string;
  status: StoryStatus;
  currentChapter: number;
  scenes: StoryScene[];
  bible: StoryBible;
  createdAt: number;
  updatedAt: number;
}

export function newStoryId(nowMs: number = Date.now()): string {
  return `st_${nowMs.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function newSceneId(nowMs: number = Date.now()): string {
  return `ss_${nowMs.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function blankBible(): StoryBible {
  return { characters: [], places: [], events: [] };
}

export function isStoryStatus(v: unknown): v is StoryStatus {
  return v === "active" || v === "paused" || v === "ended";
}

/** The scene awaiting her pick: latest scene with unpicked offered choices. */
export function pendingChoiceScene(story: Story): StoryScene | null {
  for (let i = story.scenes.length - 1; i >= 0; i--) {
    const s = story.scenes[i];
    if (s.offeredChoices.length > 0 && s.chosenChoiceId === null) return s;
  }
  return null;
}

/** Latest scene overall, if any. */
export function latestScene(story: Story): StoryScene | null {
  return story.scenes.length > 0 ? story.scenes[story.scenes.length - 1] : null;
}

/** Next scene seq number for a chapter (1-based). */
export function nextSceneSeq(story: Story, chapter: number): number {
  let n = 0;
  for (const s of story.scenes) if (s.chapter === chapter) n++;
  return n + 1;
}
