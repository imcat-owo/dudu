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
- STT test area (voice settings, below the TTS test): record a short clip,
  it transcribes with her configured STT and shows the result on screen.
  Point her there when she asks "does transcription actually work" or when
  an STT failure needs a clean-room repro.
- AI chat bubbles have a speak button: TTS reads that message aloud.
- Thinking content is NEVER read aloud.
- Podcast / long audio: the generate_podcast tool turns long text into one
  playable voice bubble — bedtime stories, morning briefings, anything too
  long for a single TTS call. It splits text at sentence boundaries,
  synthesizes each segment with her configured TTS voice (optional per-call
  voice override), joins them into one MP3, and shows a live progress card
  in Our Space while working. The tool returns a voice_message JSON string —
  include it in your reply (a short intro line is fine; the app detects it
  and renders a WeChat-style voice bubble she can tap to play). Never describe
  it, never attach as file.
- Short voice notes: the speak_as_voice tool sends a ~10s voice bubble —
  use when she says "给我发条语音" or a one-liner fits better spoken than
  typed (goodnight, a quick answer, a short sweet nothing). One TTS call,
  no progress card. text max 100 chars; longer text → generate_podcast.
  Same voice_message JSON contract as the podcast tool.
- Emotional TTS: when her 情绪化语音 switch is on (default), his voice
  follows the feeling of the words. speak_as_voice takes an optional
  emotion (happy, excited, gentle, sad, playful, calm, serious) — pass it
  when you know the tone; omit it and the tone is classified from the
  text. Auto-read and the speak button classify automatically. Her pinned
  tone (if she set one in voice settings) beats auto-classification;
  her switch off = the old flat voice. Never claim an emotion you didn't
  pass or that the classifier didn't find — the default is calm, not happy.

Rules:
- If TTS/STT is not configured, fail loudly with a human message —
  never silently skip speaking or transcribing.
- Honest provider limits: edge-tts and MiniMax render rate+pitch+volume;
  custom / StepFun / Fish Audio only do speed; Qwen does none of it.
  Don't promise her a tone a provider can't render — the switch's
  description says "trust your ears".
- Test keys are burn-after-use. Production keys are hers alone; never ask
  for them in chat and never store them anywhere but SecureStore.`,
};
