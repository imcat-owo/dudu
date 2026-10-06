/**
 * AI-initiated voice calls: propose → ring → accept / decline.
 *
 * Consent design (her authorization model — a call is the most intrusive
 * proactive act, so it gets the highest bar):
 * - The AI may only PROPOSE. It can never auto-start audio or auto-answer.
 * - The proposal carries WHO (persona) and WHY (reason) — the consent basis.
 * - Ringing = a local notification + an in-app ringing screen if foreground.
 * - She taps Accept → the call screen opens and the session starts.
 *   She taps Decline (or it times out) → logged as declined/missed and the
 *   proposal is NEVER silently retried. A new proposal needs a new decision.
 * - Missed-call entry stays visible in the call UI (honest, like a phone).
 *
 * PURE logic with injected store + notify ports (same shape as outreach).
 */
import type { CallProposal, ProposalStatus } from "./types";

export interface ProposalStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface RingNotifier {
  scheduleNotificationAsync(request: {
    identifier: string;
    content: { title: string; body: string; data?: Record<string, string> };
    trigger: { seconds: number };
  }): Promise<string>;
  cancelScheduledNotificationAsync(identifier: string): Promise<void>;
}

const PROPOSALS_KEY = "dudu.voice-call.v1.proposals";
const MAX_PROPOSALS = 30;

/** A proposal rings for this long, then becomes "missed". */
export const RING_TIMEOUT_MS = 60_000;

export function ringNotificationId(proposalId: string): string {
  return `dudu-call-ring-${proposalId}`;
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export async function listProposals(store: ProposalStore): Promise<CallProposal[]> {
  try {
    const raw = await store.getItem(PROPOSALS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? (arr as CallProposal[]) : [];
  } catch {
    return [];
  }
}

async function saveProposals(store: ProposalStore, list: CallProposal[]): Promise<void> {
  await store.setItem(PROPOSALS_KEY, JSON.stringify(list.slice(0, MAX_PROPOSALS)));
}

export interface ProposeInput {
  personaId: string;
  personaName: string;
  reason: string;
  topic?: string;
  nowMs?: () => number;
}

/**
 * Create a proposal and start ringing. Returns the proposal.
 * Throws on empty reason — "call me" with no why is not allowed.
 */
export async function proposeCall(
  store: ProposalStore,
  notify: RingNotifier,
  input: ProposeInput,
): Promise<CallProposal> {
  const reason = input.reason.trim();
  if (!reason) throw new Error("A call proposal needs a reason — she decides based on the why.");
  const now = (input.nowMs ?? Date.now)();
  const proposal: CallProposal = {
    id: uid(),
    personaId: input.personaId,
    personaName: input.personaName,
    reason,
    topic: input.topic?.trim() || undefined,
    createdAt: now,
    status: "ringing",
  };
  const list = await listProposals(store);
  await saveProposals(store, [proposal, ...list]);
  await notify
    .scheduleNotificationAsync({
      identifier: ringNotificationId(proposal.id),
      content: {
        title: input.personaName,
        body: reason,
        data: { kind: "voice-call-ring", proposalId: proposal.id },
      },
      trigger: { seconds: 1 },
    })
    .catch(() => {
      // Ring notification is best-effort; the in-app ringing screen is primary.
    });
  return proposal;
}

async function setStatus(
  store: ProposalStore,
  notify: RingNotifier,
  id: string,
  status: ProposalStatus,
): Promise<CallProposal | null> {
  const list = await listProposals(store);
  const found = list.find((p) => p.id === id);
  if (found?.status !== "ringing") return null;
  found.status = status;
  await saveProposals(store, list);
  await notify.cancelScheduledNotificationAsync(ringNotificationId(id)).catch(() => {});
  return found;
}

/** She accepted → the call may start. Only from "ringing". */
export function acceptProposal(
  store: ProposalStore,
  notify: RingNotifier,
  id: string,
): Promise<CallProposal | null> {
  return setStatus(store, notify, id, "accepted");
}

/**
 * She declined → logged, never retried. A declined proposal is terminal:
 * the AI must make a NEW proposal (new decision) to ring again.
 */
export function declineProposal(
  store: ProposalStore,
  notify: RingNotifier,
  id: string,
): Promise<CallProposal | null> {
  return setStatus(store, notify, id, "declined");
}

/** Ring timed out with no answer → "missed" (visible, like a phone). */
export async function expireProposal(
  store: ProposalStore,
  notify: RingNotifier,
  id: string,
  nowMs: number = Date.now(),
): Promise<CallProposal | null> {
  const list = await listProposals(store);
  const found = list.find((p) => p.id === id);
  if (found?.status !== "ringing") return null;
  if (nowMs - found.createdAt < RING_TIMEOUT_MS) return null;
  return setStatus(store, notify, id, "missed");
}

/** The currently ringing proposal, if any. */
export async function getRingingProposal(store: ProposalStore): Promise<CallProposal | null> {
  const list = await listProposals(store);
  return list.find((p) => p.status === "ringing") ?? null;
}
