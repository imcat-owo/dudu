/**
 * Sandbox manager: backend selection + SSH config persistence.
 *
 * - Active backend id persisted (AsyncStorage; default "cloud").
 * - SSH config (host/user/key/password) persisted in SecureStore — never in
 *   the repo, never hardcoded. Lazy expo-secure-store import so this module
 *   stays importable in node tests (same pattern as session-store.ts).
 */

import { IshSandboxBackend } from "./backend-ish";
import { SshDockerBackend } from "./backend-ssh-docker";
import {
  activeServer,
  deleteServer as deleteServerFromStore,
  EMPTY_SERVER_STORE,
  migrateLegacySshConfig,
  parseServerStore,
  type SandboxServer,
  type SandboxServerStore,
  upsertServer,
} from "./servers";
import { RelaySshTransport } from "./transport-relay";
import type { SandboxBackend, SandboxBackendId, SshConfig } from "./types";

const ACTIVE_KEY = "dudu.sandbox.activeBackend.v1";
/** Legacy single-server config key — read once for migration, then removed. */
const SSH_CONFIG_KEY = "dudu.sandbox.sshConfig.v1";
/** Multi-server list (names + per-server SshConfig, secrets included). SecureStore. */
const SERVERS_KEY = "dudu.sandbox.servers.v1";

export interface SecureBackend {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}

export interface PrefsBackend {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

const memoryPrefs = (): PrefsBackend => {
  const m = new Map<string, string>();
  return {
    getItem: async (k) => m.get(k) ?? null,
    setItem: async (k, v) => {
      m.set(k, v);
    },
  };
};

const memorySecure = (): SecureBackend => {
  const m = new Map<string, string>();
  return {
    getItem: async (k) => m.get(k) ?? null,
    setItem: async (k, v) => {
      m.set(k, v);
    },
    deleteItem: async (k) => {
      m.delete(k);
    },
  };
};

async function loadSecureStore(): Promise<SecureBackend> {
  try {
    const SecureStore = await import("expo-secure-store");
    return {
      getItem: (k) => SecureStore.getItemAsync(k),
      setItem: (k, v) => SecureStore.setItemAsync(k, v),
      deleteItem: (k) => SecureStore.deleteItemAsync(k),
    };
  } catch {
    return memorySecure();
  }
}

async function loadPrefs(): Promise<PrefsBackend> {
  try {
    const AsyncStorage = (await import("@react-native-async-storage/async-storage")).default;
    return {
      getItem: (k) => AsyncStorage.getItem(k),
      setItem: (k, v) => AsyncStorage.setItem(k, v),
    };
  } catch {
    return memoryPrefs();
  }
}

function isBackendId(v: unknown): v is SandboxBackendId {
  return v === "cloud" || v === "local";
}

function isSshConfig(v: unknown): v is SshConfig {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.host === "string" &&
    typeof o.port === "number" &&
    typeof o.username === "string" &&
    (o.authType === "key" || o.authType === "password")
  );
}

export class SandboxManager {
  private cloudBackend: SshDockerBackend;
  private localBackend: IshSandboxBackend;
  private activeId: SandboxBackendId = "cloud";
  private serverStore: SandboxServerStore = EMPTY_SERVER_STORE;
  private secure: SecureBackend | null = null;
  private prefs: PrefsBackend | null = null;
  private initialized = false;

  constructor() {
    // Real transport: the app talks HTTPS to the sandbox relay on her
    // server (sandbox-relay/relay.mjs), which opens the genuine SSH session.
    this.cloudBackend = new SshDockerBackend(new RelaySshTransport());
    this.localBackend = new IshSandboxBackend();
  }

  /** For tests: inject backends / storage. */
  static forTest(opts: {
    cloud?: SshDockerBackend;
    local?: IshSandboxBackend;
    secure?: SecureBackend;
    prefs?: PrefsBackend;
  }): SandboxManager {
    const m = new SandboxManager();
    if (opts.cloud) m.cloudBackend = opts.cloud;
    if (opts.local) m.localBackend = opts.local;
    if (opts.secure) m.secure = opts.secure;
    if (opts.prefs) m.prefs = opts.prefs;
    return m;
  }

