/**
 * ThemeProvider — runtime theming for OpenMuse mobile (theme-design.md §§2,6).
 *
 * - bundle: the effective bundle (a staged try-on wins over confirmed)
 * - resolvedMode: "light" | "dark", from bundle.mode + useColorScheme()
 * - tokens: the 8 surfaces derived for resolvedMode via HCT tonal palettes
 * - stageBundle: try-on — applies in memory only, never persisted (§6.1)
 * - applyBundle: confirm — persists to AsyncStorage AND PUTs /api/theme (§6.2)
 * - rollback: restore the last confirmed bundle (§6.3)
 * - serverVersion: polled from /api/theme; refreshes when it changes
 * - Corrupt stored bundle -> default preset rebuilt, never a blank screen (§6.4)
 *
 * The /api/theme endpoint is optional: when unreachable (or when no apiToken
 * is provided) the provider silently stays on the local cache.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useColorScheme } from "react-native";
import { API_URL } from "../api";
import { deriveSurfaces, type ResolvedMode, resolveMode } from "./derive";
import { defaultPreset } from "./presets";
import { isThemeBundle, type SurfaceId, type SurfaceTokens, type ThemeBundle } from "./types";

export const THEME_STORAGE_KEY = "openmuse.theme.bundle.v1";
const THEME_HISTORY_KEY = "openmuse.theme.history.v1";
const SERVER_POLL_MS = 30_000;
/** Local history cap (theme-design.md §6.2: keep the last 20 confirmed). */
export const THEME_HISTORY_LIMIT = 20;

export type ThemeHistoryEntry = { bundle: ThemeBundle; savedAt: string };

/**
 * Result of applyBundle():
 * - "ok": persisted locally (and PUT to /api/theme when a server is in play)
 * - "local-only": persisted locally, but the PUT to /api/theme failed —
 *   the local cache is the source of truth until the server is reachable
 * - "invalid": the bundle failed validation, nothing was applied
 */
export type ApplyResult = "ok" | "local-only" | "invalid";

export type ThemeContextValue = {
  /** Effective bundle: staged try-on wins over the confirmed bundle. */
  bundle: ThemeBundle;
  /** Last confirmed (persisted) bundle. */
  confirmedBundle: ThemeBundle;
  /** True while a try-on is staged. */
  staging: boolean;
  resolvedMode: ResolvedMode;
  /** The 8 surface token sets for resolvedMode. */
  tokens: Record<SurfaceId, SurfaceTokens>;
  /** Last known /api/theme version, null when the server was never reached. */
  serverVersion: number | null;
  /** Try-on: applies in memory only, never persisted. False if invalid. */
  stageBundle: (bundle: ThemeBundle) => boolean;
  /** Abandon the staged try-on. */
  cancelStage: () => void;
  /** Confirm: persist locally AND PUT to /api/theme. See ApplyResult. */
  applyBundle: (bundle: ThemeBundle) => Promise<ApplyResult>;
  /** Restore the bundle that was confirmed before the last apply. */
  rollback: () => Promise<void>;
  /** Re-check /api/theme now and adopt the bundle if its version changed. */
  refreshFromServer: () => Promise<void>;
  /** Last confirmed bundles, newest first (local, capped at 20). */
  history: ThemeHistoryEntry[];
  /**
   * Bumps on discrete theme changes (try-on start, apply, rollback,
   * remote adopt) — drives the silky crossfade in ThemeTransition.
   * Does NOT bump on every staged update during a color drag.
   */
  transitionKey: number;
};

function buildFallbackValue(bundle: ThemeBundle): ThemeContextValue {
  const resolvedMode = resolveMode(bundle.mode, false);
  return {
    bundle,
    confirmedBundle: bundle,
    staging: false,
    resolvedMode,
    tokens: deriveSurfaces(bundle.seed, resolvedMode),
    serverVersion: null,
    stageBundle: () => false,
    cancelStage: () => {},
    applyBundle: async () => "invalid",
    rollback: async () => {},
    refreshFromServer: async () => {},
    history: [],
    transitionKey: 0,
  };
}

const ThemeContext = createContext<ThemeContextValue>(buildFallbackValue(defaultPreset));

