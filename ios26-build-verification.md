# iOS 26 Build Verification — OpenMuse (Expo SDK 54)

**Stream 3, Phase 0 — research + report only. No source code was modified.**
Date: 2026-10-03. Author: worker subagent (stream 3).

## 0. Verdicts up front

| Question | Verdict |
|---|---|
| Does `macos-latest` currently provide Xcode with the iOS 26 SDK? | **Yes.** `macos-latest` = `macos-26-arm64` image `20260907.0351.1`; default Xcode **26.6** (build 17F113) ships **iOS 26.5 SDK** (`iphoneos26.5`). |
| Is the unsigned-IPA pipeline sound? | **Yes, with two fixes recommended.** The `xcodebuild` unsigned invocation + manual `Payload/` zip is the correct approach. Main risks: no Xcode pin (runner drift), `--no-frozen-lockfile` + `pod install --repo-update` make builds non-deterministic. |
| Any app.json/config changes required for iOS 26? | **None required.** Expo SDK 54 min deployment target is iOS 15.1; the app builds against the iOS 26.5 SDK. Privacy keys already present. No `UIBackgroundModes` needed for the current feature set. |
| expo-av → expo-audio migration | **Plan ready below.** Only 2 files use expo-av (`voice-message.tsx`, `device-permissions.ts`). Recommended expo-audio version for SDK 54: `~1.1.1`. |

---

## 1. Xcode version + iOS 26 SDK status on `macos-latest`

### 1.1 Current state (verified 2026-10-03)

`macos-latest` currently resolves to the **`macos-26-arm64`** runner image, version
**`20260907.0351.1`** (macOS 26.6.2 Tahoe), whose **default Xcode is 26.6** (build `17F113`).
It ships the **iOS 26.5 SDK** (`iphoneos26.5`) plus simulator runtimes for iOS 26.0–26.5.
Side-by-side installs: Xcode 26.5, 26.4.1, 26.3, 26.2, 26.1.1, 26.0.1.

