/**
 * Persona group chat persistence. PURE module: no React Native imports.
 * Storage is injectable (AsyncStorage in production via
 * persona-group-instance.ts, Map-backed fake in tests). Writes are
 * serialized so overlapping turns can't lose a message — records are
 * preserved, never trimmed silently (her spec rule 8).
 */

import { createWriteChain } from "../util/write-chain";
import {
  createPersonaGroup,
  GROUPS_CAP,
  newGroupMessageId,
  PERSONA_GROUP_STORAGE_KEY,
  type PersonaGroup,
  type PersonaGroupMessage,
  type PersonaGroupSender,
} from "./persona-group";

export interface PersonaGroupStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

function isValidGroup(g: unknown): g is PersonaGroup {
  if (typeof g !== "object" || g === null) return false;
  const v = g as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    Array.isArray(v.members) &&
    Array.isArray(v.messages) &&
    Array.isArray(v.spokeThisRound)
  );
}

export class PersonaGroupStore {
  private writeChain = createWriteChain();
  private listeners = new Set<() => void>();

  constructor(private storage: PersonaGroupStorage) {}

  subscribe(listener: () => void): () => void {
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

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    return this.writeChain(fn).then((v) => {
      this.emit();
      return v;
    });
  }

  private async readAll(): Promise<PersonaGroup[]> {
    try {
      const raw = await this.storage.getItem(PERSONA_GROUP_STORAGE_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw) as unknown;
      if (!Array.isArray(arr)) return [];
      return arr.filter(isValidGroup);
    } catch {
      return [];
    }
  }

  private async writeAll(groups: PersonaGroup[]): Promise<void> {
    await this.storage.setItem(PERSONA_GROUP_STORAGE_KEY, JSON.stringify(groups));
  }

  async list(includeArchived = false): Promise<PersonaGroup[]> {
    const all = await this.readAll();
    const visible = includeArchived ? all : all.filter((g) => !g.archived);
    return visible.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id: string): Promise<PersonaGroup | null> {
    const all = await this.readAll();
    return all.find((g) => g.id === id) ?? null;
  }

  async create(name: string, memberPersonaIds: string[]): Promise<PersonaGroup> {
    return this.exclusive(async () => {
      const all = await this.readAll();
      const group = createPersonaGroup(name, memberPersonaIds);
      const next = [group, ...all].slice(0, GROUPS_CAP);
      await this.writeAll(next);
      return group;
    });
  }

  async update(group: PersonaGroup): Promise<void> {
    group.updatedAt = Date.now();
    await this.exclusive(async () => {
      const all = await this.readAll();
      const next = all.map((g) => (g.id === group.id ? group : g));
      await this.writeAll(next);
    });
  }

  async addMember(groupId: string, personaId: string): Promise<PersonaGroup | null> {
    return this.exclusive(async () => {
      const all = await this.readAll();
      const group = all.find((g) => g.id === groupId);
      if (!group || group.archived) return null;
      if (!group.members.some((m) => m.personaId === personaId)) {
        group.members.push({ personaId, joinedAt: Date.now() });
        group.updatedAt = Date.now();
        await this.writeAll(all);
      }
      return group;
    });
  }

  async removeMember(groupId: string, personaId: string): Promise<PersonaGroup | null> {
    return this.exclusive(async () => {
      const all = await this.readAll();
      const group = all.find((g) => g.id === groupId);
      if (!group || group.archived) return null;
      group.members = group.members.filter((m) => m.personaId !== personaId);
      group.updatedAt = Date.now();
      await this.writeAll(all);
      return group;
    });
  }

  async appendMessage(
    groupId: string,
    from: PersonaGroupSender,
    text: string,
    tools?: PersonaGroupMessage["tools"],
  ): Promise<PersonaGroupMessage | null> {
    return this.exclusive(async () => {
      const all = await this.readAll();
      const group = all.find((g) => g.id === groupId);
      if (!group || group.archived) return null;
      const msg: PersonaGroupMessage = {
        id: newGroupMessageId(),
        from,
        text,
        at: Date.now(),
        ...(tools && tools.length > 0 ? { tools } : {}),
      };
      group.messages.push(msg);
      group.updatedAt = Date.now();
      await this.writeAll(all);
      return msg;
    });
  }

  /** She spoke -> new round: clear the per-round speaker ledger (rule ③). */
  async resetRound(groupId: string): Promise<void> {
    await this.exclusive(async () => {
      const all = await this.readAll();
      const group = all.find((g) => g.id === groupId);
      if (!group) return;
      group.spokeThisRound = [];
      group.updatedAt = Date.now();
      await this.writeAll(all);
    });
  }

  /** Mark personas as having spoken this round (bounded interaction). */
  async markSpoken(groupId: string, personaIds: string[]): Promise<void> {
    await this.exclusive(async () => {
      const all = await this.readAll();
      const group = all.find((g) => g.id === groupId);
      if (!group) return;
      const seen = new Set(group.spokeThisRound);
      for (const id of personaIds) seen.add(id);
      group.spokeThisRound = [...seen];
      group.updatedAt = Date.now();
      await this.writeAll(all);
    });
  }

  async setArchived(groupId: string, archived: boolean): Promise<PersonaGroup | null> {
    return this.exclusive(async () => {
      const all = await this.readAll();
      const group = all.find((g) => g.id === groupId);
      if (!group) return null;
      group.archived = archived;
      group.updatedAt = Date.now();
      await this.writeAll(all);
      return group;
    });
  }
}
