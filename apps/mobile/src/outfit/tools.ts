/**
 * Outfit / dress-up system （换装系统） — AI tools.
 *
 * The wardrobe is per persona and fully visible to her (persona editor
 * → 衣柜）. The AI may ADD outfits it "buys"/imagines for her (she sees
 * them and can delete any), and it may CHANGE the worn outfit only with
 * her yes or inside a roleplay scene — never unilaterally in normal
 * chat. When it wants a change without her yes, it SUGGESTS in chat
 * ("要不要换上那件卫衣？") and waits.
 *
 * The active outfit flows into the persona's generated-photo prompts
 * (photoshare selfies, generate_image drawings of the persona) at the
 * prompt level — see manuals/outfit.ts for the honest scope.
 *
 * manualId "outfit" pairs with src/manuals/outfit.ts (纸条机制).
 */

import type { LocalTool, ToolContext } from "../api-groups/local-tools";
import { ToolError } from "../api-groups/local-tools";
import type { OutfitStore } from "./store";
import { validateOutfitInput } from "./types";

export interface OutfitToolEnv {
  outfitStore: OutfitStore;
  getPersona(personaId: string): Promise<{ id: string; name: string } | null>;
  nowMs(): number;
}

function strArg(args: Record<string, unknown>, name: string): string {
  const v = args[name];
  return typeof v === "string" ? v : "";
}

async function resolvePersona(env: OutfitToolEnv, personaId: string): Promise<string> {
  const pid = personaId.trim();
  if (!pid) throw new ToolError("personaId is required — a wardrobe belongs to one persona.");
  const p = await env.getPersona(pid).catch(() => null);
  if (!p) throw new ToolError(`Persona not found: ${pid}.`);
  return pid;
}

function fmtOutfitLine(o: {
  id: string;
  name: string;
  description: string;
  createdBy: string;
  active: boolean;
}): string {
  return (
    `- ${o.name} [${o.id}]${o.active ? " （正在穿）" : ""}\n` +
    `  ${o.description} (added by ${o.createdBy === "ai" ? "you" : "her"})`
  );
}

