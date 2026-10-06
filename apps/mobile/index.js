import "react-native-get-random-values";
import "@copilotkit/react-native/polyfills";
import { registerRootComponent } from "expo";
import App from "./App";
import { installJSGlobalHandler } from "./src/js-global-handler";

// Persist uncaught JS errors (including converted native exceptions)
// into the crash-report ring buffer before anything else runs.
installJSGlobalHandler();

registerRootComponent(App);
