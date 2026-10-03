/**
 * Expo config plugin: adds the HealthKit entitlement.
 *
 * react-native-health has no config plugin of its own. This adds
 * com.apple.developer.healthkit so the native HealthKit APIs work
 * after `npx expo prebuild`.
 */
const { withEntitlementsPlist } = require("@expo/config-plugins");

module.exports = function withHealthKit(config) {
  return withEntitlementsPlist(config, (config) => {
    config.modResults["com.apple.developer.healthkit"] = true;
    return config;
  });
};
