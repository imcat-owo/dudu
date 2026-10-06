import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

/**
 * The config plugin's Swift injection is pure JS — pin it here so a
 * future edit to the anchors can't silently stop injecting (which would
 * leave the next diagnostic build without the native trap).
 */
const require = createRequire(__filename);
const plugin = require("../plugins/with-native-crash-trap.js") as {
  injectSwift: (contents: string) => string;
  MARKER: string;
};

const DELEGATE = `import Expo
import React

@UIApplicationMain
public class AppDelegate: ExpoAppDelegate {
  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
`;

test("injectSwift installs trap + call on a fresh AppDelegate", () => {
  const out = plugin.injectSwift(DELEGATE);
  assert.ok(out.includes(plugin.MARKER), "trap code present");
  assert.ok(out.includes("DuduInstallNativeCrashTrap()"), "install call present");
  assert.ok(
    out.indexOf("DuduInstallNativeCrashTrap()") < out.indexOf("let delegate"),
    "trap installed before RN factory starts",
  );
  assert.ok(out.includes("NSSetUncaughtExceptionHandler"), "exception handler present");
  assert.ok(out.includes("RCTSetLogFunction"), "RCT log capture present");
});

test("injectSwift is idempotent", () => {
  const once = plugin.injectSwift(DELEGATE);
  const twice = plugin.injectSwift(once);
  assert.equal(twice, once, "second run changes nothing");
});

test("injectSwift leaves foreign files untouched", () => {
  const other = "public class Foo {}\n";
  assert.equal(plugin.injectSwift(other), other);
});
