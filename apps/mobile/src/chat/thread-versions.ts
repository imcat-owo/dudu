/**
 * thread-versions — message versions, branch/fork, and the v2 history envelope.
 *
 * PURE module: no React Native imports, tsx-testable. This is the foundation
 * for the chat-core gap fill (A1–A5, A8, A13–A16, A27):
 *
 * - Versions: every assistant reply belongs to a version *group* (groupId).
 *   Regenerating appends a new message with the same groupId; the thread meta
 *   records which version is selected per group. Non-selected versions stay
 *   in history (persisted, backed up, searchable) — never silently dropped.
 * - Branch/fork: copy the resolved (selected-version) messages up to a given
 *   message into a brand-new thread.
 * - v2 envelope: `dudu.local-chat.<id>.v1` stores
 *   `{ v: 2, messages: [...], meta: ThreadMeta }`. v1 (bare array) still
 *   reads fine — old installs upgrade on next save, never on read.
 */

export interface VersionedMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  /** Version group. Assistant replies regenerated from one prompt share it. Defaults to the message id. */
  groupId?: string;
  /** 0-based index within the group. Defaults to 0. */
  versionIndex?: number;
}

export interface ThreadMeta {
  /** groupId -> selected message id. Absent group = first version selected. */
  selectedVersions: Record<string, string>;
  /** Per-dialog system prompt override (A16). Appended after the persona prompt. */
  systemPrompt?: string;
  /**
   * Context budget in tokens (A13/A15): the auto-compressor folds older
   * messages into a summary note past 90% of this. 0/undefined = 100000.
   */
  tokenBudget?: number;
  /**
   * Per-turn output cap in tokens (A27): sent as max_tokens so one reply
   * can never burn past her ceiling. Unset = model default.
   */
  maxTokens?: number;
  /** Auto-title (A7) already attempted for this thread. */
  autoTitleDone?: boolean;
  createdAt: number;
  updatedAt: number;
}

export function defaultThreadMeta(now: number = Date.now()): ThreadMeta {
  return { selectedVersions: {}, createdAt: now, updatedAt: now };
}

/** Minimal storage surface (AsyncStorage in production, fakes in tests). */
export interface VersionStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export function historyKey(threadId: string): string {
  return `dudu.local-chat.${threadId}.v1`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function sanitizeMeta(raw: unknown, now: number): ThreadMeta {
  const base = defaultThreadMeta(now);
  if (!isRecord(raw)) return base;
  const selectedVersions: Record<string, string> = {};
  if (isRecord(raw.selectedVersions)) {
    for (const [k, v] of Object.entries(raw.selectedVersions)) {
      if (typeof v === "string" && v) selectedVersions[k] = v;
    }
  }
  return {
    selectedVersions,
    ...(typeof raw.systemPrompt === "string" && raw.systemPrompt.trim()
      ? { systemPrompt: raw.systemPrompt }
      : {}),
    ...(typeof raw.tokenBudget === "number" && raw.tokenBudget > 0
      ? { tokenBudget: Math.floor(raw.tokenBudget) }
      : {}),
    ...(raw.autoTitleDone === true ? { autoTitleDone: true } : {}),
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : now,
  };
}

function isVersionedMessage(m: unknown): m is VersionedMessage {
  if (!isRecord(m)) return false;
  if (typeof m.id !== "string") return false;
  return m.role === "user" || m.role === "assistant" || m.role === "system" || m.role === "tool";
}

export interface ThreadData<T extends VersionedMessage = VersionedMessage> {
  messages: T[];
  meta: ThreadMeta;
  /** True when the stored format was the legacy bare array. */
  upgraded: boolean;
}

/**
 * Load a thread's history + meta. Handles v2 envelope and legacy v1 arrays.
 * Never throws — corrupt storage yields an empty thread, never a crash.
 */
export async function loadThreadData<T extends VersionedMessage = VersionedMessage>(
  threadId: string,
  store: VersionStore,
  now: number = Date.now(),
): Promise<ThreadData<T>> {
  try {
    const raw = await store.getItem(historyKey(threadId));
    if (!raw) return { messages: [], meta: defaultThreadMeta(now), upgraded: false };
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      // v1: bare message array.
      return {
        messages: parsed.filter(isVersionedMessage) as T[],
        meta: defaultThreadMeta(now),
        upgraded: true,
      };
    }
    if (isRecord(parsed) && parsed.v === 2 && Array.isArray(parsed.messages)) {
      return {
        messages: (parsed.messages as unknown[]).filter(isVersionedMessage) as T[],
        meta: sanitizeMeta(parsed.meta, now),
        upgraded: false,
      };
    }
    return { messages: [], meta: defaultThreadMeta(now), upgraded: false };
  } catch {
    return { messages: [], meta: defaultThreadMeta(now), upgraded: false };
  }
}

