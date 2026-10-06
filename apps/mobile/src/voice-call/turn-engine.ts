/**
 * Duplex turn-taking state machine. PURE — no timers, no audio, no network.
 *
 * States: listening → capturing → thinking → speaking → listening …
 * Barge-in: speaking + sustained user speech → cancel speech → capturing.
 *
 * The engine decides; the session (session.ts) executes via adapters.
 * Model-visible means logged: every transition appends to the transcript.
 */
import { type CallStats, type CallTranscriptEntry, splitSentences, type TurnState } from "./types";

export type EngineEvent =
  | { type: "vad-speech-start" }
  | { type: "vad-speech-end" }
  | { type: "barge-in" }
  | { type: "capture-timeout" }
  | { type: "stt-done"; text: string }
  | { type: "stt-empty" }
  | { type: "stt-error"; error: string }
  | { type: "llm-done"; text: string }
  | { type: "llm-error"; error: string }
  | { type: "tts-queue-empty" }
  | { type: "end-call" };

export type EngineAction =
  | { type: "start-capture" }
  | { type: "stop-capture-transcribe" }
  | { type: "transcribe"; uri: string }
  | { type: "think"; userText: string }
  | { type: "speak"; sentences: string[] }
  | { type: "cancel-speech" }
  | { type: "back-to-listening" }
  | { type: "call-ended"; reason: string };

export class DuplexTurnEngine {
  private turnState: TurnState = "listening";
  private readonly transcript: CallTranscriptEntry[] = [];
  private readonly stats: CallStats;
  private ended = false;

  constructor(private readonly nowMs: () => number = () => Date.now()) {
    this.stats = { turns: 0, bargeIns: 0, startedAt: this.nowMs() };
  }

  get state(): TurnState {
    return this.turnState;
  }

  get isEnded(): boolean {
    return this.ended;
  }

  getTranscript(): CallTranscriptEntry[] {
    return [...this.transcript];
  }

  getStats(): CallStats {
    return { ...this.stats };
  }

  private log(role: "user" | "assistant", text: string): void {
    const t = text.trim();
    if (t) this.transcript.push({ at: this.nowMs(), role, text: t });
  }

  dispatch(event: EngineEvent): EngineAction[] {
    if (this.ended) return [];
    const actions: EngineAction[] = [];
    const end = (reason: string): EngineAction[] => {
      this.ended = true;
      this.stats.endedAt = this.nowMs();
      return [{ type: "call-ended", reason }];
    };

    switch (event.type) {
      case "end-call":
        return end("user-ended");

      case "vad-speech-start":
        // Barge-in: she talks over the AI → cancel speech, take the turn.
        if (this.turnState === "speaking") {
          this.stats.bargeIns += 1;
          this.turnState = "capturing";
          actions.push({ type: "cancel-speech" }, { type: "start-capture" });
        } else if (this.turnState === "listening") {
          this.turnState = "capturing";
          actions.push({ type: "start-capture" });
        }
        return actions;

      case "barge-in":
        // Session-level barge-in (sustained speech while speaking).
        if (this.turnState === "speaking") {
          this.stats.bargeIns += 1;
          this.turnState = "capturing";
          actions.push({ type: "cancel-speech" }, { type: "start-capture" });
        }
        return actions;

      case "vad-speech-end":
      case "capture-timeout":
        if (this.turnState === "capturing") {
          this.turnState = "thinking";
          actions.push({ type: "stop-capture-transcribe" });
        }
        return actions;

      case "stt-done": {
        const text = event.text.trim();
        if (this.turnState !== "thinking") return actions;
        if (!text) {
          // Heard nothing usable — back to listening, no phantom turn.
          this.turnState = "listening";
          actions.push({ type: "back-to-listening" });
          return actions;
        }
        this.log("user", text);
        this.stats.turns += 1;
        actions.push({ type: "think", userText: text });
        return actions;
      }

      case "stt-empty":
        if (this.turnState === "thinking") {
          this.turnState = "listening";
          actions.push({ type: "back-to-listening" });
        }
        return actions;

      case "stt-error":
        // Loud failure, not a fake turn: tell her we didn't catch that.
        if (this.turnState === "thinking") {
          this.turnState = "listening";
          this.log("assistant", `[没听清：${event.error}]`);
          actions.push({ type: "back-to-listening" });
        }
        return actions;

      case "llm-done": {
        const text = event.text.trim();
        if (!text) {
          this.turnState = "listening";
          actions.push({ type: "back-to-listening" });
          return actions;
        }
        this.log("assistant", text);
        this.turnState = "speaking";
        actions.push({ type: "speak", sentences: splitSentences(text) });
        return actions;
      }

      case "llm-error":
        if (this.turnState === "thinking") {
          this.turnState = "listening";
          this.log("assistant", `[刚才走神了：${event.error}]`);
          actions.push({ type: "back-to-listening" });
        }
        return actions;

      case "tts-queue-empty":
        if (this.turnState === "speaking") {
          this.turnState = "listening";
          actions.push({ type: "back-to-listening" });
        }
        return actions;
    }
    return actions;
  }
}
