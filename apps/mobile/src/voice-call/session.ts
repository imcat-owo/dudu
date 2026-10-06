/**
 * VoiceCallSession — duplex call orchestrator.
 *
 * Drives the PURE DuplexTurnEngine with injected audio/AI adapters, so the
 * whole conversation loop is node-testable with fakes and the React Native
 * details (expo-audio) live only in instances.ts / call-ui.tsx.
 *
 * Pipeline (cascaded, Pipecat-style, adapted to RN constraints):
 *   monitor recorder (metering) → EnergyVad → segment recorder → file
 *   → STT → LLM (one-shot) → sentence-split → TTS per sentence → player
 *   Barge-in: BargeInVad on monitor metering while speaking → pause player,
 *   cancel the TTS queue, hand the turn back to her.
 *
 * Honest limits (also in manuals/voice-call.ts):
 * - Turn latency is chunked: capture + STT + LLM + first TTS sentence.
 *   Expect seconds, not the 1.5s of server-side realtime models.
 * - Segment handoff (monitor → segment recorder) can clip ~200ms of onset.
 * - Echo: barge-in uses a louder threshold while speaking; true AEC needs
 *   the OS audio session (verified on device, not in tests).
 */

import { DuplexTurnEngine, type EngineAction } from "./turn-engine";
import {
  type CallStats,
  type CallTranscriptEntry,
  DEFAULT_VAD_CONFIG,
  type TurnState,
  type VadConfig,
} from "./types";
import { BargeInVad, EnergyVad } from "./vad";

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

/** Mic: monitor mode (metering) + segment mode (utterance files). */
export interface MicAdapter {
  /** Begin continuous metering; onMetering receives live dB samples. */
  startMonitor(onMetering: (db: number | undefined) => void): Promise<void>;
  stopMonitor(): Promise<void>;
  /**
   * Restart the recorder so the next stopSegment() returns a file holding
   * ONLY audio from here on. Metering (the monitor callback) is NOT
   * interrupted — the VAD keeps its in-progress speech across the restart.
   * Single-recorder design: one mic stream, file boundaries per turn.
   */
  startSegment(): Promise<void>;
  /** Stop and return the current segment file URI (null = nothing usable). */
  stopSegment(): Promise<string | null>;
  /** Abandon the current segment (no URI needed). */
  cancelSegment(): Promise<void>;
}

export interface SpeakerAdapter {
  /** Play URIs in order; resolves when the queue is fully played. */
  playQueue(uris: string[]): Promise<void>;
  /** Stop immediately (barge-in). Synchronous-feel: pause first. */
  stopNow(): void;
  readonly isPlaying: boolean;
}

export interface CallAdapters {
  mic: MicAdapter;
  speaker: SpeakerAdapter;
  /** File URI → transcribed text. Throw on failure (loud, never fake). */
  stt: (uri: string) => Promise<string>;
  /** Full conversation → assistant reply text (her language). */
  llm: (history: ChatTurn[]) => Promise<string>;
  /** One sentence → playable audio file URI. */
  tts: (sentence: string) => Promise<string>;
  nowMs?: () => number;
}

export interface CallSessionEvents {
  onTurnState?: (s: TurnState) => void;
  onTranscript?: (t: CallTranscriptEntry[]) => void;
  onStats?: (s: CallStats) => void;
  onError?: (message: string) => void;
}

export class VoiceCallSession {
  private readonly engine: DuplexTurnEngine;
  private readonly vad: EnergyVad;
  private readonly bargeVad: BargeInVad;
  private readonly nowMs: () => number;
  private running = false;
  private muted = false;
  private readonly history: ChatTurn[] = [];
  private speakToken = 0;
  private captureStartAt = 0;
  private destroyed = false;

  constructor(
    private readonly adapters: CallAdapters,
    private readonly cfg: VadConfig = DEFAULT_VAD_CONFIG,
    private readonly events: CallSessionEvents = {},
  ) {
    this.nowMs = adapters.nowMs ?? (() => Date.now());
    this.engine = new DuplexTurnEngine(this.nowMs);
    this.vad = new EnergyVad(cfg);
    this.bargeVad = new BargeInVad(cfg);
  }

