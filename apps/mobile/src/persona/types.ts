/**
 * Persona system — types. PURE module: no React Native / expo imports.
 *
 * A Persona is the AI's identity for a dialog: name, avatar, personality,
 * system prompt, and behavior settings. Learned from Kelivo's Assistant model
 * (lib/core/models/assistant.dart) but streamlined for Dudu's dialog model.
 *
 * Personas are separate from dialogs — one persona can be used by many
 * dialogs, and a dialog can switch personas. Tags organize personas.
 */

/** One persona tag for organizing personas. */
export interface PersonaTag {
  id: string;
  /** Display name, e.g. "温柔", "傲娇", "工作". */
  name: string;
  /** Optional color hex for the tag chip. */
  color?: string;
  createdAt: number;
}

/** A persona — the AI's identity card. */
export interface Persona {
  id: string;
  /** Display name, e.g. "嘟嘟". */
  name: string;
  /** Avatar: local path, URL, or null for default. */
  avatar: string | null;
  /** Short description shown in the picker. */
  description: string;
  /** Tag IDs for organizing. */
  tagIds: string[];
  /** The system prompt that defines this persona. */
  systemPrompt: string;
  /** Greeting message sent when a new dialog starts with this persona. */
  greeting: string;
  /** Background / backstory for roleplay. */
  background: string;
  /** Personality traits, one per line. */
  personality: string;
  /** Example dialogue, user/AI turns. */
  exampleDialogue: string;
  /** Message template, e.g. "{{ message }}". Template variables: {{ message }}, {{ user }}, {{ persona }}. */
  messageTemplate: string;
  /** Regex replacement rules applied to AI output. */
  regexRules: PersonaRegexRule[];
  /** Sampling params (null = use model default). */
  temperature: number | null;
  topP: number | null;
  maxTokens: number | null;
  /** Whether this persona is available for new dialogs. */
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

/** One regex replacement rule for a persona. */
export interface PersonaRegexRule {
  id: string;
  /** Display name for the rule. */
  name: string;
  /** Pattern (JS RegExp source). */
  pattern: string;
  /** Replacement string. */
  replacement: string;
  /** Global flag. */
  global: boolean;
  /** Case-insensitive flag. */
  caseInsensitive: boolean;
  enabled: boolean;
}

/** Validate a persona (returns error message or null if valid). */
export function validatePersona(p: Partial<Persona>): string | null {
  if (!p.name || !p.name.trim()) return "name-required";
  if (p.name.trim().length > 50) return "name-too-long";
  if (p.temperature != null && (p.temperature < 0 || p.temperature > 2)) return "temperature-range";
  if (p.topP != null && (p.topP < 0 || p.topP > 1)) return "top-p-range";
  if (p.maxTokens != null && (p.maxTokens < 1 || p.maxTokens > 200000)) return "max-tokens-range";
  for (const rule of p.regexRules ?? []) {
    if (!rule.pattern) return "regex-pattern-required";
    try {
      // eslint-disable-next-line no-new
      new RegExp(rule.pattern);
    } catch {
      return "regex-invalid";
    }
  }
  return null;
}

/** Apply regex rules to text (for AI output post-processing). */
export function applyPersonaRegex(text: string, rules: PersonaRegexRule[]): string {
  let out = text;
  for (const rule of rules) {
    if (!rule.enabled || !rule.pattern) continue;
    try {
      const flags = `${rule.global ? "g" : ""}${rule.caseInsensitive ? "i" : ""}`;
      const re = new RegExp(rule.pattern, flags);
      out = out.replace(re, rule.replacement);
    } catch {
      // One bad rule must not break the others.
      continue;
    }
  }
  return out;
}

/** Render a message template with variables. */
export function renderPersonaTemplate(
  template: string,
  vars: { message: string; user: string; persona: string },
): string {
  return template
    .replace(/\{\{\s*message\s*\}\}/g, vars.message)
    .replace(/\{\{\s*user\s*\}\}/g, vars.user)
    .replace(/\{\{\s*persona\s*\}\}/g, vars.persona);
}

export function newPersonaId(): string {
  return `persona_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function newPersonaTagId(): string {
  return `ptag_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function newRegexRuleId(): string {
  return `pregex_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Create a blank persona with sensible defaults. */
export function blankPersona(): Persona {
  const now = Date.now();
  return {
    id: newPersonaId(),
    name: "",
    avatar: null,
    description: "",
    tagIds: [],
    systemPrompt: "",
    greeting: "",
    background: "",
    personality: "",
    exampleDialogue: "",
    messageTemplate: "{{ message }}",
    regexRules: [],
    temperature: null,
    topP: null,
    maxTokens: null,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}
