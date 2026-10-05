/**
 * Production wiring for persona group chat (人设群聊): builds the engine
 * deps from the app singletons. Not PURE (imports AsyncStorage-backed
 * singletons and fetch-based generation).
 *
 * Shared tool pool for group turns: memory + knowledge + web-search —
 * the same read-mostly pool every dialog gets. Tools run with a
 * fail-closed authorize (deny) — a group persona can never approve a
 * sensitive action on its own; anything needing her tap is refused with a
 * plain tool error the model sees.
 */

import { groupStore } from "../api-groups/store";
import type { ApiGroup } from "../api-groups/types";
import { lazyKnowledgeStore } from "../knowledge/lazy-store";
import { createKnowledgeTools } from "../knowledge/tools";
import { createWebSearchTools } from "../mcp/web-search";
import { createMemoryTools } from "../memory/index";
import { memoryStore } from "../memory/instance";
import { personaApiGroupPrefStore, personaStore } from "../persona/stores";
import type { Persona } from "../persona/types";
import { crossDialogTraceStore } from "./cross-dialog-instance";
import { generateOneShot } from "./group-meeting-tools";
import { type PersonaCardLike, parseRelevanceJudgment } from "./persona-group";
import {
  defaultMemorySectionBuilder,
  type GroupTurnTool,
  type PersonaGroupEngineDeps,
} from "./persona-group-engine";
import { generateGroupTurn } from "./persona-group-generate";
import { personaGroupStore } from "./persona-group-instance";

function toCardLike(p: Persona): PersonaCardLike {
  return {
    id: p.id,
    name: p.name,
    systemPrompt: p.systemPrompt,
    personality: p.personality,
    background: p.background,
    exampleDialogue: p.exampleDialogue,
  };
}

function activeGroup(): ApiGroup | null {
  const snap = groupStore.getSnapshot();
  return snap.groups.find((g) => g.id === snap.activeId) ?? null;
}

let cachedTools: GroupTurnTool[] | null = null;

/** Shared pool, adapted from LocalTool (fail-closed authorize). */
export function getGroupTurnTools(): GroupTurnTool[] {
  if (cachedTools) return cachedTools;
  const local = [
    ...createMemoryTools(memoryStore),
    // Knowledge tools need a group for embeddings — the active group is
    // honest here (embeddings are her own configured backend either way).
    ...createKnowledgeTools(lazyKnowledgeStore, { getGroup: activeGroup }).filter(
      (t) => t.name !== "knowledge_add_file",
    ),
    ...createWebSearchTools(),
  ];
  cachedTools = local.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
    run: (args) => t.run(args, { authorize: async () => false }),
  }));
  return cachedTools;
}

export function createGroupEngineDeps(): PersonaGroupEngineDeps {
  return {
    groups: personaGroupStore,
    getPersona: async (id) => {
      const p = await personaStore.get(id).catch(() => null);
      return p ? toCardLike(p) : null;
    },
    resolveApiGroup: async (personaId) => {
      const snap = groupStore.getSnapshot();
      const prefId = await personaApiGroupPrefStore.get(personaId).catch(() => null);
      if (prefId) {
        const preferred = snap.groups.find((g) => g.id === prefId);
        // A deleted group falls back honestly instead of breaking the turn.
        if (preferred) return preferred;
      }
      return snap.groups.find((g) => g.id === snap.activeId) ?? null;
    },
    buildMemorySection: defaultMemorySectionBuilder(memoryStore),
    generate: (group, system, user, tools) => generateGroupTurn(group, system, user, tools),
    judge: async (_persona, system, user) => {
      const g = activeGroup();
      if (!g) return false;
      try {
        const text = await generateOneShot(g, system, user, {
          maxToolIterations: 1,
          timeoutMs: 20000,
        });
        return parseRelevanceJudgment(text);
      } catch {
        return false;
      }
    },
    listTools: getGroupTurnTools,
    trace: crossDialogTraceStore,
    herName: "她",
  };
}