/** Any screen wrapped in ThemeProvider gets live tokens from this hook. */
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

type RemoteTheme = { version: number; bundle: ThemeBundle };

async function persistLocal(bundle: ThemeBundle): Promise<void> {
  try {
    await AsyncStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(bundle));
  } catch {
    // Storage failure must never break theming; in-memory state still applies.
  }
}

async function loadHistory(): Promise<ThemeHistoryEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(THEME_HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is ThemeHistoryEntry =>
        typeof e === "object" &&
        e !== null &&
        isThemeBundle((e as { bundle?: unknown }).bundle) &&
        typeof (e as { savedAt?: unknown }).savedAt === "string",
    );
  } catch {
    return [];
  }
}

async function persistHistory(entries: ThemeHistoryEntry[]): Promise<void> {
  try {
    await AsyncStorage.setItem(THEME_HISTORY_KEY, JSON.stringify(entries.slice(0, THEME_HISTORY_LIMIT)));
  } catch {
    // History is a nice-to-have; never break theming over it.
  }
}

export function ThemeProvider({
  children,
  apiToken,
}: {
  children: ReactNode;
  apiToken?: string;
}): ReactNode {
  const systemScheme = useColorScheme();
  const [confirmed, setConfirmed] = useState<ThemeBundle>(defaultPreset);
  const [staged, setStaged] = useState<ThemeBundle | null>(null);
  const [serverVersion, setServerVersion] = useState<number | null>(null);
  const [history, setHistory] = useState<ThemeHistoryEntry[]>([]);
  const [transitionKey, setTransitionKey] = useState(0);
  const bumpTransition = useCallback(() => setTransitionKey((k) => k + 1), []);

  const confirmedRef = useRef(confirmed);
  const previousRef = useRef<ThemeBundle | null>(null);
  const serverVersionRef = useRef<number | null>(null);
  const stagedRef = useRef<ThemeBundle | null>(null);

  useEffect(() => {
    confirmedRef.current = confirmed;
  }, [confirmed]);

  useEffect(() => {
    stagedRef.current = staged;
  }, [staged]);

  // ---- local cache: load on mount, self-heal on corruption ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let next: ThemeBundle = defaultPreset;
      try {
        const raw = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (raw !== null) {
          let parsed: unknown = null;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = null;
          }
          if (isThemeBundle(parsed)) {
            next = parsed;
          } else {
            // Corrupt cache: rebuild the default bundle (self-heal, never blank).
            await persistLocal(defaultPreset);
          }
        }
      } catch {
        next = defaultPreset;
      }
      if (!cancelled) setConfirmed(next);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- local history: load on mount ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await loadHistory();
      if (!cancelled) setHistory(entries);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Archive the outgoing confirmed bundle before it gets replaced. */
  const archiveCurrent = useCallback(async () => {
    const entry: ThemeHistoryEntry = {
      bundle: confirmedRef.current,
      savedAt: new Date().toISOString(),
    };
    setHistory((prev) => {
      const next = [entry, ...prev].slice(0, THEME_HISTORY_LIMIT);
      void persistHistory(next);
      return next;
    });
  }, []);

  // ---- server sync: /api/theme is optional, local cache is the fallback ----
  const fetchRemote = useCallback(async (): Promise<RemoteTheme | null> => {
    if (!apiToken) return null;
    try {
      const res = await fetch(`${API_URL}/api/theme`, {
        headers: { Authorization: `Bearer ${apiToken}` },
      });
      if (!res.ok) return null;
      const payload = (await res.json()) as { version?: unknown; bundle?: unknown };
      if (typeof payload.version !== "number" || !isThemeBundle(payload.bundle)) return null;
      return { version: payload.version, bundle: payload.bundle };
    } catch {
      return null;
    }
  }, [apiToken]);

  const refreshFromServer = useCallback(async (): Promise<void> => {
    const remote = await fetchRemote();
    if (!remote) return;
    if (serverVersionRef.current === remote.version) return;
    // Never clobber an active try-on: the user is mid-preview and the
    // banner offers Apply/Discard. Skip this poll; the next one retries
    // after staging ends (review P2-2, 2026-10-03).
    if (stagedRef.current) return;
    serverVersionRef.current = remote.version;
    setServerVersion(remote.version);
    bumpTransition();
    setConfirmed(remote.bundle);
    await persistLocal(remote.bundle);
  }, [fetchRemote, bumpTransition]);

  useEffect(() => {
    void refreshFromServer();
    const timer = setInterval(() => {
      void refreshFromServer();
    }, SERVER_POLL_MS);
    return () => clearInterval(timer);
  }, [refreshFromServer]);

  // ---- try-on / confirm / rollback (safety net §6) ----
  const stageBundle = useCallback((bundle: ThemeBundle): boolean => {
    if (!isThemeBundle(bundle)) return false;
    // Discrete start of a try-on bumps the transition; continuous
    // updates during a color drag do not (the live preview is already smooth).
    if (!stagedRef.current) bumpTransition();
    setStaged(bundle); // in memory only — never persisted
    return true;
  }, [bumpTransition]);

  const cancelStage = useCallback((): void => {
    setStaged(null);
  }, []);

  const applyBundle = useCallback(
    async (bundle: ThemeBundle): Promise<ApplyResult> => {
      if (!isThemeBundle(bundle)) return "invalid";
      const stamped: ThemeBundle = {
        ...bundle,
        meta: { ...bundle.meta, updatedAt: new Date().toISOString() },
      };
      previousRef.current = confirmedRef.current;
      await archiveCurrent();
      bumpTransition();
      setConfirmed(stamped);
      setStaged(null);
      await persistLocal(stamped);
      if (!apiToken) return "ok"; // local mode: the cache is the whole truth
      try {
        const res = await fetch(`${API_URL}/api/theme`, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${apiToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ bundle: stamped }),
        });
        if (!res.ok) return "local-only";
        // Adopt the new server version so the poll doesn't redundantly
        // re-fetch the bundle we just wrote (review P3-2, 2026-10-03).
        const payload = (await res.json()) as { version?: unknown };
        if (typeof payload.version === "number") {
          serverVersionRef.current = payload.version;
          setServerVersion(payload.version);
        }
        return "ok";
      } catch {
        // Server unreachable: report honestly — local is applied, the
        // server never got it. The next poll will retry the sync.
        return "local-only";
      }
    },
    [apiToken, archiveCurrent, bumpTransition],
  );

  const rollback = useCallback(async (): Promise<void> => {
    const target = previousRef.current ?? defaultPreset;
    const stamped: ThemeBundle = {
      ...target,
      meta: { ...target.meta, updatedAt: new Date().toISOString() },
    };
    await archiveCurrent();
    bumpTransition();
    setStaged(null);
    setConfirmed(stamped);
    await persistLocal(stamped);
    if (apiToken) {
      // Push the rollback to the server too, and adopt the new server
      // version — otherwise the 30s poll would fetch the pre-rollback
      // bundle and silently undo the rollback (review P2-1, 2026-10-03).
      try {
        const res = await fetch(`${API_URL}/api/theme`, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${apiToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ bundle: stamped }),
        });
        if (res.ok) {
          const payload = (await res.json()) as { version?: unknown };
          if (typeof payload.version === "number") {
            serverVersionRef.current = payload.version;
            setServerVersion(payload.version);
          }
        }
      } catch {
        // Server unreachable: the local cache stays the source of truth.
      }
    }
  }, [apiToken]);

  const effective = staged ?? confirmed;
  const resolvedMode = resolveMode(effective.mode, systemScheme === "dark");
  const tokens = useMemo(
    () => deriveSurfaces(effective.seed, resolvedMode),
    [effective.seed, resolvedMode],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({
      bundle: effective,
      confirmedBundle: confirmed,
      staging: staged !== null,
      resolvedMode,
      tokens,
      serverVersion,
      stageBundle,
      cancelStage,
      applyBundle,
      rollback,
      refreshFromServer,
      history,
      transitionKey,
    }),
    [
      effective,
      confirmed,
      staged,
      resolvedMode,
      tokens,
      serverVersion,
      stageBundle,
      cancelStage,
      applyBundle,
      rollback,
      refreshFromServer,
      history,
      transitionKey,
    ],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
