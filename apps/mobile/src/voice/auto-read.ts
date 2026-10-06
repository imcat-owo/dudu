/**
 * Auto-read: play each finished AI reply aloud when the user opts in.
 *
 * Kelivo does this with a `ttsAutoPlayAssistantReplies` toggle: when an
 * assistant message finishes streaming, it speaks the text. Ours follows
 * the same shape.
 *
 * PURE-ish module: expo-audio is loaded lazily so the logic stays
 * importable in plain node tests. The chat layer (chat.tsx) calls
 * `maybeAutoReadAssistantMessage` when an assistant message finishes;
 * this module owns the setting check, synthesis, playback, and
 * interruption.
 */

import { resolveSpeakEmotion, type VoiceEmotion } from "./emotion";
import type { TtsConfig, VoiceSettings } from "./types";

export interface AudioPlayerLike {
  play(): void;
  pause(): void;
  remove(): void;
  addListener(
    event: "playbackStatusUpdate",
    cb: (status: { isLoaded: boolean; didJustFinish?: boolean }) => void,
  ): { remove(): void };
}

export interface AutoReadDeps {
  getSettings: () => VoiceSettings;
  getTtsConfig: () => TtsConfig;
  synthesize: (
    text: string,
    cfg: TtsConfig,
    opts?: { emotion?: VoiceEmotion | null },
  ) => Promise<string>;
  createPlayer: (uri: string) => AudioPlayerLike;
  setAudioMode: (mode: { playsInSilentMode: boolean }) => Promise<void>;
  /**
   * D35: called when TTS synthesis fails. Without this the failure was
   * swallowed (`catch { return false }`) and she never knew why nothing
   * played. The caller decides how to make it visible (chat shows a
   * transient error notice).
   */
  onError?: (error: string) => void;
}

let currentPlayer: AudioPlayerLike | null = null;
let currentListener: { remove(): void } | null = null;
let autoReadToken = 0;

function releaseCurrent() {
  try {
    currentListener?.remove();
  } catch {
    // already released
  }
  currentListener = null;
  try {
    currentPlayer?.pause();
    currentPlayer?.remove();
  } catch {
    // already released
  }
  currentPlayer = null;
}

/** Stop any in-flight auto-read (user sent a new message, navigated away…). */
export function stopAutoRead() {
  autoReadToken++;
  releaseCurrent();
}

/**
 * Maybe speak a finished assistant message. No-op when auto-read is off,
 * when the text is empty, or when a newer auto-read superseded this one.
 * Returns true when playback started.
 *
 * INTEGRATION (chat.tsx): call this when an assistant message finishes
 * streaming, passing the message text. Call `stopAutoRead()` when the
 * user sends a new message or leaves the dialog.
 */
export async function maybeAutoReadAssistantMessage(
  text: string,
  deps: AutoReadDeps,
): Promise<boolean> {
  const settings = deps.getSettings();
  if (!settings.autoRead) return false;
  const clean = text.trim();
  if (!clean) return false;
  const token = ++autoReadToken;
  // A newer message cancels this one — never talk over the latest reply.
  releaseCurrent();
  // Emotional TTS: the reply is read in the tone its words carry (or her
  // pinned tone). Off → null → the old flat voice.
  const emotion = resolveSpeakEmotion(clean, {
    emotionalTts: settings.emotionalTts ?? true,
    emotionPin: settings.emotionPin ?? null,
  });
  let uri: string;
  try {
    uri = await deps.synthesize(clean, deps.getTtsConfig(), { emotion });
  } catch (e) {
    // D35: never swallow a synthesis failure — tell the caller so the
    // UI can show it instead of silently not playing anything.
    deps.onError?.(e instanceof Error ? e.message : String(e));
    return false;
  }
  if (token !== autoReadToken) return false;
  try {
    await deps.setAudioMode({ playsInSilentMode: true });
  } catch {
    // non-fatal
  }
  if (token !== autoReadToken) return false;
  const player = deps.createPlayer(uri);
  currentPlayer = player;
  currentListener = player.addListener("playbackStatusUpdate", (status) => {
    if (!status.isLoaded) return;
    if (status.didJustFinish && token === autoReadToken) {
      releaseCurrent();
    }
  });
  player.play();
  return true;
}

/** Test hook: reset module state. */
export function __resetAutoReadForTests() {
  autoReadToken = 0;
  releaseCurrent();
}
