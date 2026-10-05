/**
 * H11 — Apple NaturalLanguage framework bridge (TS side).
 *
 * On-device NLP: language detection, named entities, sentiment.
 * Small, private, no network — good for "what language is she typing"
 * or "is this message angry" without sending text anywhere.
 *
 * Native: `DuduNLP` module (see plugins/dudu-platform/nlp/).
 * Unavailable → null/false, never faked.
 */

import { getNativeModule } from "./types";

export type NLLanguage = string; // BCP-47, e.g. "zh-Hans", "en"

export interface NLEntity {
  text: string;
  /** e.g. "PersonName", "PlaceName", "OrganizationName" */
  type: string;
  /** 0..1 confidence when provided */
  confidence?: number;
}

async function loadModule(): Promise<{
  dominantLanguage(text: string): Promise<NLLanguage | null>;
  entities(text: string): Promise<NLEntity[]>;
  sentiment(text: string): Promise<number | null>;
} | null> {
  return getNativeModule<{
    dominantLanguage(text: string): Promise<NLLanguage | null>;
    entities(text: string): Promise<NLEntity[]>;
    sentiment(text: string): Promise<number | null>;
  }>("DuduNLP");
}

/** True when the native NLP module is linked. */
export async function isAppleNLPAvailable(): Promise<boolean> {
  return (await loadModule()) != null;
}

/** Dominant language of the text (BCP-47), or null. */
export async function detectLanguage(text: string): Promise<NLLanguage | null> {
  if (!text.trim()) return null;
  const mod = await loadModule();
  if (!mod) return null;
  try {
    return await mod.dominantLanguage(text);
  } catch {
    return null;
  }
}

/** Named entities found in the text. */
export async function extractEntities(text: string): Promise<NLEntity[]> {
  if (!text.trim()) return [];
  const mod = await loadModule();
  if (!mod) return [];
  try {
    return await mod.entities(text);
  } catch {
    return [];
  }
}

/**
 * Sentiment score in [-1, 1] (negative → positive), or null.
 * Useful for "she sounds upset" heuristics — combine with other signals,
 * never decide on this alone.
 */
export async function analyzeSentiment(text: string): Promise<number | null> {
  if (!text.trim()) return null;
  const mod = await loadModule();
  if (!mod) return null;
  try {
    const s = await mod.sentiment(text);
    return typeof s === "number" ? Math.max(-1, Math.min(1, s)) : null;
  } catch {
    return null;
  }
}
