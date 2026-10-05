/**
 * Expo config plugin: AlarmKit support for AI-set alarms.
 *
 * Adds NSAlarmKitUsageDescription to Info.plist (required on iOS 26+
 * when using AlarmKit). The native Swift module (DuduAlarmKit) is
 * provided separately — see plugins/dudu-alarmkit/README.md.
 *
 * When the native module isn't linked (or iOS < 26), the TS side
 * (src/voice/alarms.ts) falls back to scheduled notifications, so
 * alarms still work — just without the system alarm UI.
 */
const { withInfoPlist } = require("@expo/config-plugins");

module.exports = function withAlarmKit(config) {
  return withInfoPlist(config, (config) => {
    config.modResults["NSAlarmKitUsageDescription"] =
      "嘟嘟用闹钟帮你到点叫醒，也能让 AI 帮你定闹钟。";
    return config;
  });
};
