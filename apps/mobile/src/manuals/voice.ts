/** Manual: voice — TTS, STT, voice messages. PURE — no RN imports. */
export const VOICE_MANUAL = {
  id: "voice",
  title: "Voice: TTS, STT, voice messages",
  file: "src/manuals/voice.ts",
  when: "voice playback, speech-to-text, or voice settings questions",
  body: `# Voice: TTS, STT, voice messages

- TTS default is edge-tts (free, no key needed). Custom TTS: she fills in
  URL + key + model name herself (OpenAI-compatible); the key lives in
  SecureStore and never in the repo.
- Voice settings screen (voice/voice-settings.tsx): pick voice, test button
  plays synthesized speech immediately — hearing it IS the test.
- STT: microphone records, transcription lands in the input box where she
  can edit before sending.
- AI chat bubbles have a speak button: TTS reads that message aloud.
- Thinking content is NEVER read aloud.

Rules:
- If TTS/STT is not configured, fail loudly with a human message —
  never silently skip speaking or transcribing.
- Test keys are burn-after-use. Production keys are hers alone; never ask
  for them in chat and never store them anywhere but SecureStore.`,
};