Sources:
- Runner image README (actions/runner-images, read via mirror; image version and
  Xcode/SDK tables are generated from the image itself):
  https://github.com/github-maccloud/runner-images/blob/HEAD/images/macos/macos-26-arm64-Readme.md
  (Xcode table lines ~271-289; SDK table lines ~291-325; announcement "Default Xcode on
  macOS 26 Tahoe will be set to Xcode 26.6 on 2026.07.21").
- Independent confirmation that `macos-latest` = `macos-26-arm64` image `20260907.0351.1`
  with Xcode 26.6 default and iOS 26.4 SDKs, in a PR merged ~7 days ago:
  https://github.com/GitLiveApp/firebase-kotlin-sdk/pull/910
- Independent confirmation (13 days ago) that the `macos-26-arm64` readme lists
  "Xcode 26.6 (default), 26.5, 26.4.1, 26.3, 26.2, 26.1.1 and 26.0.1 — no 27":
  https://github.com/appandflow/stim/pull/870
- Xcode 27 exists only on the separate `xcode-27` preview image label
  (actions/runner-images#14404), not on `macos-latest` — so no surprise major-version
  jump is imminent on the current label.

### 1.2 Caveats and drift notes

- The default Xcode on `macos-latest` has drifted before. In May 2026 (`macos-15` era)
  the default was Xcode 16.4 (iOS 18.5 SDK), which broke App Store uploads after Apple
  started requiring the iOS 26 SDK (ITMS-90725, enforced from 2026-04-28):
  https://github.com/actions/runner-images/issues/14165
  Today that issue is moot on `macos-latest` (Xcode 26.6 default), but the lesson stands:
  **never rely on the default.**
- Unsigned/self-signed distribution does not go through App Store Connect, so
  ITMS-90725 does not apply to this pipeline — but building with the iOS 26 SDK is
  still what we want, and we get it today.

### 1.3 How to pin if `macos-latest` ever drifts

Recommended (in order of preference):

1. **Pin the Xcode explicitly** at the top of the job (before `pod install`):
   ```yaml
   - name: Select Xcode 26.6
     run: sudo xcode-select -s /Applications/Xcode_26.6.app
   ```
   or the `maxim-lobanov/setup-xcode@v1` action with `xcode-version: "26.6"`.
   Add a diagnostic step `xcodebuild -version && xcodebuild -showsdks | grep iphoneos`
   so a future drift fails loudly instead of silently moving the toolchain.
2. **Pin the runner image label**: `runs-on: macos-26` instead of `macos-latest`.
   Note `macos-26` also floats across image revisions; combining (1)+(2) is safest.
   (Pattern seen in the wild: https://github.com/cemililik/markdown-viewer-mobile/commit/b61d03d024d4812b7c542d4145b34fc8046ad914)

---

## 2. Pipeline soundness — `.github/workflows/build-ios.yml`

Read in full. Line references below are to that file.

### 2.1 What is correct

- **Unsigned build approach is right** (lines 47-58): `xcodebuild` with the `build`
  action (not `archive`), `-sdk iphoneos`, and
  `CODE_SIGN_IDENTITY="" CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=NO` is the
  standard way to produce an unsigned `.app`. No `exportOptions.plist` /
  `-exportArchive` is involved — correct, because `xcodebuild -exportArchive`
  requires a signing identity even for ad-hoc exports.
- **Manual IPA packaging is right** (lines 60-69): `Payload/<App>.app` + `zip` is the
  canonical unsigned-IPA layout. No signing step is sneaked in.
- **Prebuild-then-pods order is right** (lines 37-45): `expo prebuild --clean`
  regenerates `ios/` (which is not tracked in git — verified via `git ls-files`),
  then `pod install` installs native deps into the fresh project.
- **Toolchain versions resolve** (lines 26-31): Node 24 via `setup-node@v4`;
  `pnpm/action-setup@v4` with no version input resolves pnpm from the root
  `package.json` `"packageManager": "pnpm@11.19.0"` field (verified present) —
  this is the documented behavior of pnpm/action-setup, so it will not fail.
- **Monorepo install step is right** (line 34): `working-directory: .` overrides the
  job default (`apps/mobile`) so `pnpm install` runs at the repo root, matching
  `pnpm-workspace.yaml` (`packages: [apps/mobile, apps/worker]` — verified).
- **Hygiene**: `permissions: contents: read` (minimal), `timeout-minutes: 90`
  (sane), artifact `retention-days: 14` (sane), trigger scoped to
  `apps/mobile/**` + the workflow file itself.

### 2.2 Findings (ordered by importance)

**F1 — No Xcode selection / pin (medium).** Nothing in the workflow selects or asserts
the Xcode version; the build silently follows whatever `macos-latest` defaults to.
Today that is Xcode 26.6 / iOS 26.5 SDK (good), but per §1.2 the default has drifted
within the last year. For a pipeline whose whole job is producing a device-installable
binary, this should be explicit. Fix: add the §1.3 pin + a `xcodebuild -version` /
`-showsdks` diagnostic step.

**F2 — Non-deterministic dependency resolution (medium).**
Line 34: `pnpm install --no-frozen-lockfile`, while a root `pnpm-lock.yaml`
(511 KB, committed) exists. This lets CI resolve newer versions than the lockfile,
so a green build today can differ from a green build tomorrow, and it masks
lockfile drift instead of surfacing it. Line 45: `pod install --repo-update` hits
the CocoaPods CDN on every run and adds minutes + a network failure mode.
Fix: use `pnpm install --frozen-lockfile` (fails fast if the lockfile is stale —
that is the point) and plain `pod install` (respects `Podfile.lock`), plus add a
pnpm-store cache step (`actions/cache` on `pnpm store path`) to recover the speed.

**F3 — Brittle artifact glob (low).** Line 63: `APP=$(ls -d *.app | head -1)` picks
an arbitrary `.app` if more than one ever lands in `Release-iphoneos`. Prefer the
explicit name: `APP="OpenMuse.app"` with a `[ -d "$APP" ]` guard that fails the
step with a clear message.

**F4 — No caching (low, performance only).** No pnpm store, CocoaPods, or
DerivedData caching. Correctness unaffected; each run pays full install + full
native compile. Address together with F2.

**F5 — No build-failure diagnostics (low).** If `xcodebuild` fails, the raw log is
the only artifact. Consider piping through `xcbeautify` (preinstalled on the
runner) or uploading `ios/build/Logs` on failure. Optional.

### 2.3 Failure modes to keep in mind

- If a future Xcode major (27) becomes default on `macos-latest`, `-sdk iphoneos`
  still resolves, but RN 0.81's native code may not compile under it — F1's pin is
  the mitigation.
- `--repo-update` failing (CDN outage) fails the whole job — F2's plain
  `pod install` removes that dependency.
- `expo prebuild --clean` wipes `ios/` every run, so any hand-edit to the native
  project that isn't expressed via a config plugin is silently discarded. Verified
  `ios/` is untracked in git, so this is currently safe by construction — keep it
  that way (all native config must live in `app.json` plugins).

### 2.4 Overall verdict

**Sound for its purpose.** The unsigned path (no export, no signing identity,
manual Payload zip) is correctly implemented. The two changes worth making are
F1 (pin Xcode 26.6) and F2 (frozen lockfile + plain pod install + cache). Neither
blocks the next build.

---

## 3. iOS deployment target + iOS 26 config story

### 3.1 Deployment target

- Expo SDK 54's minimum iOS deployment target is **iOS 15.1**
  (sources: https://github.com/pvhao2002/kira-app/blob/HEAD/.cursor/skills/react-native-expo-sdk52-plus/SKILL.md
  citing the official SDK 54 changelog; corroborated by
  https://github.com/amehmeto/tiedsiren/blob/HEAD/docs/tech-debt/expo-sdk-54-upgrade.md
  "Minimum iOS: 14.0 → 15.1").
- The app sets no custom deployment target in `app.json` (verified — read in full),
  so it inherits Expo's default (15.1).
- Target devices are iOS 26 phones. Building with the iOS 26.5 SDK while deploying
  back to 15.1 is fully supported. **No change needed.**

### 3.2 app.json review (read in full) — nothing missing for iOS 26

| Check | Status |
|---|---|
| `NSMicrophoneUsageDescription` | ✅ present (voice recording) |
| `NSPhotoLibraryUsageDescription` | ✅ present (`expo-media-library` read) |
| `NSLocationWhenInUseUsageDescription` | ✅ present; matches `expo-location` foreground-only usage (`requestForegroundPermissionsAsync` / `getCurrentPositionAsync` in `device-permissions.ts`) |
| `NSBluetoothAlwaysUsageDescription` + `NSBluetoothPeripheralUsageDescription` | ✅ present (declared; BLE module not bundled yet — `checkBluetoothAvailable()` returns false, so the keys are dormant) |
| `UIBackgroundModes` | ✅ correctly **absent** — recording and playback are foreground-only (hold-to-record button, tap-to-play bubbles). No background audio entitlement needed. If background playback/recording is ever wanted, add `"UIBackgroundModes": ["audio"]` to `ios.infoPlist` (per expo-audio docs). |
| Privacy manifests | ✅ no action — Expo SDK 54 modules ship their own privacy manifests; prebuild merges them. |
| `newArchEnabled: true` | ✅ set; matches RN 0.81 new-arch requirement. |
| `expo-notifications` plugin | ✅ present in plugins list. |
| `supportsTablet: true`, bundle id, scheme | ✅ sane. |

**One migration-related config note:** `app.json` lists `"expo-av"` in `plugins`
(line ~33 of app.json). On migration (§4) this entry must become `"expo-audio"`.
The `NSMicrophoneUsageDescription` key is already set manually in `infoPlist`,
so expo-audio's `microphonePermission` plugin option is not needed — a bare
`"expo-audio"` plugin entry suffices. (expo-audio config plugin docs:
https://docs.expo.dev/versions/v54.0.0/sdk/audio/ — "Configuration in app config".)

---

## 4. expo-av → expo-audio migration plan (PLAN ONLY — not implemented)

### 4.1 Scope (verified by grep)

Only two files import `expo-av`, both `import { Audio } from "expo-av"`:

- `apps/mobile/src/voice-message.tsx:1` — playback (`Audio.Sound.createAsync`,
  `Audio.setAudioModeAsync`) in `VoiceBubble`/`createSound`, and recording
  (`Audio.requestPermissionsAsync`, `Audio.setAudioModeAsync`,
  `new Audio.Recording()`, `Audio.RecordingOptionsPresets.HIGH_QUALITY`) in
  `VoiceRecorderButton`.
- `apps/mobile/src/device-permissions.ts:1` — `Audio.requestPermissionsAsync()` and
  `Audio.getPermissionsAsync()` in `requestAudioPermission` /
  `checkAudioPermission`.

expo-av is deprecated by Expo in favor of expo-audio (the expo-audio docs carry an
explicit "If you're migrating from expo-av…" note). Recommended version for
SDK 54: **`expo-audio@~1.1.1`** (docs header). All API facts below are from
https://docs.expo.dev/versions/v54.0.0/sdk/audio/ (read in full, 2442 lines).

### 4.2 API mapping (verified against docs)

| expo-av (current) | expo-audio (target) | Notes |
|---|---|---|
| `Audio.setAudioModeAsync({ playsInSilentModeIOS: true, allowsRecordingIOS: false })` | `setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false })` | iOS suffixes dropped from key names; otherwise same semantics (docs "AudioMode" table). `setAudioModeAsync` takes `Partial<AudioMode>` — unspecified keys are left untouched. |
| `Audio.requestPermissionsAsync()` | `requestRecordingPermissionsAsync()` | Top-level export (also on `Audio` namespace). Returns `PermissionResponse` with `status`/`granted` — same shape the code already destructures. **Name change is semantic: it is recording permission only.** |
| `Audio.getPermissionsAsync()` | `getRecordingPermissionsAsync()` | Same. |
| `Audio.Sound.createAsync({uri}, { shouldPlay: false, progressUpdateIntervalMillis: 200 })` | `createAudioPlayer(uri, { updateInterval: 200 })` | `progressUpdateIntervalMillis` → `updateInterval` (ms, default 500). Source can be a plain URI string (`AudioSource`). |
| `sound.setOnPlaybackStatusUpdate(cb)` with `{isLoaded, isPlaying, positionMillis, didJustFinish}` | `player.addListener('playbackStatusUpdate', cb)` with `AudioStatus {isLoaded, playing, currentTime /*seconds*/, didJustFinish, duration /*seconds*/}` | Event name is `playbackStatusUpdate` (AudioEvents table). Field renames: `isPlaying`→`playing`, `positionMillis`→`currentTime` (now **seconds**, not ms). `didJustFinish` still exists. |
| `sound.playAsync() / pauseAsync() / unloadAsync() / getStatusAsync()` | `player.play() / pause() / remove()` | Methods are **synchronous void** now — no promises. `getStatusAsync()` is gone; use `useAudioPlayerStatus(player)` hook or read props (`player.playing`, `player.currentTime`, `player.isLoaded`) directly. Cleanup is `remove()`, **not** `release()` — the docs prose says `release()` but the method table lists `remove()`; verify against installed `.d.ts` at migration time. |
| `new Audio.Recording()` + `prepareToRecordAsync(preset)` + `startAsync()` + `stopAndUnloadAsync()` + `getURI()` | `useAudioRecorder(RecordingPresets.HIGH_QUALITY)` hook + `prepareToRecordAsync()` + `record()` + `stop()`; result on `recorder.uri` | The hook auto-prepares/disposes with component lifecycle. `record()`/`stop()` are sync void. `recorder.uri` is `string \| null`. **There is no `createAudioRecorder` in expo-audio** (confirmed via community reports of this exact pitfall) — the hook (or the `AudioModule.AudioRecorder` class) is the way; the hook fits `VoiceRecorderButton` since it is already a component. |
| `Audio.RecordingOptionsPresets.HIGH_QUALITY` | `RecordingPresets.HIGH_QUALITY` | Same name, same values (`.m4a`, 44100 Hz, stereo, 128 kbps, iOS `MPEG4AAC`) — recorded files stay format-compatible. |

### 4.3 Behavioral differences to watch

1. **No auto-rewind on finish.** expo-audio "doesn't automatically reset the playback
   position when audio finishes… the player stays paused at the end. To play it
   again, call `seekTo(0)`" (docs, Playing-sounds section). The current bubble
   resets `position` to 0 on `didJustFinish` and replay works because expo-av
   restarts from 0. After migration, the toggle handler must call
   `player.seekTo(0)` before `player.play()` when `didJustFinish`/at-end, or
   replay will appear to do nothing.
2. **Sync player/recorder methods.** `play()`, `pause()`, `record()`, `stop()`
   return `void`, not promises. `await`ing them is harmless but the `try/catch`
   around them will no longer catch async native failures the same way — keep the
   try/catch (it still catches sync throws) and rely on status listeners for the rest.
3. **Status polling cadence.** The bubble currently uses 200 ms updates; the
   equivalent is `updateInterval: 200` in `createAudioPlayer` options. Default is
   500 ms — pass it explicitly to keep the waveform progress smooth.
4. **Recording duration source.** Current code deliberately uses wall-clock time
   ("getStatusAsync is unreliable after unload"). expo-audio offers
   `useAudioRecorderState(recorder)` → `durationMillis` (polled, default 500 ms)
   or `recorder.currentTime` (seconds, live property). Either is cleaner than the
   wall-clock hack; keep wall-clock as fallback only if the state value proves
   jumpy during testing.
5. **Audio mode is global and partial.** `setAudioModeAsync` merges — the current
   pattern of toggling `allowsRecording: true/false` around a recording session
   ports directly (`{ allowsRecording: true, playsInSilentMode: true }` before,
   `{ allowsRecording: false }` after). Note: with `allowsRecording: true` the
   iOS session category changes, which can reroute audio; test the
   record-then-immediate-playback transition on device.
6. **Interruption behavior.** Default `interruptionMode` behavior may differ from
   expo-av's defaults; if voice bubbles should duck rather than pause background
   music (or vice versa), set `interruptionMode` explicitly
   (`'mixWithOthers'` / `'doNotMix'` / `'duckOthers'`).
7. **Background audio.** Neither lib plays in background without
   `UIBackgroundModes: ["audio"]` + `shouldPlayInBackground: true`. Current app
   doesn't need it; don't add it.
8. **Headphone disconnect.** expo-audio docs note "audio automatically stops if
   headphones/bluetooth audio devices are disconnected" — same as before, no
   action.

### 4.4 Ordered change list

1. `apps/mobile/package.json`: replace `"expo-av": "15.1.1"` with
   `"expo-audio": "~1.1.1"` (recommended for SDK 54). Run `pnpm install`
   (`npx expo install expo-audio` equivalent).
2. `apps/mobile/app.json`: plugins — replace `"expo-av"` with `"expo-audio"`.
   Keep the manual `NSMicrophoneUsageDescription` in `infoPlist` (no plugin
   options needed).
3. `apps/mobile/src/device-permissions.ts`:
   `import { Audio } from "expo-av"` →
   `import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from "expo-audio"`;
   `requestAudioPermission` uses `requestRecordingPermissionsAsync()`,
   `checkAudioPermission` uses `getRecordingPermissionsAsync()`. `normalize()`
   unchanged (`status` strings are identical: `granted`/`denied`/`undetermined`).
4. `apps/mobile/src/voice-message.tsx` — `VoiceBubble`/`createSound`:
   replace with `createAudioPlayer(voice.uri, { updateInterval: 200 })`;
   `setAudioModeAsync({ playsInSilentMode: true })` (dropped `IOS` suffix);
   status via `player.addListener('playbackStatusUpdate', …)` mapping
   `isPlaying→playing`, `positionMillis/1000→currentTime`;
   `play()/pause()` sync; cleanup `player.remove()` on unmount;
   add `seekTo(0)` before replay-after-finish (difference #1).
   Delete the `SoundLike` structural-type shim — real types exist now.
5. `apps/mobile/src/voice-message.tsx` — `VoiceRecorderButton`:
   `const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY)`;
   `startRecording`: `requestRecordingPermissionsAsync()` →
   `setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })` →
   `await recorder.prepareToRecordAsync()` → `recorder.record()`;
   `stopRecording`: `await recorder.stop()` → read `recorder.uri`;
   duration from `useAudioRecorderState`/`recorder.currentTime` (difference #4);
   drop the manual `stopAndUnloadAsync` unmount cleanup (hook auto-disposes) but
   keep the in-flight-recording guard semantics — verify the hook stops an
   in-progress recording on unmount during testing.
6. `pnpm --dir apps/mobile typecheck`, then `expo prebuild --clean` + device test:
   record → playback → replay → interruption (phone call / silent switch) →
   headphone disconnect. Watch differences #1, #4, #5 specifically.

### 4.5 Migration risks

- **`remove()` vs `release()`** naming conflict between docs prose and method
  table — resolve against the installed package's `.d.ts` before writing cleanup
  code.
- `useAudioRecorder` requires its options at hook-creation time; per-recording
  option changes need `prepareToRecordAsync(partialOptions)` (it accepts an
  optional `RecordingOptions` override) — fine for this app, which always uses
  `HIGH_QUALITY`.
- expo-audio is the actively maintained path; staying on deprecated expo-av
  risks it breaking under a future Xcode/SDK with no fix.

---

## Appendix: sources

- Runner image (Xcode 26.6 default, iOS 26.5 SDK, image 20260907.0351.1):
  https://github.com/github-maccloud/runner-images/blob/HEAD/images/macos/macos-26-arm64-Readme.md
- `macos-latest` = `macos-26-arm64` confirmation:
  https://github.com/GitLiveApp/firebase-kotlin-sdk/pull/910
- Xcode 26.6 default on macos-26 readme; Xcode 27 only on `xcode-27` label:
  https://github.com/appandflow/stim/pull/870
- Xcode-default drift precedent + ITMS-90725 (iOS 26 SDK required since 2026-04-28):
  https://github.com/actions/runner-images/issues/14165
- Pin pattern (`setup-xcode`, pre/post diagnostics):
  https://github.com/cemililik/markdown-viewer-mobile/commit/b61d03d024d4812b7c542d4145b34fc8046ad914
- Expo SDK 54 min iOS 15.1:
  https://github.com/pvhao2002/kira-app/blob/HEAD/.cursor/skills/react-native-expo-sdk52-plus/SKILL.md
  (citing https://expo.dev/changelog/sdk-54);
  https://github.com/amehmeto/tiedsiren/blob/HEAD/docs/tech-debt/expo-sdk-54-upgrade.md
- expo-audio API (SDK 54, recommended `~1.1.1`; all mapping/difference claims):
  https://docs.expo.dev/versions/v54.0.0/sdk/audio/
- `createAudioRecorder` does not exist in expo-audio (use the hook):
  https://github.com/vaddisrinivas/utopia/blob/HEAD/docs/archive/CODEBASE_DEEP_REVIEW_BASELINE_BF0EFFF_2026-07-30.md ;
  https://github.com/truenorth-lj/openhealth/commit/63b29e9f3dac537893c4458fdcce82e7ce2a1109

## Files read (evidence)

- `.github/workflows/build-ios.yml` (full; line refs via `grep -n`)
- `apps/mobile/package.json` (full) — expo `~54.0.0`, RN `0.81.5`, `newArchEnabled` via app.json, `expo-av 15.1.1`
- `apps/mobile/app.json` (full)
- `apps/mobile/src/voice-message.tsx` (full, 2 expo-av touch points)
- `apps/mobile/src/device-permissions.ts` (full, 2 expo-av touch points)
- root `package.json` (`packageManager: pnpm@11.19.0`) and `pnpm-workspace.yaml`
  (verified to justify the workflow's `working-directory: .` install step)

## Not done (out of scope for this stream)

- No source files modified; no `git push`; no CI triggered.
- The two recommended workflow fixes (F1 Xcode pin, F2 frozen lockfile) are
  proposed, not applied — left for the implementing stream.
