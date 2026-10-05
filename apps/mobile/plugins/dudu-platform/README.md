# Dudu platform native modules (Batch 6 — H)

iOS system integrations. The TS side (`src/platform/`) is complete;
Swift files are either wired automatically at prebuild (via a config
plugin in `plugins/`) or documented below as reference implementations
needing Xcode wiring. Nothing here is faked — unwired modules report
unavailable and the TS side degrades honestly.

## Modules

| Module | Dir | H item | Type |
|---|---|---|---|
| DuduSharedData | shared/ | H2/H5/H7 | Expo module (app target) |
| DuduShareViewController | share/ | H2 | App Extension target |
| DuduIntents | siri/ | H4 | AppIntent (app target, auto-wired by with-siri-intents.js) |
| DuduWidget | widget/ | H5/H6 | Widget Extension target |
| DuduLiveActivity | liveactivity/ | H6 | Expo module (app target) |
| DuduFileProvider | fileprovider/ | H7 | File Provider extension target |
| DuduHomeKit | homekit/ | H10 | Expo module (app target) |
| DuduNLP | nlp/ | H11 | Expo module (app target) |

H8 (Face ID) needs NO native code — it's fully implemented in TS via
`expo-local-authentication` (added to package.json).

## Wiring (for the iOS build owner)

### Expo modules (shared, liveactivity, homekit, nlp)
1. Add the `.swift` files to the app target's Sources build phase
   (via a config-plugin `withXcodeProject` mod, or manually in Xcode).
2. They use the Expo Modules API — autolinked, no extra setup.
3. Entitlements:
   - HomeKit: `com.apple.developer.homekit` = YES.

### Share Extension (H2)
1. New target: App Extension → Share Extension, name `DuduShare`.
2. Add `DuduShareViewController.swift`; set it as the principal class.
3. App Group capability: `group.app.dudu.mobile` (app + extension).
4. Info.plist: `NSExtensionActivationRule` — accept text, URLs, images, files.
5. The extension saves to the App Group and opens `dudu://share`;
   the app reads it via `takePendingShare()`.

### Widget Extension (H5/H6)
1. New target: Widget Extension, name `DuduWidget`.
2. Add `DuduWidget.swift` (contains both the static widget and the
   Live Activity widget).
3. App Group capability: `group.app.dudu.mobile`.
4. TS side pushes data via `pushWidgetData()`; call `reloadTimelines`
   after pushing (the TS side does this when `DuduWidget` module exists,
   otherwise the widget refreshes on its 15-min timeline).

### File Provider (H7)
1. New target: File Provider Extension, name `DuduFileProvider`.
2. Add `DuduFileProvider.swift`.
3. App Group capability: `group.app.dudu.mobile`.
4. Files written via `publishToFilesApp()` appear in the Files app.

### Siri Intents (H4)
1. Automatic: `plugins/with-siri-intents.js` (registered in `app.json`) copies
   `DuduIntents.swift` into the generated iOS project and adds it to the app
   target's Sources at prebuild. No manual Xcode step.
2. AppIntents needs no entitlement and no user authorization — the three
   intents (Ask Dudu / Open conversation / New chat) appear in the Shortcuts
   app as soon as the app is installed; she adds them there and can then
   invoke them via Siri.
3. The intents deep-link (`dudu://siri?...`); the app routes via
   `parseSiriLink()` in `src/platform/siri-shortcuts.ts`.
4. Register the `dudu` URL scheme if not already present.

## Testing on device
- H2: Share a photo from Photos → Dudu → app opens with the share ready.
- H4: "Hey Siri, ask Dudu…" → Shortcuts shows the three intents.
- H5: Add the Dudu widget → task progress appears.
- H6: Start a long AI task → Live Activity on Lock Screen / Island.
- H7: Publish a file → appears in Files.app under Dudu.
- H8: Enable app lock in settings → Face ID on launch.
- H10: "Turn off the bedroom light" → HomeKit permission → accessory toggles.
- H11: No UI — used internally for language/sentiment heuristics.
