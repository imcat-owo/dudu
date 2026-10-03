/** Manual: Native App Authorizations (原生应用授权). PURE — no RN imports. */
export const NATIVE_APPS_MANUAL = {
  id: "native-apps",
  title: "Native App Authorizations (原生应用授权)",
  file: "src/manuals/native-apps.ts",
  when: "using iOS native capabilities: calendar, reminders, contacts, health data, Apple Music auth state",
  body: `# Native App Authorizations (原生应用授权)

The app's Settings has a "原生应用授权" section listing every iOS-native
capability third-party apps can request via PUBLIC API. Each shows its honest
auth state: 已授权 / 已拒绝 / 未授权 / 不可用 / 要先准备一下.

WIRED (real authorization flows, real tools):
- apple-music: surfaced from the music room (MusicKit). Don't duplicate logic.
- calendar (napp_calendar_today / napp_calendar_add): expo-calendar.
- reminders (napp_reminders_list / napp_reminder_add): expo-calendar.
- contacts (napp_contacts_search): expo-contacts.
- healthkit (napp_health_steps): react-native-health (needs dev build).

NOT WIRED YET (shown honestly, never faked):
- homekit: needs com.apple.developer.homekit entitlement + native module.
- siri: App Intents need native code; no Expo package exists.
- weather: WeatherKit needs a paid developer account + server token.
- shazam: ShazamKit needs a native module; no Expo package exists.

RULES:
- Every tool checks the iOS auth state FIRST. Not granted → the tool throws
  an honest error pointing at Settings → 原生应用授权. NEVER invent data
  (no fake events, no fake contacts, no fake step counts).
- Calendar/reminders/contacts are HER data. Read the minimum needed for the
  task at hand; don't dump her whole address book or calendar into chat.
- Health data: small honest check-ins only. You're her partner, not her doctor —
  no medical advice, no diagnosing from step counts.
- The AI authorization gateway (ask/always/never per capability) still applies
  on top of the iOS permission — her switch, always respected.
- Empty is honest: "今天日历上没安排" beats inventing a meeting.`,
};
