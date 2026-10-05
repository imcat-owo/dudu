/**
 * Batch 7 I6 — draft token counter: heuristic token estimator.
 *
 * Ported from the tokenx algorithm (MIT, github.com/johannschopplich/tokenx),
 * the same source Kelivo's lib/core/utils/token_estimator.dart cites.
 * Simplified for the composer use-case (plain text, no tool overhead):
 * whitespace/punctuation-aware segmentation, CJK/kana/hangul weights,
 * short-word and digit handling. Pure — safe to call from any thread.
 */

/* eslint-disable no-control-regex */

const JS_WHITESPACE = "[ \\f\\n\\r\\t\\v   -     　﻿]";
const PUNCT = '[.,!?;(){}\\[\\]<>:\\\\/|@#$%^&*+=`~_"-]';

const TOKEN_SPLIT = new RegExp(`(${JS_WHITESPACE}+|${PUNCT}+)`);
const WHITESPACE_ONLY = new RegExp(`^${JS_WHITESPACE}+$`);
const PUNCT_CHAR = new RegExp(PUNCT);
const CJK = /[一-鿿㐀-䶿　-ヿ｀-ｯ︰-﹏가-힯]/;
const NUMERIC = /^\d+$/;
const LOWERCASE_WORD = /^[a-z]+$/;

const DEFAULT_CHARS_PER_TOKEN = 7;
const SHORT_TOKEN_THRESHOLD = 3;
const LOWERCASE_SINGLE_TOKEN_LEN = 8;
const PUNCT_CHARS_PER_TOKEN = 6;
const HANZI_CHARS_PER_TOKEN = 1.15;
const KANA_CHARS_PER_TOKEN = 1.4;
const HANGUL_CHARS_PER_TOKEN = 1.65;

function estimateSegment(segment: string): number {
  if (!segment) return 0;
  if (WHITESPACE_ONLY.test(segment)) return 0;
  const first = segment[0] ?? "";
  if (PUNCT_CHAR.test(first) && segment.split("").every((c) => PUNCT_CHAR.test(c))) {
    return Math.max(1, Math.ceil(segment.length / PUNCT_CHARS_PER_TOKEN));
  }
  if (NUMERIC.test(segment)) {
    return Math.max(1, Math.ceil(segment.length / 3));
  }
  // CJK-heavy segment: weight per character.
  let cjk = 0;
  let kana = 0;
  let hangul = 0;
  let other = 0;
  for (const ch of segment) {
    if (/[぀-ヿ｀-ｯ]/.test(ch)) kana += 1;
    else if (/[가-힯]/.test(ch)) hangul += 1;
    else if (CJK.test(ch)) cjk += 1;
    else other += 1;
  }
  const nonLatin = cjk + kana + hangul;
  if (nonLatin > 0 && nonLatin >= other) {
    return Math.max(
      1,
      Math.ceil(
        cjk / HANZI_CHARS_PER_TOKEN +
          kana / KANA_CHARS_PER_TOKEN +
          hangul / HANGUL_CHARS_PER_TOKEN +
          other / DEFAULT_CHARS_PER_TOKEN,
      ),
    );
  }
  if (LOWERCASE_WORD.test(segment) && segment.length <= LOWERCASE_SINGLE_TOKEN_LEN) {
    return segment.length <= SHORT_TOKEN_THRESHOLD ? 1 : 1;
  }
  if (segment.length <= SHORT_TOKEN_THRESHOLD) return 1;
  return Math.max(1, Math.ceil(segment.length / DEFAULT_CHARS_PER_TOKEN));
}

/** Heuristic token count for display purposes (not billing). */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const parts = text.split(TOKEN_SPLIT);
  let total = 0;
  for (const part of parts) total += estimateSegment(part);
  return total;
}

/**
 * Format a token count for the composer ("~1.2k").
 */
export function formatTokenCount(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}
