/**
 * Coding loop — app singletons and production wiring.
 *
 * The runner goes through the active SandboxBackend (the same backend the
 * sandbox tools drive). No sandbox connection → the tool fails honestly
 * and points her at the sandbox settings instead of faking anything.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { sandboxManager } from "../sandbox/manager";
import { requireRunnable } from "../sandbox/sandbox-tools";
import { createSandboxRunner, type FileRunner } from "./executor";
import { type CodingStore, createCodingStore } from "./store";
import { createCodingTools } from "./tools";
import type { CodingTask } from "./types";
import { DEFAULT_REPO_URL, DEFAULT_WORKSPACE_ROOT } from "./workspace";

const CODING_TASKS_KEY = "dudu.coding.tasks.v1";
const CODING_REPO_URL_KEY = "dudu.coding.repoUrl.v1";

async function loadPersisted(): Promise<CodingTask[]> {
  try {
    const raw = await AsyncStorage.getItem(CODING_TASKS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? (arr as CodingTask[]) : [];
  } catch {
    return [];
  }
}

export const codingStore: CodingStore = createCodingStore({
  load: loadPersisted,
  save: async (tasks) => {
    try {
      await AsyncStorage.setItem(CODING_TASKS_KEY, JSON.stringify(tasks));
    } catch {
      /* best effort */
    }
  },
});

let hydrated = false;
export async function hydrateCodingStore(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  await codingStore.hydrate();
}

/** Repo URL, settings-overridable. Read per call so changes apply. */
export async function getCodingRepoUrl(): Promise<string> {
  try {
    const saved = await AsyncStorage.getItem(CODING_REPO_URL_KEY);
    if (saved?.trim()) return saved.trim();
  } catch {
    /* fall through to default */
  }
  return DEFAULT_REPO_URL;
}

/** Resolve the sandbox runner for a task. Throws honestly when unusable. */
export async function resolveCodingRunner(
  _task: CodingTask,
): Promise<{ runner: FileRunner; root: string }> {
  const backend = sandboxManager.activeBackend();
  requireRunnable(backend);
  const envs = await backend.listEnvironments();
  const env = envs.find((e) => e.status === "running" || e.status === "booted") ?? envs[0];
  if (!env) {
    throw new Error(
      "沙箱里没有可用的环境（容器没启动）。先去沙箱设置里启动一个，再跑 coding 任务。",
    );
  }
  return {
    runner: createSandboxRunner(backend, env.id, DEFAULT_WORKSPACE_ROOT),
    root: DEFAULT_WORKSPACE_ROOT,
  };
}

/** Create the coding_task tool for a thread (call after hydrateCodingStore). */
export function createCodingToolsForThread(threadId: string, isIncognito?: () => boolean) {
  return createCodingTools(threadId, {
    store: codingStore,
    getRunner: resolveCodingRunner,
    getRepoUrl: getCodingRepoUrl,
    isIncognito,
  });
}

// Hydrate on module load (same pattern as plan-gate-instance).
void hydrateCodingStore().catch(() => {});

// Re-exported for tests that want the store shape without RN.
export type { CodingStore };
