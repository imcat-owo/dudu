/**
 * Daily mood check-in （每日心情 check-in） — AI tools.
 *
 * The loop: once a day (her hour, default 20:00 — never her sleep
 * window) he asks how she's doing, through the real initiative
 * delivery path. When she answers — free text, in chat — the model
 * calls moodcheck_record: it lands on the visible mood timeline, updates
 * her latest mood (system-prompt awareness), and becomes a memory on
 * rough days ("she had a rough day on 10/5" is the kind of thing a
 * partner remembers).
 *
 * Nothing fires secretly: the timeline is visible (and deletable) in
 * Our Space → 心情记录. Smart skip means no redundant nudges: if her
 * mood is already on record today, or she was just active, or she
 * ignored yesterday's check-in, today stays quiet.
 *
 * manualId "moodcheck" pairs with src/manuals/moodcheck.ts (纸条机制).
 */

import type { LocalTool, ToolContext } from "../api-groups/local-tools";
import { ToolError } from "../api-groups/local-tools";
import type { MoodcheckStore } from "./store";
import { DEFAULT_CHECKIN_HOUR, isSleepHour } from "./store";
import { shanghaiDateLabel, shanghaiDayKey } from "./time";

export interface MoodcheckToolEnv {
  moodcheckStore: MoodcheckStore;
  /** our-space latest-mood (system-prompt awareness). */
  setHerMood(mood: string, note: string): Promise<unknown>;
  /** Write one memory card (rough days only — see shouldRemember). */
  addMemory(
    content: string,
    opts: { category: "fact"; confidence: "confident"; source: string; actor: "user" },
  ): Promise<unknown>;
  getPersona(personaId: string): Promise<{ id: string; name: string } | null>;
  listPersonas(): Promise<Array<{ id: string; name: string }>>;
  nowMs(): number;
}

/** Clearly-positive moods with no note don't need a memory card — the
 * timeline keeps them. Everything else (rough/neutral days, or any day
 * with something she wanted to say) is worth remembering. */
const POSITIVE_MOOD = /^(挺?好的?|不错|开心|很开心|超开心|棒|很好|非常好|happy|good|great)$/i;

export function shouldRemember(mood: string, note: string): boolean {
  if (note.trim().length > 0) return true;
  return !POSITIVE_MOOD.test(mood.trim());
}

function strArg(args: Record<string, unknown>, name: string): string {
  const v = args[name];
  return typeof v === "string" ? v : "";
}

function intArg(args: Record<string, unknown>, name: string): number | null {
  const v = args[name];
  if (typeof v !== "number" || !Number.isInteger(v)) return null;
  return v;
}

async function resolvePersona(env: MoodcheckToolEnv, personaId: string): Promise<string> {
  if (personaId) {
    const p = await env.getPersona(personaId).catch(() => null);
    if (!p) throw new ToolError(`Persona not found: ${personaId}.`);
    return personaId;
  }
  const config = await env.moodcheckStore.getConfig();
  if (config.personaId) {
    const p = await env.getPersona(config.personaId).catch(() => null);
    if (p) return config.personaId;
  }
  const personas = await env.listPersonas().catch(() => []);
  if (personas.length === 0) throw new ToolError("No persona exists yet.");
  return personas[0].id;
}

