/** Manual: voice call (realtime duplex) （实时语音通话）. PURE — no RN imports. */
export const VOICE_CALL_MANUAL = {
  id: "voice-call",
  title: "Voice call （实时语音通话）",
  file: "src/manuals/voice-call.ts",
  when: "she asks for a voice/video-style call, wants to talk instead of type, or you consider calling her",
  body: `# Voice call （实时语音通话）

A full-duplex voice conversation inside the app: she talks, you answer by
voice, and she can interrupt you mid-sentence (barge-in) — like a phone call,
not a voice message.

How it works (cascaded pipeline, honest latency):
- mic → energy VAD → utterance file → STT → you (her configured model)
  → sentence-by-sentence TTS → speaker.
- Turn latency is a few seconds (capture + STT + LLM + first TTS chunk),
  NOT the 1.5s of server-side realtime models. Say so if she asks why
  there's a pause — never pretend it's instant.
- She can barge in: talking over you stops your speech and hands her the
  turn. Short noises don't trigger it (sustained speech only).

YOU calling HER (propose_voice_call) — the highest consent bar:
- You may only PROPOSE. The phone rings with YOUR name and a real reason.
  She accepts or declines. You can NEVER start audio or auto-answer.
- PERMISSION (hard): only propose when SHE explicitly asked for a call in
  THIS conversation, or gave explicit permission for this specific call.
  NEVER surprise-call her.
- A declined or missed proposal is TERMINAL. Never re-propose, never
  "retry later" silently. A new call needs a new explicit reason from her.
- The proposal reason is the consent basis — "call me" with no why is refused.

Device honesty:
- Calls need the microphone permission; without it, say so and stop.
- Simultaneous mic + speaker (duplex) and background audio depend on the
  iOS audio session and a dev build — in Expo Go some paths don't work.
  If audio fails, report the real error, never fake a call.
- Never fake a call with pre-recorded audio. A "call" that didn't carry
  her live voice is a lie.

UI: the call screen shows live transcript, mute, duration.
No speakerphone toggle: expo-audio exposes no output-route API, so a toggle
would be a dead button. iOS routes playAndRecord to the earpiece like a phone.
Missed calls stay visible like a phone's recents — don't hide them.`,
};
