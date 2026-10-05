/**
 * Named multi-server list for the cloud sandbox backend (B4b).
 *
 * One server = a name she picks + a standard SshConfig (the existing shape
 * is reused — there is no second config format). Each server runs its own
 * relay (the 传话员); tapping a server makes it active and the manager
 * builds the transport for that server's relay URL. A server whose relay
 * isn't deployed yet fails honestly with sandbox.relay.unreachable — the UI
 * pairs that with a plain-language "传话员还没装好" note.
 *
 * PURE module: no React Native imports — safe for node tests.
 */
import type { SshConfig } from "./types";

export interface SandboxServer {
  id: string;
  /** Her chosen name, e.g. "主力机". */
  name: string;
  config: SshConfig;
}

export interface SandboxServerStore {
  servers: SandboxServer[];
  activeServerId: string | null;
}

export const EMPTY_SERVER_STORE: SandboxServerStore = { servers: [], activeServerId: null };

export function newServerId(): string {
  return `srv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
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

export function isSandboxServer(v: unknown): v is SandboxServer {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    o.id.length > 0 &&
    typeof o.name === "string" &&
    o.name.length > 0 &&
    isSshConfig(o.config)
  );
}

/** Parse persisted store JSON; corrupt or foreign data → null (start empty). */
export function parseServerStore(raw: string): SandboxServerStore | null {
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null) return null;
    const o = v as Record<string, unknown>;
    if (!Array.isArray(o.servers)) return null;
    const seen = new Set<string>();
    const servers = (o.servers as unknown[]).filter((s): s is SandboxServer => {
      if (!isSandboxServer(s) || seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });
    let activeServerId =
      typeof o.activeServerId === "string" && seen.has(o.activeServerId) ? o.activeServerId : null;
    if (!activeServerId && servers.length > 0) activeServerId = servers[0].id;
    return { servers, activeServerId };
  } catch {
    return null;
  }
}

/**
 * One-time migration of the old single-server config (dudu.sandbox.sshConfig.v1).
 * It becomes the first list entry, named after its host — she can rename it.
 * The secret rides along untouched; nothing is dropped.
 */
export function migrateLegacySshConfig(config: SshConfig): SandboxServerStore {
  const id = newServerId();
  return { servers: [{ id, name: config.host, config }], activeServerId: id };
}

export function activeServer(store: SandboxServerStore): SandboxServer | null {
  return store.servers.find((s) => s.id === store.activeServerId) ?? store.servers[0] ?? null;
}

/** Insert or replace a server. A brand-new store activates the first server. */
export function upsertServer(store: SandboxServerStore, server: SandboxServer): SandboxServerStore {
  const servers = store.servers.some((s) => s.id === server.id)
    ? store.servers.map((s) => (s.id === server.id ? server : s))
    : [...store.servers, server];
  return { servers, activeServerId: store.activeServerId ?? server.id };
}

export function renameServer(
  store: SandboxServerStore,
  id: string,
  name: string,
): SandboxServerStore {
  const trimmed = name.trim();
  if (!trimmed) return store;
  return {
    ...store,
    servers: store.servers.map((s) => (s.id === id ? { ...s, name: trimmed } : s)),
  };
}

/** Delete a server. Deleting the active one falls back to the first remaining (or none). */
export function deleteServer(store: SandboxServerStore, id: string): SandboxServerStore {
  const servers = store.servers.filter((s) => s.id !== id);
  const activeServerId =
    store.activeServerId === id ? (servers[0]?.id ?? null) : store.activeServerId;
  return { servers, activeServerId };
}

export function setActiveServerId(store: SandboxServerStore, id: string): SandboxServerStore {
  if (!store.servers.some((s) => s.id === id)) return store;
  return { ...store, activeServerId: id };
}
