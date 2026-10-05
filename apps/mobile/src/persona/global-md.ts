/**
 * GLOBAL.md — the user's hand-written preference file. PURE module.
 *
 * Unlike memories (which the AI infers), GLOBAL.md is written BY HER, read
 * ONLY by the AI. "我不吃辣" written once here beats the AI guessing from
 * chat every time. The local-agent injects this into the system prompt
 * (integration point — see below).
 *
 * Storage: "dudu.global-md.v1" (plain text markdown).
 */

/** Minimal storage surface. */
export interface GlobalMdStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

const GLOBAL_MD_KEY = "dudu.global-md.v1";

/** Max length to keep the system prompt sane (roughly 8k tokens). */
export const GLOBAL_MD_MAX_LENGTH = 32000;

export function createGlobalMdStore(storage: GlobalMdStorage) {
  const listeners = new Set<() => void>();

  function emit() {
    for (const l of listeners) l();
  }

  return {
    subscribe(l: () => void) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },

    async get(): Promise<string> {
      try {
        return (await storage.getItem(GLOBAL_MD_KEY)) ?? "";
      } catch {
        return "";
      }
    },

    /** Save her GLOBAL.md. Truncates to the max length. */
    async set(markdown: string): Promise<void> {
      const trimmed = markdown.slice(0, GLOBAL_MD_MAX_LENGTH);
      await storage.setItem(GLOBAL_MD_KEY, trimmed);
      emit();
    },

    /** True when she has written something. */
    async has(): Promise<boolean> {
      const v = await this.get();
      return v.trim().length > 0;
    },
  };
}

export type GlobalMdStore = ReturnType<typeof createGlobalMdStore>;

/**
 * Render GLOBAL.md as a system-prompt block.
 * The local-agent should call this and append the result to the system prompt.
 * (Integration point — local-agent.ts must wire this in.)
 */
export function renderGlobalMdBlock(markdown: string): string {
  const trimmed = markdown.trim();
  if (!trimmed) return "";
  return `## 她的亲笔偏好（GLOBAL.md，只读）\n${trimmed}`;
}
