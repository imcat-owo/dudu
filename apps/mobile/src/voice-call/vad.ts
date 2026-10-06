/**
 * Energy-based voice activity detection over expo-audio metering samples.
 * PURE — the clock is injected, so this is fully node-testable.
 *
 * Pattern adapted from Pipecat's VADParams (confidence/start_secs/stop_secs)
 * minus the neural net: on-device we use the recorder's dB metering.
 * expo-audio metering is negative dB; speech is louder (less negative).
 */
import type { VadConfig } from "./types";

export type VadEvent = "speech-start" | "speech-end";

export class EnergyVad {
  private speaking = false;
  private speechStartAt = 0;
  private lastSpeechAt = 0;

  constructor(private readonly cfg: VadConfig) {}

  /**
   * Feed one metering sample. Returns any edge events.
   * `db` undefined (metering unavailable) is treated as silence.
   */
  push(db: number | undefined, nowMs: number): VadEvent[] {
    const events: VadEvent[] = [];
    const isSpeech = typeof db === "number" && db > this.cfg.speechThresholdDb;
    if (isSpeech) {
      this.lastSpeechAt = nowMs;
      if (!this.speaking) {
        this.speaking = true;
        this.speechStartAt = nowMs;
        events.push("speech-start");
      }
    } else if (this.speaking && nowMs - this.lastSpeechAt >= this.cfg.silenceEndMs) {
      this.speaking = false;
      events.push("speech-end");
    }
    return events;
  }

  get isSpeaking(): boolean {
    return this.speaking;
  }

  /** How long the current speech burst has lasted (for the barge-in gate). */
  speechDurationMs(nowMs: number): number {
    return this.speaking ? nowMs - this.speechStartAt : 0;
  }

  reset(): void {
    this.speaking = false;
  }

  /**
   * Mark speech as in-progress without emitting (used when a capture
   * starts from a barge-in: the normal VAD wasn't fed while speaking,
   * but her voice is already going — silence from here must end it).
   */
  forceSpeaking(nowMs: number): void {
    this.speaking = true;
    this.speechStartAt = nowMs;
    this.lastSpeechAt = nowMs;
  }
}

/**
 * A stricter VAD used while the AI is speaking: requires louder audio
 * (echo guard — the speaker feeds back into the mic) before it counts.
 */
export class BargeInVad extends EnergyVad {
  constructor(cfg: VadConfig) {
    super({ ...cfg, speechThresholdDb: cfg.speechThresholdDb + cfg.bargeInExtraDb });
  }
}