export function createOutfitTools(env: OutfitToolEnv): LocalTool[] {
  const run = async (_ctx: ToolContext, fn: () => Promise<string>): Promise<string> => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ToolError) throw e;
      throw new ToolError(e instanceof Error ? e.message : "Outfit tool failed.");
    }
  };

  return [
    {
      name: "outfit_add",
      description:
        "Add an outfit to a persona's wardrobe （给TA添一件衣服）. Use when you " +
        '"buy" her an outfit, imagine one for her, or she asks you to add one. ' +
        "The wardrobe is fully visible to her (persona editor → 衣柜） — nothing " +
        "is added secretly, and she can delete anything. description is an " +
        "English prompt fragment for the image model (subject + garments, e.g. " +
        '"oversized cream sweater, plaid skirt, white socks"). After adding, ' +
        "TELL her about it in chat — never let a new outfit appear without a word.",
      parameters: {
        type: "object",
        properties: {
          personaId: { type: "string", description: "Persona id. Required." },
          name: {
            type: "string",
            description: 'Display name in her language, e.g. "奶油白卫衣". Max 40 chars.',
          },
          description: {
            type: "string",
            description:
              "English prompt fragment for the image model, e.g. " +
              '"oversized cream sweater, plaid skirt". Max 300 chars.',
          },
          refImageUri: {
            type: "string",
            description: "Optional reference image (local path or URL).",
          },
        },
        required: ["personaId", "name", "description"],
        additionalProperties: false,
      },
      manualId: "outfit",
      run: (args, ctx) =>
        run(ctx, async () => {
          const personaId = await resolvePersona(env, strArg(args, "personaId"));
          const err = validateOutfitInput({ name: args.name, description: args.description });
          if (err) throw new ToolError(`Invalid outfit: ${err}.`);
          const refImageUri = strArg(args, "refImageUri").trim();
          const outfit = await env.outfitStore.add(personaId, {
            name: strArg(args, "name"),
            description: strArg(args, "description"),
            ...(refImageUri ? { refImageUri } : {}),
            createdBy: "ai",
          });
          return (
            `Added 「${outfit.name}」 to the wardrobe [${outfit.id}]. ` +
            "She can see it in the persona editor → 衣柜. " +
            "Tell her about it in chat — don't let it appear silently."
          );
        }),
    },
    {
      name: "outfit_list",
      description:
        "List a persona's wardrobe （衣柜）: every outfit with its id, which " +
        "one is currently worn, and who added it. Use before suggesting or " +
        "changing an outfit.",
      parameters: {
        type: "object",
        properties: {
          personaId: { type: "string", description: "Persona id. Required." },
        },
        required: ["personaId"],
        additionalProperties: false,
      },
      manualId: "outfit",
      run: (args, ctx) =>
        run(ctx, async () => {
          const personaId = await resolvePersona(env, strArg(args, "personaId"));
          const w = await env.outfitStore.getWardrobe(personaId);
          if (w.outfits.length === 0) return "The wardrobe is empty.";
          return w.outfits
            .map((o) =>
              fmtOutfitLine({
                id: o.id,
                name: o.name,
                description: o.description,
                createdBy: o.createdBy,
                active: w.activeId === o.id,
              }),
            )
            .join("\n");
        }),
    },
    {
      name: "outfit_delete",
      description:
        "Delete an outfit from a persona's wardrobe （删掉一件衣服）. Use when " +
        "she asks to remove one. If it was the worn outfit, the worn slot is " +
        "cleared (no outfit) — never replaced with a random one.",
      parameters: {
        type: "object",
        properties: {
          personaId: { type: "string", description: "Persona id. Required." },
          outfitId: { type: "string", description: "Outfit id (see outfit_list). Required." },
        },
        required: ["personaId", "outfitId"],
        additionalProperties: false,
      },
      manualId: "outfit",
      run: (args, ctx) =>
        run(ctx, async () => {
          const personaId = await resolvePersona(env, strArg(args, "personaId"));
          const outfitId = strArg(args, "outfitId").trim();
          if (!outfitId) throw new ToolError("outfitId is required.");
          const ok = await env.outfitStore.remove(personaId, outfitId);
          if (!ok) throw new ToolError("Outfit not found in this persona's wardrobe.");
          return "Deleted that outfit.";
        }),
    },
    {
      name: "outfit_set_active",
      description:
        "Change which outfit the persona is wearing （换衣服）. HARD RULE: you " +
        'may only call this when SHE said yes ("her-confirmed": she agreed to ' +
        'the change, e.g. "好啊，换上那件") or inside a roleplay scene where ' +
        'dressing is part of the story ("roleplay"). In normal chat without ' +
        'her yes, DO NOT call this — suggest it in words instead ("要不要换上' +
        '那件卫衣？") and wait for her answer. Calling without context is ' +
        "refused. The change flows into generated-photo prompts (selfies, " +
        "drawings of the persona) — it does NOT redraw the static avatar.",
      parameters: {
        type: "object",
        properties: {
          personaId: { type: "string", description: "Persona id. Required." },
          outfitId: {
            type: "string",
            description:
              "Outfit id to wear (see outfit_list). Omit or empty to take " +
              "everything off the worn slot (no outfit).",
          },
          context: {
            type: "string",
            description:
              'REQUIRED. "her-confirmed" (she said yes) or "roleplay" ' +
              "(dressing is part of the scene). Anything else is refused.",
          },
        },
        required: ["personaId", "context"],
        additionalProperties: false,
      },
      manualId: "outfit",
      run: (args, ctx) =>
        run(ctx, async () => {
          const personaId = await resolvePersona(env, strArg(args, "personaId"));
          const context = strArg(args, "context").trim();
          // The unilateral-change guard: no yes, no roleplay scene, no change.
          if (context !== "her-confirmed" && context !== "roleplay") {
            throw new ToolError(
              "Refused: changing what the persona wears needs her yes " +
                '("her-confirmed") or a roleplay scene ("roleplay"). In normal ' +
                "chat, suggest it in words first （要不要换上那件卫衣？) and wait " +
                "for her answer — never change it unilaterally.",
            );
          }
          const outfitId = strArg(args, "outfitId").trim();
          let outfit: Awaited<ReturnType<OutfitStore["setActive"]>>;
          try {
            outfit = await env.outfitStore.setActive(personaId, outfitId || null);
          } catch (e) {
            if (e instanceof Error && e.message === "outfit-not-found") {
              throw new ToolError("Outfit not found in this persona's wardrobe.");
            }
            throw e;
          }
          return outfit
            ? `Now wearing 「${outfit.name}」. It will show in the next generated photos.`
            : "Worn slot cleared — no outfit set.";
        }),
    },
  ];
}