  /** P3-3: init promise — concurrent init() calls share one run instead
   * of each executing the body. */
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.initialized) return;
    if (!this.initPromise) {
      this.initPromise = this.doInit().finally(() => {
        // Allow a retry after failure: a failed init must not permanently
        // wedge the manager.
        if (!this.initialized) this.initPromise = null;
      });
    }
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    if (!this.secure) this.secure = await loadSecureStore();
    if (!this.prefs) this.prefs = await loadPrefs();
    try {
      const raw = await this.prefs.getItem(ACTIVE_KEY);
      if (isBackendId(raw)) this.activeId = raw;
    } catch {
      // keep default
    }
    try {
      const rawStore = await this.secure.getItem(SERVERS_KEY);
      const parsed = rawStore ? parseServerStore(rawStore) : null;
      if (parsed) {
        this.serverStore = parsed;
      } else {
        // One-time migration: her old single-server config becomes the first
        // list entry (named after its host — she can rename it). The legacy
        // key is removed only after the new store is safely written: a move,
        // never a drop.
        const rawCfg = await this.secure.getItem(SSH_CONFIG_KEY);
        if (rawCfg) {
          try {
            const cfg: unknown = JSON.parse(rawCfg);
            if (isSshConfig(cfg)) {
              this.serverStore = migrateLegacySshConfig(cfg);
              await this.persistServers();
              await this.secure.deleteItem(SSH_CONFIG_KEY).catch(() => {});
            }
          } catch {
            // corrupt legacy config: start with an empty list
          }
        }
      }
    } catch {
      // unreadable store: start with an empty list; she re-adds it
    }
    this.applyActiveConfig();
    this.initialized = true;
  }

  /** Push the active server's config into the cloud backend (or clear it). */
  private applyActiveConfig(): void {
    const active = activeServer(this.serverStore);
    this.cloudBackend.setConfig(active ? active.config : null);
  }

  private async persistServers(): Promise<void> {
    if (!this.secure) this.secure = await loadSecureStore();
    await this.secure.setItem(SERVERS_KEY, JSON.stringify(this.serverStore));
  }

  activeBackendId(): SandboxBackendId {
    return this.activeId;
  }

  async setActiveBackend(id: SandboxBackendId): Promise<void> {
    const current = this.backend(this.activeId);
    if (current.connectionState() === "connected") {
      await current.disconnect().catch(() => {});
    }
    this.activeId = id;
    if (this.prefs) {
      await this.prefs.setItem(ACTIVE_KEY, id).catch(() => {});
    }
  }

  backend(id: SandboxBackendId): SandboxBackend {
    return id === "cloud" ? this.cloudBackend : this.localBackend;
  }

  activeBackend(): SandboxBackend {
    return this.backend(this.activeId);
  }

  /** All saved servers (SecureStore). */
  serverList(): SandboxServer[] {
    return this.serverStore.servers;
  }

  /** The active server, or null when the list is empty. */
  activeServer(): SandboxServer | null {
    return activeServer(this.serverStore);
  }

  /**
   * Add or update a server. If it is the active one and the backend is
   * connected, the live connection is dropped first — the next connect uses
   * the new credentials. Never silently keeps stale creds.
   */
  async saveServer(server: SandboxServer): Promise<void> {
    const wasActive =
      activeServer(this.serverStore)?.id === server.id || this.serverStore.servers.length === 0;
    this.serverStore = upsertServer(this.serverStore, server);
    if (wasActive) {
      if (this.cloudBackend.connectionState() === "connected") {
        await this.cloudBackend.disconnect().catch(() => {});
      }
      this.applyActiveConfig();
    }
    await this.persistServers();
  }

  /**
   * Delete a server (and its secret). Deleting the active one disconnects
   * and falls back to the first remaining server; deleting the last one
   * leaves the backend honestly unconfigured ("no server selected").
   */
  async deleteServer(id: string): Promise<void> {
    const wasActive = activeServer(this.serverStore)?.id === id;
    this.serverStore = deleteServerFromStore(this.serverStore, id);
    if (wasActive && this.cloudBackend.connectionState() === "connected") {
      await this.cloudBackend.disconnect().catch(() => {});
    }
    this.applyActiveConfig();
    await this.persistServers();
  }

  /** Tap-to-switch: disconnect the current server, activate the new one. */
  async setActiveServer(id: string): Promise<void> {
    const target = this.serverStore.servers.find((s) => s.id === id);
    if (!target) throw new Error("sandbox.noServerSelected");
    if (activeServer(this.serverStore)?.id === id) return; // already active
    if (this.cloudBackend.connectionState() === "connected") {
      await this.cloudBackend.disconnect().catch(() => {});
    }
    this.serverStore = { ...this.serverStore, activeServerId: id };
    this.applyActiveConfig();
    await this.persistServers();
  }
}

// App-wide singleton.
export const sandboxManager = new SandboxManager();
