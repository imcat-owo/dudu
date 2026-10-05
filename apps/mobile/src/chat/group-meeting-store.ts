/**
 * Group meeting persistence (AI 自建群, vision feature 3).
 *
 * PURE module: no React Native imports. Storage is injectable
 * (AsyncStorage in production via group-meeting-instance.ts, Map-backed
 * fake in tests). Writes are serialized so overlapping tool calls can't
 * lose a message.
 */

import {
  type GroupMeeting,
  MEETING_STORAGE_KEY,
  MEETINGS_CAP,
  type MeetingMessage,
} from "./group-meeting";
import { createWriteChain } from "../util/write-chain";

export interface GroupMeetingStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

function newMeetingId(): string {
  return `gm_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function newMessageId(): string {
  return `gmm_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function isValidMeeting(m: unknown): m is GroupMeeting {
  if (typeof m !== "object" || m === null) return false;
  const v = m as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.topic === "string" &&
    Array.isArray(v.members) &&
    Array.isArray(v.transcript) &&
    (v.status === "discussing" || v.status === "done")
  );
}

export interface NewMeeting {
  name: string;
  topic: string;
  reason: string;
  members: GroupMeeting["members"];
  strategy: GroupMeeting["strategy"];
  maxRounds: number;
  createdByThreadId: string;
  planId?: string;
}

export class GroupMeetingStore {
  private writeChain = createWriteChain();
  private listeners = new Set<() => void>();

  constructor(private storage: GroupMeetingStorage) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    // Serialized by the shared write-chain helper (src/util/write-chain.ts).
    return this.writeChain(fn);
  }

  private async readAll(): Promise<GroupMeeting[]> {
    try {
      const raw = await this.storage.getItem(MEETING_STORAGE_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isValidMeeting);
    } catch {
      return [];
    }
  }

  private async writeAll(meetings: GroupMeeting[]): Promise<void> {
    const capped = meetings.slice(-MEETINGS_CAP);
    await this.storage.setItem(MEETING_STORAGE_KEY, JSON.stringify(capped));
    this.emit();
  }

  async create(input: NewMeeting): Promise<GroupMeeting> {
    return this.exclusive(async () => {
      const all = await this.readAll();
      const now = Date.now();
      const meeting: GroupMeeting = {
        id: newMeetingId(),
        name: input.name,
        topic: input.topic,
        reason: input.reason,
        members: input.members,
        strategy: input.strategy,
        maxRounds: input.maxRounds,
        roundsCompleted: 0,
        status: "discussing",
        transcript: [],
        createdByThreadId: input.createdByThreadId,
        ...(input.planId ? { planId: input.planId } : {}),
        createdAt: now,
      };
      all.push(meeting);
      await this.writeAll(all);
      return meeting;
    });
  }

  async get(id: string): Promise<GroupMeeting | null> {
    const all = await this.readAll();
    return all.find((m) => m.id === id) ?? null;
  }

  /** Newest first. */
  async list(): Promise<GroupMeeting[]> {
    const all = await this.readAll();
    return [...all].reverse();
  }

  async appendMessage(
    id: string,
    msg: Omit<MeetingMessage, "id" | "at">,
  ): Promise<MeetingMessage | null> {
    return this.exclusive(async () => {
      const all = await this.readAll();
      const m = all.find((x) => x.id === id);
      if (!m) return null;
      const full: MeetingMessage = { ...msg, id: newMessageId(), at: Date.now() };
      m.transcript.push(full);
      await this.writeAll(all);
      return full;
    });
  }

  async completeRound(id: string): Promise<GroupMeeting | null> {
    return this.exclusive(async () => {
      const all = await this.readAll();
      const m = all.find((x) => x.id === id);
      if (!m) return null;
      m.roundsCompleted += 1;
      await this.writeAll(all);
      return m;
    });
  }

  async end(id: string, conclusion: string): Promise<GroupMeeting | null> {
    return this.exclusive(async () => {
      const all = await this.readAll();
      const m = all.find((x) => x.id === id);
      if (!m) return null;
      m.status = "done";
      m.conclusion = conclusion;
      m.endedAt = Date.now();
      await this.writeAll(all);
      return m;
    });
  }

  /** Test hook. */
  async __resetForTests(): Promise<void> {
    await this.exclusive(async () => {
      await this.storage.setItem(MEETING_STORAGE_KEY, "[]");
      this.emit();
    });
  }
}
