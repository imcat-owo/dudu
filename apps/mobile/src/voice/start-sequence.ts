/**
 * P1-8: guard for an async start sequence racing a stop.
 *
 * VoiceRecorderButton's startRecording() awaits permission + audio-mode +
 * prepare across several async gaps; a quick tap lands onPressOut mid-start,
 * stopRecording() early-returns (recorder not recording yet), and the start
 * continues into recorder.record() with no stop coming — mic left hot, UI
 * showing "recording", next press cycle surprise-sends a long message.
 *
 * Protocol: start calls begin() and checks isCancelled(token) after every
 * await, aborting (and releasing the audio mode) when cancelled. Stop calls
 * cancel() first, invalidating any in-flight start.
 */
export class StartSequence {
  private seq = 0;

  /** Begin an attempt; returns its token. */
  begin(): number {
    this.seq += 1;
    return this.seq;
  }

  /** Invalidate any in-flight attempt (call on stop). */
  cancel(): void {
    this.seq += 1;
  }

  /** True if the attempt holding this token was cancelled. */
  isCancelled(token: number): boolean {
    return token !== this.seq;
  }
}