  get turnState(): TurnState {
    return this.engine.state;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Feed one metering sample from the monitor recorder. */
  onMetering(db: number | undefined): void {
    if (!this.running || this.muted || this.engine.isEnded) return;
    const now = this.nowMs();
    const state = this.engine.state;
    if (state === "speaking") {
      for (const e of this.bargeVad.push(db, now)) {
        if (e === "speech-start") {
          // Gate: speech-start alone doesn't interrupt; the sustained-speech
          // check below (MinWords-like) decides.
        }
      }
      if (this.bargeVad.isSpeaking && this.bargeVad.speechDurationMs(now) >= this.cfg.minSpeechMs) {
        this.doBargeIn();
      }
    } else if (state === "listening") {
      for (const e of this.vad.push(db, now)) {
        if (e === "speech-start")
          this.runActions(this.engine.dispatch({ type: "vad-speech-start" }));
      }
    } else if (state === "capturing") {
      for (const e of this.vad.push(db, now)) {
        if (e === "speech-end") this.runActions(this.engine.dispatch({ type: "vad-speech-end" }));
      }
      if (now - this.captureStartAt > this.cfg.maxTurnMs) {
        this.runActions(this.engine.dispatch({ type: "capture-timeout" }));
      }
    }
  }

  private doBargeIn(): void {
    this.bargeVad.reset();
    this.speakToken += 1; // invalidate the in-flight speak queue
    this.runActions(this.engine.dispatch({ type: "barge-in" }));
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.adapters.mic.startMonitor((db) => this.onMetering(db));
    this.emit();
  }

  async end(reason = "user-ended"): Promise<void> {
    if (!this.running) return;
    this.speakToken += 1;
    this.runActions(this.engine.dispatch({ type: "end-call" }));
    await this.teardown();
    void reason;
  }

  /** Mute: stop listening entirely (no phantom VAD while muted). */
  async setMuted(muted: boolean): Promise<void> {
    this.muted = muted;
    if (!this.running || this.destroyed) return;
    if (muted) {
      await this.adapters.mic.stopMonitor().catch(() => {});
      this.vad.reset();
      this.bargeVad.reset();
    } else if (this.engine.state === "listening" || this.engine.state === "speaking") {
      await this.adapters.mic.startMonitor((db) => this.onMetering(db)).catch(() => {});
    }
  }

  private async teardown(): Promise<void> {
    this.running = false;
    this.destroyed = true;
    try {
      await this.adapters.mic.stopMonitor().catch(() => {});
      await this.adapters.mic.cancelSegment().catch(() => {});
    } catch {
      // best effort
    }
    try {
      this.adapters.speaker.stopNow();
    } catch {
      // best effort
    }
    this.emit();
  }

  private emit(): void {
    this.events.onTurnState?.(this.engine.state);
    this.events.onTranscript?.(this.engine.getTranscript());
    this.events.onStats?.(this.engine.getStats());
  }

  private runActions(actions: EngineAction[]): void {
    for (const a of actions) void this.execute(a);
    this.emit();
  }

  private async execute(action: EngineAction): Promise<void> {
    if (this.destroyed) return;
    try {
      switch (action.type) {
        case "start-capture": {
          this.captureStartAt = this.nowMs();
          // Keep the in-progress speech: the monitor never stops metering
          // (startSegment restarts the recorder file, not the VAD), so a
          // natural speech-end still fires on silence. From a barge-in the
          // normal VAD wasn't fed while speaking — mark it explicitly.
          if (!this.vad.isSpeaking) this.vad.forceSpeaking(this.nowMs());
          await this.adapters.mic.startSegment();
          break;
        }
        case "stop-capture-transcribe": {
          const uri = await this.adapters.mic.stopSegment().catch(() => null);
          if (!uri) {
            this.runActions(this.engine.dispatch({ type: "stt-empty" }));
          } else {
            const myUri = uri;
            this.adapters.stt(myUri).then(
              (text) => this.runActions(this.engine.dispatch({ type: "stt-done", text })),
              (e) =>
                this.runActions(
                  this.engine.dispatch({
                    type: "stt-error",
                    error: e instanceof Error ? e.message : String(e),
                  }),
                ),
            );
          }
          // Back to monitoring for the next turn / barge-in.
          await this.adapters.mic.startMonitor((db) => this.onMetering(db)).catch(() => {});
          break;
        }
        case "think": {
          this.history.push({ role: "user", text: action.userText });
          const snapshot = [...this.history];
          this.adapters.llm(snapshot).then(
            (text) => this.runActions(this.engine.dispatch({ type: "llm-done", text })),
            (e) =>
              this.runActions(
                this.engine.dispatch({
                  type: "llm-error",
                  error: e instanceof Error ? e.message : String(e),
                }),
              ),
          );
          break;
        }
        case "speak": {
          const token = ++this.speakToken;
          this.history.push({ role: "assistant", text: action.sentences.join("") });
          // Barge-in monitor runs while the AI talks.
          await this.adapters.mic.startMonitor((db) => this.onMetering(db)).catch(() => {});
          const uris: string[] = [];
          try {
            for (const s of action.sentences) {
              if (token !== this.speakToken || this.destroyed) return; // barged in
              uris.push(await this.adapters.tts(s));
            }
          } catch (e) {
            this.events.onError?.(e instanceof Error ? e.message : String(e));
            this.runActions(this.engine.dispatch({ type: "tts-queue-empty" }));
            return;
          }
          if (token !== this.speakToken || this.destroyed) return;
          try {
            await this.adapters.speaker.playQueue(uris);
          } catch {
            // playback failed — treat as done speaking, stay honest in transcript
          }
          if (token !== this.speakToken || this.destroyed) return;
          this.runActions(this.engine.dispatch({ type: "tts-queue-empty" }));
          break;
        }
        case "cancel-speech": {
          try {
            this.adapters.speaker.stopNow();
          } catch {
            // best effort
          }
          break;
        }
        case "back-to-listening": {
          await this.adapters.mic.startMonitor((db) => this.onMetering(db)).catch(() => {});
          break;
        }
        case "call-ended": {
          await this.teardown();
          break;
        }
      }
    } catch (e) {
      this.events.onError?.(e instanceof Error ? e.message : String(e));
    }
    this.emit();
  }
}