/** Save a thread's history + meta as the v2 envelope. Resolves false on storage failure. */
export async function saveThreadData<T extends VersionedMessage = VersionedMessage>(
  threadId: string,
  messages: T[],
  meta: ThreadMeta,
  store: VersionStore,
  now: number = Date.now(),
): Promise<boolean> {
  try {
    const payload = {
      v: 2,
      messages,
      meta: { ...meta, updatedAt: now },
    };
    await store.setItem(historyKey(threadId), JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

/** The version group a message belongs to. */
export function groupIdOf(m: VersionedMessage): string {
  return typeof m.groupId === "string" && m.groupId ? m.groupId : m.id;
}

export function versionIndexOf(m: VersionedMessage): number {
  return typeof m.versionIndex === "number" && m.versionIndex >= 0 ? m.versionIndex : 0;
}

/** Which message id is selected for a group (first version when unset). */
export function selectedIdFor<T extends VersionedMessage>(
  messages: T[],
  groupId: string,
  meta: ThreadMeta,
): string | null {
  const group = messages.filter((m) => groupIdOf(m) === groupId);
  if (group.length === 0) return null;
  const wanted = meta.selectedVersions[groupId];
  if (wanted && group.some((m) => m.id === wanted)) return wanted;
  // Default: the earliest version (stable, deterministic).
  let first = group[0];
  for (const m of group) if (versionIndexOf(m) < versionIndexOf(first)) first = m;
  return first.id;
}

/**
 * The messages the user actually sees: non-assistant messages plus the
 * selected version of each assistant group, in original order.
 */
export function visibleMessages<T extends VersionedMessage>(
  messages: T[],
  meta: ThreadMeta,
): T[] {
  const selected = new Map<string, string>();
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    const g = groupIdOf(m);
    if (!selected.has(g)) {
      const id = selectedIdFor(messages, g, meta);
      if (id) selected.set(g, id);
    }
  }
  return messages.filter((m) => {
    if (m.role !== "assistant") return true;
    return selected.get(groupIdOf(m)) === m.id;
  });
}

/** All versions of one assistant group, oldest first. */
export function versionsOf<T extends VersionedMessage>(messages: T[], groupId: string): T[] {
  return messages
    .filter((m) => m.role === "assistant" && groupIdOf(m) === groupId)
    .sort((a, b) => versionIndexOf(a) - versionIndexOf(b));
}

/** Next version index for a group (append a regeneration). */
export function nextVersionIndex<T extends VersionedMessage>(
  messages: T[],
  groupId: string,
): number {
  let max = -1;
  for (const m of messages) {
    if (m.role === "assistant" && groupIdOf(m) === groupId) {
      max = Math.max(max, versionIndexOf(m));
    }
  }
  return max + 1;
}

/**
 * Shared truncation: cut the VISIBLE timeline at the target, keep everything
 * before it, and keep every (selected or not) version of the groups that
 * survive — plus, for regenerate, every version of the target's own group.
 * Unselected versions are never silently destroyed by rewriting history.
 */
function truncateVisible<T extends VersionedMessage>(
  messages: T[],
  meta: ThreadMeta,
  targetId: string,
  targetRole: "assistant" | "user",
): { kept: T[]; target: T } | null {
  const vis = visibleMessages(messages, meta);
  const idx = vis.findIndex((m) => m.id === targetId);
  if (idx < 0 || vis[idx].role !== targetRole) return null;
  const target = vis[idx];
  const keptVisible = vis.slice(0, idx);
  const keptIds = new Set(keptVisible.map((m) => m.id));
  const keptGroups = new Set(
    keptVisible.filter((m) => m.role === "assistant").map((m) => groupIdOf(m)),
  );
  if (targetRole === "assistant") keptGroups.add(groupIdOf(target));
  const kept = messages.filter(
    (m) => keptIds.has(m.id) || (m.role === "assistant" && keptGroups.has(groupIdOf(m))),
  );
  return { kept, target };
}

/**
 * Compute the message list for regenerating at an assistant message:
 * the visible timeline is cut at the target (it and everything after it
 * goes — they answered the old context), and the fresh reply will join the
 * target's version group. All versions of kept groups — including the
 * target's own other versions — survive in storage.
 * Returns null when the target is not an assistant message.
 */
export function truncateForRegenerate<T extends VersionedMessage>(
  messages: T[],
  meta: ThreadMeta,
  targetId: string,
): { kept: T[]; groupId: string } | null {
  const r = truncateVisible(messages, meta, targetId, "assistant");
  if (!r) return null;
  return { kept: r.kept, groupId: groupIdOf(r.target) };
}

/**
 * Compute the message list for editing a user message and regenerating:
 * the message text is replaced, everything after it is dropped. Unselected
 * versions of earlier groups survive.
 * Returns null when the target is not a user message.
 */
export function truncateForEdit<T extends VersionedMessage>(
  messages: T[],
  meta: ThreadMeta,
  targetId: string,
): { kept: T[]; target: T } | null {
  return truncateVisible(messages, meta, targetId, "user");
}

/**
 * Delete one message. When deleteVersions is true and the target is an
 * assistant message, all versions of its group go too. Returns the new
 * message list plus meta adjustments (re-point a deleted selection).
 */
export function deleteMessageFrom<T extends VersionedMessage>(
  messages: T[],
  meta: ThreadMeta,
  targetId: string,
  deleteVersions: boolean,
): { messages: T[]; meta: ThreadMeta } {
  const target = messages.find((m) => m.id === targetId);
  if (!target) return { messages, meta };
  const drop = new Set<string>();
  if (deleteVersions && target.role === "assistant") {
    const g = groupIdOf(target);
    for (const m of messages) if (groupIdOf(m) === g) drop.add(m.id);
  } else {
    drop.add(targetId);
  }
  const kept = messages.filter((m) => !drop.has(m.id));
  // Re-point any selection that aimed at a deleted message.
  const nextMeta: ThreadMeta = {
    ...meta,
    selectedVersions: { ...meta.selectedVersions },
  };
  for (const [g, selId] of Object.entries(nextMeta.selectedVersions)) {
    if (drop.has(selId)) {
      const id = selectedIdFor(kept, g, nextMeta);
      if (id) nextMeta.selectedVersions[g] = id;
      else delete nextMeta.selectedVersions[g];
    }
  }
  return { messages: kept, meta: nextMeta };
}

/**
 * Branch/fork: the resolved (visible) messages up to and including the
 * given message, re-keyed as a fresh thread. Version groups collapse to
 * the selected version — a branch is a clean line, not a version tree.
 * Returns null when the anchor message is not found.
 */
export function forkSlice<T extends VersionedMessage>(
  messages: T[],
  meta: ThreadMeta,
  anchorId: string,
): T[] | null {
  const visible = visibleMessages(messages, meta);
  const idx = visible.findIndex((m) => m.id === anchorId);
  if (idx < 0) return null;
  return visible.slice(0, idx + 1).map((m) => {
    // Collapse version identity: in the new thread each message stands alone.
    const copy = { ...m } as T & { groupId?: string; versionIndex?: number };
    copy.groupId = m.id;
    copy.versionIndex = 0;
    return copy as T;
  });
}

/** Rough token estimate for context-usage display (A13): ~4 chars per token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateMessagesTokens<T extends VersionedMessage>(
  messages: T[],
  toText: (m: T) => string,
): number {
  let n = 0;
  for (const m of messages) n += estimateTokens(toText(m));
  return n;
}

/**
 * Split messages for context compression (A14/A15): returns the head
 * (to summarize) and tail (to keep verbatim) given a keep-tail budget.
 * Never splits inside a user→assistant pair: the head boundary is moved
 * back to just after an assistant message.
 */
export function splitForCompression<T extends VersionedMessage>(
  messages: T[],
  keepTailCount: number,
): { head: T[]; tail: T[] } {
  if (messages.length <= keepTailCount) return { head: [], tail: [...messages] };
  let cut = messages.length - keepTailCount;
  // Move the cut back while it lands between a user message and its reply.
  while (cut > 0 && messages[cut - 1].role === "user") cut--;
  return { head: messages.slice(0, cut), tail: messages.slice(cut) };
}
