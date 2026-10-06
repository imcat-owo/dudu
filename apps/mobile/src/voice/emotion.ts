/**
 * Emotional TTS — emotion detection + emotion → voice-parameter mapping.
 *
 * PURE module: no React Native / expo imports, no I/O. The classifier is a
 * small local Chinese keyword/punctuation scorer; the model is the fallback
 * (it can pass an explicit emotion to the speak tools). It NEVER defaults
 * to a fake "always happy" — no signal means "calm".
 *
 * The mapping MUST be real: every emotion resolves to concrete synthesis
 * parameters (rate / pitch / volume) that the TTS layer actually passes to
 * the provider. A label that changes nothing is a lie.
 *
 * Provider contract (honest limits — see the voice manual):
 * - edge-tts: rate + pitch (Hz) + volume (%) via SSML <prosody>. Full support.
 * - minimax: speed + pitch (semitones, approximated from Hz) + vol. Full support.
 * - custom / stepfun / fish-audio: OpenAI-compatible — speed only.
 *   Pitch/volume are silently unavailable there; the rate still applies.
 * - qwen: no prosody parameters at all — always flat. Documented, not faked.
 *
 * The mapping respects her voice brief (~/user/voice-brief.md): a young
 * male Mandarin voice, mid-to-low register, that drifts UP and pushes
 * forward when emotions run high. So "excited" lifts pitch and pace while
 * "sad" drops both — never a chipmunk, never a robot.
 */

/** The emotion set — kept small on purpose. "calm" is the honest default. */
export type VoiceEmotion = "happy" | "excited" | "gentle" | "sad" | "playful" | "calm" | "serious";

export const VOICE_EMOTIONS: VoiceEmotion[] = [
  "happy",
  "excited",
  "gentle",
  "sad",
  "playful",
  "calm",
  "serious",
];

export function isVoiceEmotion(v: unknown): v is VoiceEmotion {
  return typeof v === "string" && (VOICE_EMOTIONS as string[]).includes(v);
}

/** Concrete synthesis parameters. All three are deltas around the neutral voice. */
export interface EmotionProsody {
  /** Rate multiplier around 1.0 (applied on top of her base speed setting). */
  rate: number;
  /** Pitch shift in Hz for SSML prosody (edge-tts). */
  pitchHz: number;
  /** Volume shift in percent for SSML prosody (edge-tts). */
  volumePct: number;
}

/**
 * Emotion → voice parameters. Modest on purpose: her brief says the voice
 * is "mid-to-low, drifting up when emotional" — these are nudges, not
 * costumes. edge-tts's emotional range is limited; this stays inside what
 * it can honestly render.
 */
export function emotionProsody(emotion: VoiceEmotion): EmotionProsody {
  switch (emotion) {
    case "happy":
      return { rate: 1.08, pitchHz: 10, volumePct: 8 };
    case "excited":
      return { rate: 1.18, pitchHz: 22, volumePct: 12 };
    case "gentle":
      return { rate: 0.92, pitchHz: -6, volumePct: -8 };
    case "sad":
      return { rate: 0.85, pitchHz: -16, volumePct: -15 };
    case "playful":
      return { rate: 1.12, pitchHz: 16, volumePct: 8 };
    case "serious":
      return { rate: 0.95, pitchHz: -8, volumePct: 0 };
    case "calm":
      return { rate: 1.0, pitchHz: 0, volumePct: 0 };
  }
}

type ScoredEmotion = Exclude<VoiceEmotion, "calm">;

interface Signal {
  emotion: ScoredEmotion;
  weight: number;
  re: RegExp;
}

/**
 * Weighted Chinese signals. Scores are deliberately conservative: a single
 * "！" on a neutral sentence is NOT enough to call it happy (threshold 2).
 */
const SIGNALS: Signal[] = [
  // excited — doubled punctuation, 太…了, overt excitement words
  { emotion: "excited", weight: 2, re: /！{2,}/ },
  { emotion: "excited", weight: 2, re: /太.{0,6}了/ },
  { emotion: "excited", weight: 2, re: /好耶|万岁|太棒了|超[级]?开心|激动|兴奋/ },
  { emotion: "excited", weight: 1, re: /！/ },
  // happy
  { emotion: "happy", weight: 2, re: /开心|高兴|快乐|幸福|甜蜜/ },
  { emotion: "happy", weight: 1, re: /爱你|喜欢你|真好/ },
  // playful — laughter leans playful (teasing), not just happy
  { emotion: "playful", weight: 2, re: /哈哈|嘿嘿|嘻嘻|略略|坏笑/ },
  { emotion: "playful", weight: 1, re: /逗你|调皮|好笑|～/ },
  // sad — ellipsis is the strongest tell in her writing
  { emotion: "sad", weight: 2, re: /…{2,}/ },
  { emotion: "sad", weight: 2, re: /难过|想哭|委屈|心疼|对不起|抱歉/ },
  { emotion: "sad", weight: 1, re: /唉|叹气/ },
  { emotion: "sad", weight: 1, re: /好累|累了|疲惫/ },
  { emotion: "sad", weight: 1, re: /别哭|没事吧/ },
  // gentle — bedtime / soothing register
  { emotion: "gentle", weight: 2, re: /晚安|乖|别怕|没事的|慢慢来|抱抱|摸摸/ },
  { emotion: "gentle", weight: 1, re: /[呢吧哦呀]$/ },
  // serious
  { emotion: "serious", weight: 2, re: /说真的|认真|听我说|重要|必须|答应我/ },
];

/** Tie-break priority when two emotions score equally. */
const TIE_BREAK: ScoredEmotion[] = ["serious", "sad", "excited", "playful", "happy", "gentle"];

/** Minimum total score to leave "calm". Below this: not enough signal, stay flat. */
const CALM_THRESHOLD = 2;

/**
 * Classify the emotion of a message from its Chinese text.
 * Pure and deterministic. Returns "calm" when there is no clear signal —
 * never invents an emotion the words don't carry.
 */
export function classifyEmotion(text: string): VoiceEmotion {
  const scores = new Map<ScoredEmotion, number>();
  for (const s of SIGNALS) {
    if (s.re.test(text)) {
      scores.set(s.emotion, (scores.get(s.emotion) ?? 0) + s.weight);
    }
  }
  let best: ScoredEmotion | null = null;
  let bestScore = 0;
  for (const e of TIE_BREAK) {
    const sc = scores.get(e) ?? 0;
    if (sc > bestScore) {
      best = e;
      bestScore = sc;
    }
  }
  if (best === null || bestScore < CALM_THRESHOLD) return "calm";
  return best;
}

/** Her switches for the emotion layer. */
export interface EmotionSwitches {
  emotionalTts: boolean;
  emotionPin: VoiceEmotion | null;
}

/**
 * Resolve which emotion (if any) a synthesis should use.
 * Precedence: master switch off → null (flat, old behavior);
 * explicit (the AI's per-message choice) → her pinned tone →
 * auto-classification from the text.
 */
export function resolveSpeakEmotion(
  text: string,
  switches: EmotionSwitches,
  explicit?: string | null,
): VoiceEmotion | null {
  if (!switches.emotionalTts) return null;
  if (explicit && isVoiceEmotion(explicit)) return explicit;
  if (switches.emotionPin && isVoiceEmotion(switches.emotionPin)) {
    return switches.emotionPin;
  }
  return classifyEmotion(text);
}
