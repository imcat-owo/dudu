/**
 * AI memory system — tools. PURE module: no React Native / expo imports.
 *
 * Five tools so the AI operates memory in dialog (her principle: she talks,
 * the AI acts — she never edits manually):
 *   memory_add      — explicit "记住 X" (user-told -> confident, actor=user)
 *   memory_search   — recall ("你还记得…?")
 *   memory_update   — correct ("不是 X，是 Y" -> supersede, history kept)
 *   memory_delete   — forget ("忘了 X" -> really deletes)
 *   memory_confirm  — promote unsure/question -> confident (she confirmed)
 *   memory_reinforce — boost recall rank of a memory that landed in conversation
 *
 * All tools are in-app (no authorization gate — nothing crosses the app
 * boundary). Memory NEVER presents an unsure item as confident: search and
 * read-path results are always labeled with their confidence.
 */

import { type LocalTool, ToolError } from "../api-groups/local-tools.js";
import { searchMemories } from "./search.js";
import type { MemoryStore } from "./store.js";
import { gardenStateOf, isMemoryCategory, type MemoryCategory } from "./types.js";

function strArg(args: Record<string, unknown>, name: string): string {
  const v = args[name];
  return typeof v === "string" ? v : "";
}

function fmtRecord(m: {
  id: string;
  content: string;
  category: string;
  confidence: string;
  validTo: number | null;
}): string {
  const state = m.validTo !== null ? "wilted (superseded)" : m.confidence;
  return `- [${state}] ${m.content} (id: ${m.id}, category: ${m.category})`;
}

/**
 * Build the memory tool set bound to a store instance.
 * Every tool REALLY works — no placeholders.
 */
export function createMemoryTools(store: MemoryStore): LocalTool[] {
  return [
    {
      name: "memory_add",
      description:
        "Remember something about her explicitly. Use when she says '记住 X' / 'remember this', or when you learn a durable fact worth keeping (preference, goal, relationship, habit). User-told facts are stored as confident; your own inferences should be added as unsure instead — use confidence honestly.",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "The fact, one crisp sentence." },
          category: {
            type: "string",
            description: "preference | fact | relationship | goal | habit | other",
          },
          confidence: {
            type: "string",
            description:
              "confident (she told you) | unsure (you inferred it) | question (you want to ask her). Default: unsure.",
          },
        },
        required: ["content"],
        additionalProperties: false,
      },
      manualId: "memory",
      run: async (args) => {
        const content = strArg(args, "content");
        if (!content) throw new ToolError("Missing required argument: content.");
        const category: MemoryCategory = isMemoryCategory(args.category) ? args.category : "other";
        const confidence =
          args.confidence === "confident"
            ? "confident"
            : args.confidence === "question"
              ? "question"
              : "unsure";
        // Audit honesty: confident = she told it; otherwise it's the AI's own
        // inference — the log must say so.
        const isUserTold = confidence === "confident";
        const rec = await store.addMemory(content, {
          category,
          confidence,
          source: isUserTold ? "user-told" : "ai-inferred",
          actor: isUserTold ? "user" : "ai",
        });
        return `Remembered (${gardenStateOf(rec)}): ${rec.content}`;
      },
    },
    {
      name: "memory_search",
      description:
        "Search your memories of her. Use when she asks '你还记得…?' or when you need context. Results are labeled with confidence — NEVER present an unsure memory as certain; say you're not sure and ask her.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "What to search for." },
          include_superseded: {
            type: "boolean",
            description:
              "Include old superseded facts (for '以前是这样的' questions). Default false.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
      manualId: "memory",
      run: async (args) => {
        const query = strArg(args, "query");
        if (!query) throw new ToolError("Missing required argument: query.");
        const all = await store.listMemories();
        const hits = searchMemories(all, query, {
          limit: 8,
          includeSuperseded: args.include_superseded === true,
        });
        if (hits.length === 0) return "No matching memories.";
        return hits.map((h) => fmtRecord(h.record)).join("\n");
      },
    },
    {
      name: "memory_update",
      description:
        "Correct a memory ('不是 X，是 Y'). The old fact is NOT overwritten — it is marked superseded and kept as history, and the correction becomes the current fact. Use the id from memory_search.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Memory id from memory_search." },
          content: { type: "string", description: "The corrected fact." },
        },
        required: ["id", "content"],
        additionalProperties: false,
      },
      manualId: "memory",
      run: async (args) => {
        const id = strArg(args, "id");
        const content = strArg(args, "content");
        if (!id || !content) throw new ToolError("Missing required arguments: id, content.");
        const next = await store.supersedeMemory(id, content, {
          actor: "user",
          source: "user-corrected",
        });
        return `Updated. Old fact kept as history; current fact: ${next.content}`;
      },
    },
    {
      name: "memory_delete",
      description:
        "Forget a memory ('忘了 X' / 'forget that'). Really deletes it — use only when she asks. Use the id from memory_search.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Memory id from memory_search." },
        },
        required: ["id"],
        additionalProperties: false,
      },
      manualId: "memory",
      run: async (args) => {
        const id = strArg(args, "id");
        if (!id) throw new ToolError("Missing required argument: id.");
        const ok = await store.deleteMemory(id, "user");
        if (!ok) throw new ToolError(`Memory not found: ${id}.`);
        return "Forgotten. It is really gone.";
      },
    },
    {
      name: "memory_confirm",
      description:
        "Confirm an unsure memory or answer an open question — promote it to confident. Use when she confirms something you were unsure about ('对' / '没错'). Use the id from memory_search.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Memory id from memory_search." },
        },
        required: ["id"],
        additionalProperties: false,
      },
      manualId: "memory",
      run: async (args) => {
        const id = strArg(args, "id");
        if (!id) throw new ToolError("Missing required argument: id.");
        const rec = await store.confirmMemory(id, "user");
        return `Confirmed — now remembered as certain: ${rec.content}`;
      },
    },
    {
      name: "memory_reinforce",
      description:
        "Reinforce a memory you naturally re-mentioned in conversation and she engaged with (she agreed, elaborated, or laughed — it landed). Reinforced memories rank higher in future recall. Do NOT spam: at most once per memory per conversation turn. Use the id from memory_search.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Memory id from memory_search." },
        },
        required: ["id"],
        additionalProperties: false,
      },
      manualId: "memory",
      run: async (args) => {
        const id = strArg(args, "id");
        if (!id) throw new ToolError("Missing required argument: id.");
        const rec = await store.reinforceMemory(id, "ai");
        return `Reinforced — it will surface more readily next time: ${rec.content}`;
      },
    },
  ];
}
