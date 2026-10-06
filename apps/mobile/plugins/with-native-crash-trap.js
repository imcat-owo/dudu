/**
 * Expo config plugin: native crash trap (2026-10-06).
 *
 * Her device .ips log showed the app dying ~2s after launch inside the
 * Hermes GC, with an NSException being converted to a JS error on the
 * TurboModule queue at the same time — some native module throws at
 * startup, the conversion corrupts the Hermes heap, GC crashes later.
 * The throwing module is unknown, so this plugin installs a native-side
 * trap that writes the evidence to Library/Caches/dudu-native-crash.log,
 * which the JS side (src/native-crash-log.ts) reads on the next launch
 * and surfaces in the CrashFallback screen.
 *
 * What the trap installs (in AppDelegate.didFinishLaunchingWithOptions):
 * - NSSetUncaughtExceptionHandler: writes exception name/reason + first
 *   15 stack frames. Identifies the throwing native module.
 * - RCTSetLogFunction: appends every React Native log line (TurboModule
 *   errors go through RCTLog before the NSException). Shows which
 *   module/method was running when it threw.
 *
 * Defensive by design: all writes go to a background serial queue, the
 * file is capped at ~200KB with rotation to the last 100KB, and nothing
 * in the trap can throw. Idempotent: guarded by the DUDU_NATIVE_CRASH_TRAP
 * marker, so repeated prebuilds never double-inject.
 */
const { withAppDelegate } = require("@expo/config-plugins");

const MARKER = "DUDU_NATIVE_CRASH_TRAP";

const SWIFT_TRAP = `// DUDU_NATIVE_CRASH_TRAP — native crash diagnostic (2026-10-06).
// Captures uncaught NSExceptions and all RCTLog lines to
// Library/Caches/dudu-native-crash.log. The JS side reads this file on
// the next launch and shows it in the CrashFallback screen, so a
// screenshot identifies which native module threw at startup.
// Never throws; writes on a background serial queue; file capped at
// ~200KB with rotation.
private let duduCrashTrapQueue = DispatchQueue(label: "app.dudu.crashtrap", qos: .utility)
private let duduCrashTrapMaxBytes: UInt64 = 200 * 1024

private func duduCrashTrapFileURL() -> URL {
  FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    .appendingPathComponent("dudu-native-crash.log")
}

private func DuduAppendNativeLog(_ line: String) {
  duduCrashTrapQueue.async {
    do {
      let url = duduCrashTrapFileURL()
      let fm = FileManager.default
      if let attrs = try? fm.attributesOfItem(atPath: url.path),
        let size = attrs[.size] as? UInt64, size > duduCrashTrapMaxBytes,
        let handle = try? FileHandle(forReadingFrom: url)
      {
        // Rotate: keep the last 100KB so the newest evidence survives.
        handle.seekToEndOfFile()
        let end = handle.offsetInFile
        handle.seek(toFileOffset: end > 100 * 1024 ? end - 100 * 1024 : 0)
        let tail = handle.readDataToEndOfFile()
        try? tail.write(to: url, options: .atomic)
      }
      let stamp = ISO8601DateFormatter().string(from: Date())
      guard let data = "[\\(stamp)] \\(line)\\n".data(using: .utf8) else { return }
      if fm.fileExists(atPath: url.path) {
        let handle = try FileHandle(forWritingTo: url)
        handle.seekToEndOfFile()
        handle.write(data)
        try? handle.close()
      } else {
        try data.write(to: url, options: .atomic)
      }
    } catch {
      // The trap must never crash the app.
    }
  }
}

private func DuduInstallNativeCrashTrap() {
  NSSetUncaughtExceptionHandler { exception in
    DuduAppendNativeLog(
      "NSEXCEPTION name=\\(exception.name.rawValue) reason=\\(exception.reason ?? "<none>")"
    )
    for (i, frame) in exception.callStackSymbols.prefix(15).enumerated() {
      DuduAppendNativeLog("  frame#\\(i) \\(frame)")
    }
    // Best-effort flush: the process is dying; wait up to 2s for the
    // queue to finish so the evidence actually lands on disk.
    let sema = DispatchSemaphore(value: 0)
    duduCrashTrapQueue.async { sema.signal() }
    _ = sema.wait(timeout: .now() + 2)
  }
  RCTSetLogFunction { level, _source, _fileName, _lineNumber, message in
    DuduAppendNativeLog("RCTLOG level=\\(level.rawValue) \\(message ?? "")")
  }
}`;

const LAUNCH_ANCHOR = ") -> Bool {\n    let delegate = ReactNativeDelegate()";
const LAUNCH_REPLACEMENT =
  ") -> Bool {\n    DuduInstallNativeCrashTrap()\n    let delegate = ReactNativeDelegate()";

/**
 * Inject the trap into a Swift AppDelegate. Returns the original contents
 * unchanged when already injected or when the anchors are missing (never
 * half-inject).
 */
function injectSwift(contents) {
  if (contents.includes(MARKER)) return contents;
  if (!contents.includes("@UIApplicationMain") || !contents.includes(LAUNCH_ANCHOR)) {
    return contents;
  }
  return contents
    .replace("@UIApplicationMain", `${SWIFT_TRAP}\n\n@UIApplicationMain`)
    .replace(LAUNCH_ANCHOR, LAUNCH_REPLACEMENT);
}

module.exports = function withNativeCrashTrap(config) {
  return withAppDelegate(config, (config) => {
    const mod = config.modResults;
    if (mod.path.endsWith(".swift") && typeof mod.contents === "string") {
      mod.contents = injectSwift(mod.contents);
    }
    return config;
  });
};

// Exported for unit testing the injection logic.
module.exports.injectSwift = injectSwift;
module.exports.MARKER = MARKER;
