/**
 * Web apps — saved web pages pinned as app-like shortcuts. PURE module.
 *
 * From OpenMinis: pin a frequently-used web page so it opens in a clean
 * WebView without browser chrome. She can give it a name and icon.
 *
 * Storage: "dudu.webapps.v1.list" (JSON: WebApp[]).
 */

/** One saved web app. */
export interface WebApp {
  id: string;
  /** Display name, e.g. "小红书". */
  name: string;
  /** The URL to open. */
  url: string;
  /** Icon: URL, or null for a letter tile. */
  icon: string | null;
  createdAt: number;
}

/** Minimal storage surface. */
export interface WebAppStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem?: (key: string) => Promise<void>;
}

const WEBAPPS_KEY = "dudu.webapps.v1.list";

export function newWebAppId(): string {
  return `webapp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Validate a web app (returns error code or null). */
export function validateWebApp(name: string, url: string): string | null {
  if (!name.trim()) return "name-required";
  if (name.trim().length > 30) return "name-too-long";
  if (!url.trim()) return "url-required";
  try {
    const u = new URL(url.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return "url-scheme";
  } catch {
    return "url-invalid";
  }
  return null;
}

export function createWebAppStore(storage: WebAppStorage) {
  const listeners = new Set<() => void>();

  function emit() {
    for (const l of listeners) l();
  }

  async function load(): Promise<WebApp[]> {
    try {
      const raw = await storage.getItem(WEBAPPS_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter((w) => w && typeof w.id === "string") : [];
    } catch {
      return [];
    }
  }

  async function save(next: WebApp[]): Promise<void> {
    await storage.setItem(WEBAPPS_KEY, JSON.stringify(next));
    emit();
  }

  return {
    subscribe(l: () => void) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },

    async list(): Promise<WebApp[]> {
      const all = await load();
      return [...all].sort((a, b) => b.createdAt - a.createdAt);
    },

    async add(name: string, url: string, icon?: string | null): Promise<{ app?: WebApp; error?: string }> {
      const err = validateWebApp(name, url);
      if (err) return { error: err };
      const all = await load();
      const app: WebApp = {
        id: newWebAppId(),
        name: name.trim(),
        url: url.trim(),
        icon: icon ?? null,
        createdAt: Date.now(),
      };
      await save([...all, app]);
      return { app };
    },

    async remove(id: string): Promise<void> {
      const all = await load();
      await save(all.filter((w) => w.id !== id));
    },

    async update(id: string, patch: Partial<Pick<WebApp, "name" | "url" | "icon">>): Promise<string | null> {
      const all = await load();
      const idx = all.findIndex((w) => w.id === id);
      if (idx < 0) return "not-found";
      const next = { ...all[idx], ...patch };
      const err = validateWebApp(next.name, next.url);
      if (err) return err;
      const updated = all.map((w, i) => (i === idx ? next : w));
      await save(updated);
      return null;
    },
  };
}

export type WebAppStore = ReturnType<typeof createWebAppStore>;
