/**
 * Browser tabs + history — PURE module (no React Native imports).
 *
 * D4: A browser for humans — multiple tabs, history, and cookie audit.
 * The AI drives the active tab through browserController; she can open
 * her own tabs, flip between them, and see where she's been.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";

const HISTORY_KEY = "dudu.browser-history.v1";
const MAX_HISTORY = 200;

export interface BrowserTab {
  id: string;
  url: string;
  title: string;
}

export interface HistoryEntry {
  url: string;
  title: string;
  visitedAt: number;
}

let tabSeq = 0;

export function createTabStore() {
  let tabs: BrowserTab[] = [{ id: "tab_0", url: "about:blank", title: "New Tab" }];
  let activeId = "tab_0";
  let history: HistoryEntry[] = [];
  const listeners = new Set<() => void>();

  let snapshot = { tabs, activeId, history, loaded: false };

  function emit() {
    snapshot = { tabs: [...tabs], activeId, history: [...history], loaded: true };
    for (const l of listeners) l();
  }

  let historyLoaded = false;
  async function ensureHistory(): Promise<void> {
    if (historyLoaded) return;
    historyLoaded = true;
    try {
      const raw = await AsyncStorage.getItem(HISTORY_KEY);
      if (raw) history = JSON.parse(raw) as HistoryEntry[];
    } catch {
      // ignore
    }
    emit();
  }
  void ensureHistory();

  async function persistHistory(): Promise<void> {
    try {
      await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
    } catch {
      // ignore
    }
  }

  return {
    subscribe(l: () => void) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    getSnapshot() {
      return snapshot;
    },

    openTab(url = "about:blank"): string {
      const id = `tab_${Date.now()}_${++tabSeq}`;
      tabs = [...tabs, { id, url, title: "New Tab" }];
      activeId = id;
      emit();
      return id;
    },

    closeTab(id: string): void {
      if (tabs.length <= 1) {
        // Keep at least one tab.
        tabs = [{ id: "tab_0", url: "about:blank", title: "New Tab" }];
        activeId = "tab_0";
      } else {
        const idx = tabs.findIndex((t) => t.id === id);
        tabs = tabs.filter((t) => t.id !== id);
        if (activeId === id) {
          activeId = tabs[Math.max(0, idx - 1)].id;
        }
      }
      emit();
    },

    activateTab(id: string): void {
      if (tabs.some((t) => t.id === id)) {
        activeId = id;
        emit();
      }
    },

    navigateTab(id: string, url: string): void {
      tabs = tabs.map((t) => (t.id === id ? { ...t, url } : t));
      emit();
    },

    setTabTitle(id: string, title: string): void {
      tabs = tabs.map((t) => (t.id === id ? { ...t, title } : t));
      emit();
    },

    getActive(): BrowserTab {
      return tabs.find((t) => t.id === activeId) ?? tabs[0];
    },

    async recordHistory(url: string, title: string): Promise<void> {
      if (!url || url === "about:blank") return;
      await ensureHistory();
      // Avoid consecutive duplicates.
      if (history[0]?.url === url) return;
      history = [{ url, title, visitedAt: Date.now() }, ...history].slice(0, MAX_HISTORY);
      await persistHistory();
      emit();
    },

    async clearHistory(): Promise<void> {
      history = [];
      await persistHistory();
      emit();
    },

    async searchHistory(query: string): Promise<HistoryEntry[]> {
      await ensureHistory();
      const q = query.toLowerCase();
      return history.filter(
        (h) => h.url.toLowerCase().includes(q) || h.title.toLowerCase().includes(q),
      );
    },
  };
}

export const browserTabStore = createTabStore();

export function useBrowserTabs(): {
  tabs: BrowserTab[];
  activeId: string;
  history: HistoryEntry[];
  loaded: boolean;
} {
  const snap = useSyncExternalStore(
    browserTabStore.subscribe,
    browserTabStore.getSnapshot,
    browserTabStore.getSnapshot,
  );
  return snap;
}
