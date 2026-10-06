/**
 * Voice call (realtime duplex) — shared types. PURE, no RN imports.
 *
 * A "call" here is a full-duplex voice conversation inside the app:
 * mic → VAD → STT → LLM → streaming TTS → speaker, with barge-in
 * (she can interrupt the AI mid-sentence, like Pipecat's InterruptionFrame).
 */

/** Lifecycle of one call. */
export type CallPhase =
  | "idle"
  | "outgoing" // she tapped "call"
  | "ringing" // AI-proposed call, waiting for her accept/decline
  | "connecting" // mic warming up
  | "live" // duplex conversation running
  | "ending"
  | "ended";

/** Turn state inside a live call. */
export type TurnState = "listening" | "capturing" | "thinking" | "speaking";

/**
 * Energy VAD config. Adapted from the Pipecat/LiveKit pattern
 * (stop_secs, min-words interruption gate) to expo-audio metering,
 * which reports dB as a negative number (silence ≈ -160, speech ≈ -45..-10).
 */
export interface VadConfig {
  /** Metering dB above this counts as speech. */
  speechThresholdDb: number;
  /** Silence this long ends the user's turn (Pipecat's stop_secs). */
  silenceEndMs: number;
  /** Speech must last this long to count as barge-in (MinWords-like gate). */
  minSpeechMs: number;
  /** Safety cap on a single capture. */
  maxTurnMs: number;
  /** Extra dB required for barge-in while the AI is speaking (echo guard). */
  bargeInExtraDb: number;
}

export const DEFAULT_VAD_CONFIG: VadConfig = {
  speechThresholdDb: -38,
  silenceEndMs: 900,
  minSpeechMs: 450,
  maxTurnMs: 60_000,
  bargeInExtraDb: 10,
};

export interface CallTranscriptEntry {
  at: number;
  role: "user" | "assistant";
  text: string;
}

export type ProposalStatus = "ringing" | "accepted" | "declined" | "missed" | "expired";

export interface CallProposal {
  id: string;
  personaId: string;
  personaName: string;
  /** WHY the AI wants to call — shown to her, the consent basis. */
  reason: string;
  topic?: string;
  createdAt: number;
  status: ProposalStatus;
}

export interface CallStats {
  turns: number;
  bargeIns: number;
  startedAt: number;
  endedAt?: number;
}

/** Split reply text into speakable sentences (sentence-level TTS streaming). */
export function splitSentences(text: string): string[] {
  const parts = text
    .split(/(?<=[。！？!?…])/u)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length > 0) return parts;
  const fallback = text.trim();
  return fallback ? [fallback] : [];
}
