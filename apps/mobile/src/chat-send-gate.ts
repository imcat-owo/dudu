/**
 * Send-affordance gate (pure, testable).
 *
 * P1-6: the send button's enabled state must match send()'s gate exactly.
 * Attachments with no text are a supported send, so they enable the button.
 * Keep this in sync with the early-return in chat.tsx's send().
 */
export interface SendGateInput {
  /** Raw draft text (untrimmed is fine). */
  text: string;
  imageCount: number;
  fileCount: number;
  loaded: boolean;
  isReady: boolean;
  /** When true the button is the Stop control, always enabled. */
  replying: boolean;
}

export function computeCanSend(input: SendGateInput): boolean {
  if (input.replying) return true;
  const hasContent = input.text.trim().length > 0 || input.imageCount > 0 || input.fileCount > 0;
  return hasContent && input.loaded && input.isReady;
}
