/**
 * World book store — PURE module: no React Native / expo imports.
 *
 * Persists world books on the injectable KV backend:
 *   worldbooks -> "dudu.worldbook.v1.list" (JSON: WorldBook[])
 */

import { blankWorldBook, type WorldBook } from "./world-book";
import { createWriteChain } from "../util/write-chain";

/** Minimal storage surface. AsyncStorage satisfies this in production. */
export interface WorldBookStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem?: (key: string) => Promise<void>;
}

const WORLD_BOOKS_KEY = "dudu.worldbook.v1.list";

export function createWorldBookStore(storage: WorldBookStorage) {
  const chain = createWriteChain();
  let books: WorldBook[] | null = null;
  const listeners = new Set<() => void>();

  function emit() {
    for (const l of listeners) l();
  }

  async function load(): Promise<WorldBook[]> {
    if (books) return books;
    try {
      const raw = await storage.getItem(WORLD_BOOKS_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      books = Array.isArray(arr) ? arr.filter((b) => b && typeof b.id === "string") : [];
    } catch {
      books = [];
    }
    return books;
  }

  async function save(next: WorldBook[]): Promise<void> {
    books = next;
    await chain(() => storage.setItem(WORLD_BOOKS_KEY, JSON.stringify(next)));
    emit();
  }

  return {
    subscribe(l: () => void) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },

    async list(): Promise<WorldBook[]> {
      const all = await load();
      return [...all].sort((a, b) => b.updatedAt - a.updatedAt);
    },

    async get(id: string): Promise<WorldBook | null> {
      const all = await load();
      return all.find((b) => b.id === id) ?? null;
    },

    async upsert(book: WorldBook): Promise<void> {
      const all = await load();
      const next: WorldBook = { ...book, updatedAt: Date.now() };
      const idx = all.findIndex((x) => x.id === next.id);
      const updated = idx >= 0 ? all.map((x, i) => (i === idx ? next : x)) : [...all, next];
      await save(updated);
    },

    async remove(id: string): Promise<void> {
      const all = await load();
      await save(all.filter((b) => b.id !== id));
    },

    /** Enabled books only, for the activation pass. */
    async enabledBooks(): Promise<WorldBook[]> {
      const all = await load();
      return all.filter((b) => b.enabled);
    },

    blank(): WorldBook {
      return blankWorldBook();
    },
  };
}

export type WorldBookStore = ReturnType<typeof createWorldBookStore>;
