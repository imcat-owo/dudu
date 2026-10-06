/**
 * VoiceCallBridge — mounts the ringing overlay + active call screen.
 *
 * How a ring reaches her:
 * 1. AI calls propose_voice_call → proposal stored + ring notification.
 * 2. This bridge polls the proposal store (foreground + interval) and shows
 *    RingingOverlay for any "ringing" proposal. A notification tap just
 *    opens the app — the bridge picks it up (no deep-link surgery needed).
 * 3. Accept → acceptRing() → fullscreen VoiceCallController.
 *    Decline/timeout → logged as declined/missed, never retried.
 *
 * Incognito: ringing UI is suppressed while incognito is on (the proposal
 * will expire to "missed" — honest, like a phone). The propose tool itself
 * is already in INCOGNITO_BLOCKED_TOOLS, so no new proposal can be made
 * in an incognito session.
 */
import { useEffect, useRef, useState } from "react";
import { AppState, View } from "react-native";
import { useIncognito } from "../incognito";
import { personaStore } from "../persona/stores";
import type { Persona } from "../persona/types";
import { useColors } from "../ui";
import { acceptRing, declineRing, RingingOverlay, VoiceCallController } from "./call-ui";
import { buildCallAiAdapters, proposalStore } from "./instances";
import { expireProposal, getRingingProposal, type RingNotifier } from "./propose";
import type { CallProposal, CallStats } from "./types";

async function getNotifier(): Promise<RingNotifier> {
  const { createRingNotifier } = await import("./instances");
  return createRingNotifier().catch(
    () =>
      ({
        scheduleNotificationAsync: () => Promise.reject(new Error("no-notify")),
        cancelScheduledNotificationAsync: () => Promise.resolve(),
      }) as RingNotifier,
  );
}

interface ActiveCall {
  proposal: CallProposal;
  persona: Persona;
}

export function VoiceCallBridge() {
  const colors = useColors();
  const { incognito } = useIncognito();
  const incognitoRef = useRef(incognito);
  incognitoRef.current = incognito;
  const [ringing, setRinging] = useState<CallProposal | null>(null);
  const [active, setActive] = useState<ActiveCall | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    let alive = true;
    async function check() {
      if (!alive || busyRef.current) return;
      busyRef.current = true;
      try {
        const notify = await getNotifier();
        const now = Date.now();
        // Sweep: expire stale rings first.
        const current = await getRingingProposal(proposalStore);
        if (current) await expireProposal(proposalStore, notify, current.id, now);
        const still = await getRingingProposal(proposalStore);
        if (!alive) return;
        if (still && !incognitoRef.current) {
          setRinging((prev) => (prev?.id === still.id ? prev : still));
        } else {
          setRinging(null);
        }
      } catch {
        // best effort; never break the app
      } finally {
        busyRef.current = false;
      }
    }
    check();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void check();
    });
    const timer = setInterval(check, 5000);
    return () => {
      alive = false;
      sub.remove();
      clearInterval(timer);
    };
  }, []);

  // If incognito turns on mid-ring, hide the overlay (proposal expires → missed).
  useEffect(() => {
    if (incognito) setRinging(null);
  }, [incognito]);

  async function handleAccept() {
    const p = ringing;
    if (!p) return;
    const ok = await acceptRing(p.id);
    if (!ok) {
      setRinging(null);
      return;
    }
    try {
      const persona = await personaStore.get(p.personaId).catch(() => null);
      if (!persona) {
        // Persona vanished after ringing — decline so it doesn't hang.
        await declineRing(p.id).catch(() => {});
        setRinging(null);
        return;
      }
      // Fail fast if the call can't work (no API group) — never fake it.
      buildCallAiAdapters(persona);
      setRinging(null);
      setActive({ proposal: p, persona });
    } catch {
      // e.g. no API group: decline rather than showing a dead call screen.
      await declineRing(p.id).catch(() => {});
      setRinging(null);
    }
  }

  async function handleDecline() {
    const p = ringing;
    setRinging(null);
    if (p) await declineRing(p.id).catch(() => {});
  }

  function handleCallEnd(_stats: CallStats | null) {
    setActive(null);
  }

  if (active) {
    let adapters: ReturnType<typeof buildCallAiAdapters> | null = null;
    try {
      adapters = buildCallAiAdapters(active.persona);
    } catch {
      return null;
    }
    if (!adapters) return null;
    return (
      <View
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: colors.canvas,
          zIndex: 1000,
        }}
      >
        <VoiceCallController persona={active.persona} adapters={adapters} onEnd={handleCallEnd} />
      </View>
    );
  }

  if (ringing) {
    return (
      <RingingOverlay
        personaName={ringing.personaName}
        reason={ringing.reason}
        onAccept={() => void handleAccept()}
        onDecline={() => void handleDecline()}
      />
    );
  }

  return null;
}
