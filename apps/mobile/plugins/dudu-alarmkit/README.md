# DuduAlarmKit native module

iOS 26+ AlarmKit bridge for AI-set alarms. The TS side
(`src/voice/alarms.ts`) uses this when available, otherwise falls back
to scheduled notifications.

## Status

- `plugins/with-alarmkit.js` adds the `NSAlarmKitUsageDescription`.
- `DuduAlarmKit.swift` is the native module (Expo Modules API).
- **Not yet wired into the Xcode project** — adding a Swift file to the
  prebuild output requires a config-plugin `withXcodeProject` step or
  manual Xcode integration. Until then, alarms work via the
  notifications fallback (loud scheduled notification at the fire time).

## Wiring it up (for the iOS build owner)

1. Extend `with-alarmkit.js` with a `withXcodeProject` mod that adds
   `DuduAlarmKit.swift` to the app target's Sources build phase.
2. Ensure the app links `AlarmKit.framework` (weak link for iOS < 26
   compatibility — the Swift code already guards with
   `#available(iOS 26.0, *)` and `canImport(AlarmKit)`).
3. The TS side detects `NativeModulesProxy.DuduAlarmKit` automatically.

## Testing on device

1. Ask the AI: "明天 7 点叫我起床".
2. The `set_alarm` tool schedules via AlarmKit (system alarm UI) when
   the module is linked, else via notification.
3. `list_alarms` / `cancel_alarm` manage them.
