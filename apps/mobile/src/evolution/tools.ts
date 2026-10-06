/**
 * Personality evolution （性格进化） — AI tools.
 *
 * The AI distills PATTERNS (never single events) it notices across days —
 * "she lights up when I tease her", "she goes quiet when I'm too clingy" —
 * into evolution notes. Each note rides the system prompt ("what I've
 * learned about us"), so the persona REALLY deepens over time.
 *
 * Every note cites its source (date + conversation ref): no source, no
 * note — the AI must never claim a false memory. Everything is visible
 * to her in Our Space → 成长记录 (read/edit/delete), with a master toggle
 * and a reset back to the card baseline.
 *
 * manualId "evolution" pairs with src/manuals/evolution.ts (纸条机制).
 */

import type { LocalTool, ToolContext } from "../api-groups/local-tools";
import { ToolError } from "../api-groups/local-tools";
import type { EvolutionStore } from "./store";
import { validateEvolutionNote } from "./types";

export interface EvolutionToolEnv {
  evolutionStore: EvolutionStore;
  getPersona(personaId: string): Promise<{ id: string; name: string } | null>;
  listPersonas(): Promise<Array<{ id: string; name: string }>>;
  nowMs(): number;
}

function strArg(args: Record<string, unknown>, name: string): string {
  const v = args[name];
  return typeof v === "string" ? v : "";
}

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
  });
}

