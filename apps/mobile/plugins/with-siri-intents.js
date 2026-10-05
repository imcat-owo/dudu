/**
 * Expo config plugin: Siri Shortcuts / App Intents (H4).
 *
 * Materializes plugins/dudu-platform/siri/DuduIntents.swift into the
 * generated iOS project and adds it to the app target's Sources build
 * phase, so the three intents (Ask Dudu, Open conversation, New chat)
 * actually ship in the build and appear in the Shortcuts app.
 *
 * The intents deep-link back into the app (dudu://siri?...); the TS side
 * routes them via parseSiriLink() in src/platform/siri-shortcuts.ts.
 * AppIntents needs no entitlement and no user authorization — once the
 * file is in the target, the intents are live.
 */
const fs = require("node:fs");
const path = require("node:path");
const { withBuildSourceFile } = require("@expo/config-plugins/build/ios/XcodeProjectFile");

const SWIFT_FILE = "DuduIntents.swift";

module.exports = function withSiriIntents(config) {
  const src = path.join(__dirname, "dudu-platform", "siri", SWIFT_FILE);
  const contents = fs.readFileSync(src, "utf8");
  return withBuildSourceFile(config, {
    filePath: SWIFT_FILE,
    contents,
    overwrite: true,
  });
};
