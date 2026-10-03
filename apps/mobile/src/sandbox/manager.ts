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
import { UnavailableSshTransport } from "./transport";
import type { SandboxBackend, SandboxBackendId, SshConfig } from "./types";

const ACTIVE_KEY = "openmuse.sandbox.activeBackend.v1";
const SSH_CONFIG_KEY = "openmuse.sandbox.sshConfig.v1";

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
  private sshConfigured = false;
  private secure: SecureBackend | null = null;
  private prefs: PrefsBackend | null = null;
  private initialized = false;

  constructor() {
    // Transport is injected when a real SSH implementation is bundled.
    this.cloudBackend = new SshDockerBackend(new UnavailableSshTransport());
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

  async init(): Promise<void> {
    if (this.initialized) return;
    if (!this.secure) this.secure = await loadSecureStore();
    if (!this.prefs) this.prefs = await loadPrefs();
    try {
      const raw = await this.prefs.getItem(ACTIVE_KEY);
      if (isBackendId(raw)) this.activeId = raw;
    } catch {
      // keep default
    }
    try {
      const rawCfg = await this.secure.getItem(SSH_CONFIG_KEY);
      if (rawCfg) {
        const parsed: unknown = JSON.parse(rawCfg);
        if (isSshConfig(parsed)) {
          this.cloudBackend.setConfig(parsed);
          this.sshConfigured = true;
        }
      }
    } catch {
      // corrupt config: start without one; user re-enters it
    }
    this.initialized = true;
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

  /** Persist SSH config to SecureStore (never to the repo). */
  async saveSshConfig(config: SshConfig): Promise<void> {
    if (!this.secure) this.secure = await loadSecureStore();
    await this.secure.setItem(SSH_CONFIG_KEY, JSON.stringify(config));
    this.cloudBackend.setConfig(config);
    this.sshConfigured = true;
  }

  async clearSshConfig(): Promise<void> {
    if (!this.secure) this.secure = await loadSecureStore();
    await this.secure.deleteItem(SSH_CONFIG_KEY).catch(() => {});
    this.cloudBackend.setConfig(null);
    this.sshConfigured = false;
  }

  hasSshConfig(): boolean {
    return this.sshConfigured;
  }
}

// App-wide singleton.
export const sandboxManager = new SandboxManager();