export function createEvolutionTools(env: EvolutionToolEnv): LocalTool[] {
  const run = async (_ctx: ToolContext, fn: () => Promise<string>): Promise<string> => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ToolError) throw e;
      throw new ToolError(e instanceof Error ? e.message : "Evolution tool failed.");
    }
  };

  const requirePersona = async (personaId: string) => {
    if (!personaId) throw new ToolError("personaId is required.");
    const persona = await env.getPersona(personaId).catch(() => null);
    if (!persona) throw new ToolError(`Persona not found: ${personaId}.`);
    return persona;
  };

  return [
    {
      name: "evolution_note_add",
      description:
        "Write one evolution note （性格进化）: a REPEATED pattern you noticed across days about " +
        "being with her — e.g. 「她被逗的时候会开心」/「我太黏的时候她会变安静，给她留空间」. " +
        "Patterns only, NEVER single events. source is REQUIRED (dateMs + ref): the date the pattern " +
        "was observed and which conversation it comes from — no source, no note, never claim a false " +
        "memory. The note rides your system prompt, so you REALLY behave differently. She can read, " +
        "edit, and delete every note in Our Space → 成长记录. " +
        "SAFETY: adapt YOUR tone/pacing to delight her — never steer her emotions or create dependency.",
      parameters: {
        type: "object",
        properties: {
          personaId: { type: "string", description: "Persona id (the voice that evolves)." },
          content: {
            type: "string",
            description: "The pattern, one crisp sentence, ≤200 chars. Her language.",
          },
          sourceKind: {
            type: "string",
            description: '"chat" (from a conversation) or "manual" (she told you directly).',
          },
          sourceDateMs: {
            type: "number",
            description: "When the pattern was observed (unix ms).",
          },
          sourceRef: {
            type: "string",
            description: "Which conversation: dialog name/date or excerpt reference.",
          },
        },
        required: ["personaId", "content", "sourceKind", "sourceDateMs", "sourceRef"],
        additionalProperties: false,
      },
      manualId: "evolution",
      run: (args, ctx) =>
        run(ctx, async () => {
          const personaId = strArg(args, "personaId");
          await requirePersona(personaId);
          const v = args.sourceKind;
          const input = {
            personaId,
            content: strArg(args, "content"),
            source: {
              kind: v === "manual" ? ("manual" as const) : ("chat" as const),
              dateMs: typeof args.sourceDateMs === "number" ? args.sourceDateMs : 0,
              ref: strArg(args, "sourceRef"),
            },
          };
          const err = validateEvolutionNote(input);
          if (err) throw new ToolError(err);
          const note = await env.evolutionStore.add({ ...input, nowMs: env.nowMs() });
          return `Noted: 「${note.content}」 (${fmtDate(note.source.dateMs)}, ${note.source.ref}). It now rides your system prompt for ${personaId}.`;
        }),
    },
    {
      name: "evolution_note_list",
      description:
        "List evolution notes （成长记录） for a persona, newest first, with their source citations. " +
        "Use when she asks what you've learned, or to check before adding a duplicate.",
      parameters: {
        type: "object",
        properties: {
          personaId: { type: "string", description: "Persona id." },
        },
        required: ["personaId"],
        additionalProperties: false,
      },
      manualId: "evolution",
      run: (args, ctx) =>
        run(ctx, async () => {
          const personaId = strArg(args, "personaId");
          await requirePersona(personaId);
          const notes = await env.evolutionStore.list(personaId);
          if (notes.length === 0) return "No evolution notes yet for this persona.";
          return notes
            .map((n) => `- [${n.id}] ${n.content}（${fmtDate(n.source.dateMs)}，${n.source.ref}）`)
            .join("\n");
        }),
    },
    {
      name: "evolution_note_edit",
      description:
        "Edit one evolution note's content or source （成长记录）. Use when she corrects you " +
        "or a pattern shifted. The source citation is re-validated — it can never go missing.",
      parameters: {
        type: "object",
        properties: {
          noteId: { type: "string", description: "Note id (from evolution_note_list)." },
          content: { type: "string", description: "New content (optional)." },
          sourceRef: { type: "string", description: "New source ref (optional)." },
        },
        required: ["noteId"],
        additionalProperties: false,
      },
      manualId: "evolution",
      run: (args, ctx) =>
        run(ctx, async () => {
          const noteId = strArg(args, "noteId");
          const cur = await env.evolutionStore.get(noteId);
          if (!cur) throw new ToolError(`Note not found: ${noteId}.`);
          const patch: { content?: string; source?: typeof cur.source } = {};
          const content = strArg(args, "content");
          if (content) patch.content = content;
          const ref = strArg(args, "sourceRef");
          if (ref) patch.source = { ...cur.source, ref };
          const next = await env.evolutionStore.edit(noteId, patch);
          return `Updated: 「${next.content}」.`;
        }),
    },
    {
      name: "evolution_note_delete",
      description:
        "Delete one evolution note （成长记录）. Use when she asks to forget it, or a pattern " +
        "was wrong. The note stops riding your system prompt immediately.",
      parameters: {
        type: "object",
        properties: {
          noteId: { type: "string", description: "Note id (from evolution_note_list)." },
        },
        required: ["noteId"],
        additionalProperties: false,
      },
      manualId: "evolution",
      run: (args, ctx) =>
        run(ctx, async () => {
          const noteId = strArg(args, "noteId");
          const cur = await env.evolutionStore.get(noteId);
          if (!cur) throw new ToolError(`Note not found: ${noteId}.`);
          await env.evolutionStore.remove(noteId);
          return `Deleted 「${cur.content}」. It's off your system prompt now.`;
        }),
    },
    {
      name: "evolution_set_enabled",
      description:
        "Master toggle for personality evolution （性格进化总开关）. Off = no new notes are " +
        "written AND nothing rides the system prompt (the persona falls back to its card baseline).",
      parameters: {
        type: "object",
        properties: {
          enabled: { type: "boolean", description: "true to enable, false to disable." },
        },
        required: ["enabled"],
        additionalProperties: false,
      },
      manualId: "evolution",
      run: (args, ctx) =>
        run(ctx, async () => {
          const on = args.enabled === true;
          await env.evolutionStore.setEnabled(on);
          return on
            ? "Personality evolution is ON. Notes will ride the system prompt again."
            : "Personality evolution is OFF. No new notes, nothing extra rides the system prompt.";
        }),
    },
    {
      name: "evolution_reset",
      description:
        "Wipe ALL evolution notes for one persona （清空成长记录） — back to the card baseline. " +
        "Use only when she explicitly asks to reset. This cannot be undone.",
      parameters: {
        type: "object",
        properties: {
          personaId: { type: "string", description: "Persona id." },
        },
        required: ["personaId"],
        additionalProperties: false,
      },
      manualId: "evolution",
      run: (args, ctx) =>
        run(ctx, async () => {
          const personaId = strArg(args, "personaId");
          await requirePersona(personaId);
          const dropped = await env.evolutionStore.reset(personaId);
          return `Reset: ${dropped} evolution note(s) removed for this persona. Back to the card baseline.`;
        }),
    },
  ];
}