export function createMoodcheckTools(env: MoodcheckToolEnv): LocalTool[] {
  const run = async (_ctx: ToolContext, fn: () => Promise<string>): Promise<string> => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ToolError) throw e;
      throw new ToolError(e instanceof Error ? e.message : "Mood check-in tool failed.");
    }
  };

  return [
    {
      name: "moodcheck_record",
      description:
        "Record how SHE is feeling today （心情记录）. Call this whenever she " +
        'answers the daily check-in OR shares her mood in chat ("有点累", "今天超开心"). ' +
        "The mood lands on her visible timeline in Our Space → 心情记录, updates " +
        "what you know about her current state, and becomes a memory on rough " +
        "days. One entry per day (a second record updates today's entry). " +
        "ALWAYS call this when she tells you her mood — a partner remembers.",
      parameters: {
        type: "object",
        properties: {
          personaId: {
            type: "string",
            description: "Persona id. Defaults to the check-in persona.",
          },
          mood: {
            type: "string",
            description: 'Her mood in her own words, short — e.g. "有点累", "挺好的", "很糟".',
          },
          note: {
            type: "string",
            description: "Optional longer note in her words.",
          },
        },
        required: ["mood"],
        additionalProperties: false,
      },
      manualId: "moodcheck",
      run: (args, ctx) =>
        run(ctx, async () => {
          const mood = strArg(args, "mood").trim();
          if (!mood) throw new ToolError("mood is required — her words, short.");
          if (mood.length > 40) throw new ToolError("mood must be 40 characters or fewer.");
          const note = strArg(args, "note").trim().slice(0, 200);
          const personaId = await resolvePersona(env, strArg(args, "personaId"));
          const now = env.nowMs();
          const today = shanghaiDayKey(now);

          const lastDay = await env.moodcheckStore.getLastCheckinDay().catch(() => "");
          const source = lastDay === today ? "checkin" : "chat";
          const entry = await env.moodcheckStore.record({
            dayKey: today,
            personaId,
            mood,
            note,
            source,
          });
          // Latest mood → system-prompt awareness (existing our-space path).
          await env.setHerMood(mood, note).catch(() => {});
          // She answered today's check-in — the "don't nag" ledger is satisfied.
          if (lastDay === today) {
            await env.moodcheckStore.setLastOutcome("answered").catch(() => {});
          }
          // Rough days become memories — "she had a rough day on 10/5".
          let remembered = false;
          if (shouldRemember(mood, note)) {
            const label = shanghaiDateLabel(now);
            const content = `她${label}的心情是「${mood}」${note ? `，她说：${note}` : ""}。`;
            await env
              .addMemory(content, {
                category: "fact",
                confidence: "confident",
                source: "mood-checkin",
                actor: "user",
              })
              .catch(() => {});
            remembered = true;
          }
          return (
            `Recorded: 「${entry.mood}」 for ${today} ` +
            `(${source === "checkin" ? "from today's check-in" : "from chat"}). ` +
            `Visible in Our Space → 心情记录. ` +
            (remembered ? "Also saved to memory." : "Kept on the timeline only (a good day).")
          );
        }),
    },
    {
      name: "moodcheck_list",
      description:
        "List her mood timeline （心情记录）: date, mood, note, newest first. " +
        "Use when she asks how she's been feeling lately, or you want to " +
        "reference a rough day naturally.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max entries. Default 14." },
        },
        additionalProperties: false,
      },
      manualId: "moodcheck",
      run: (args, ctx) =>
        run(ctx, async () => {
          const limit = intArg(args, "limit") ?? 14;
          const entries = await env.moodcheckStore.list(Math.min(Math.max(1, limit), 100));
          if (entries.length === 0) return "No moods recorded yet.";
          return entries
            .map(
              (e) =>
                `- ${e.dayKey} [${e.id}]: 「${e.mood}」${e.note ? ` — ${e.note}` : ""} (${
                  e.source === "checkin" ? "check-in" : "chat"
                })`,
            )
            .join("\n");
        }),
    },
    {
      name: "moodcheck_delete",
      description:
        "Delete one mood timeline entry （心情记录） — it disappears from Our Space. " +
        "Use when she asks to forget / remove a day's mood.",
      parameters: {
        type: "object",
        properties: {
          entryId: { type: "string", description: "Entry id (see moodcheck_list)." },
        },
        required: ["entryId"],
        additionalProperties: false,
      },
      manualId: "moodcheck",
      run: (args, ctx) =>
        run(ctx, async () => {
          const entryId = strArg(args, "entryId");
          if (!entryId) throw new ToolError("entryId is required.");
          const ok = await env.moodcheckStore.remove(entryId);
          if (!ok) throw new ToolError("Mood entry not found.");
          return "Deleted that mood entry.";
        }),
    },
    {
      name: "moodcheck_set_config",
      description:
        "Configure the daily mood check-in （每日心情）: master toggle, the " +
        "hour it asks (Shanghai wall clock), and which persona asks. " +
        `Default hour is ${DEFAULT_CHECKIN_HOUR}:00 — she is nocturnal, so the hour ` +
        "can NEVER be inside her 06:00–16:00 sleep window (setting one is refused). " +
        "Use when she says to turn it off/on or change the time.",
      parameters: {
        type: "object",
        properties: {
          enabled: { type: "boolean", description: "Master toggle." },
          hour: {
            type: "number",
            description: "Shanghai hour 0–23 the check-in fires. Never 6–16.",
          },
          personaId: { type: "string", description: "Which persona asks." },
        },
        additionalProperties: false,
      },
      manualId: "moodcheck",
      run: (args, ctx) =>
        run(ctx, async () => {
          const patch: { enabled?: boolean; hour?: number; personaId?: string } = {};
          if (typeof args.enabled === "boolean") patch.enabled = args.enabled;
          const hour = intArg(args, "hour");
          if (hour !== null) {
            if (hour < 0 || hour > 23) throw new ToolError("hour must be 0–23 (Shanghai time).");
            if (isSleepHour(hour)) {
              throw new ToolError(
                "That hour is inside her 06:00–16:00 sleep window — the check-in can never " +
                  "fire while she's asleep. Pick an evening/night hour (e.g. 18–23).",
              );
            }
            patch.hour = hour;
          }
          const personaId = strArg(args, "personaId");
          if (personaId) {
            const p = await env.getPersona(personaId).catch(() => null);
            if (!p) throw new ToolError(`Persona not found: ${personaId}.`);
            patch.personaId = personaId;
          }
          if (Object.keys(patch).length === 0) {
            const c = await env.moodcheckStore.getConfig();
            return `Current: ${c.enabled ? "on" : "off"}, ${c.hour}:00 Shanghai daily.`;
          }
          const next = await env.moodcheckStore.setConfig(patch);
          return `Daily mood check-in: ${next.enabled ? "on" : "off"}, fires daily at ${next.hour}:00 Shanghai.`;
        }),
    },
  ];
}
