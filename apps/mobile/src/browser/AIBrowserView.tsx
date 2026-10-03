/**
 * AIBrowserView — the WebView the AI drives.
 *
 * Mounts a real WebView and registers its ref with browserController.
 * The AI tools (browser_navigate/snapshot/click/input/screenshot/...)
 * drive it through the controller. She can see what's happening — the
 * view is visible when the browser tab is open.
 *
 * Message flow: injected JS posts results via
 * window.ReactNativeWebView.postMessage -> onMessage -> controller.
 *
 * Screenshots: the WebView is wrapped in ViewShot (react-native-view-shot,
 * native module — needs a dev build, not Expo Go). captureScreenshot()
 * captures the rendered page as a PNG file for the AI's vision.
 */
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import ViewShot, { type ViewShotRef } from "react-native-view-shot";
import { WebView } from "react-native-webview";
import { type BrowserWebViewRef, browserController } from "./controller";

export default function AIBrowserView({ visible }: { visible: boolean }) {
  const webViewRef = useRef<WebView>(null);
  const shotRef = useRef<ViewShotRef>(null);
  const [url, setUrl] = useState("about:blank");

  useEffect(() => {
    const wvRef: BrowserWebViewRef = {
      injectJavaScript: (js: string) => webViewRef.current?.injectJavaScript(js),
      goBack: () => webViewRef.current?.goBack(),
      goForward: () => webViewRef.current?.goForward(),
      reload: () => webViewRef.current?.reload(),
      captureScreenshot: async () => {
        const shot = shotRef.current;
        if (!shot?.capture) {
          throw new Error(
            "Screenshot not available — needs a dev build with react-native-view-shot (not Expo Go).",
          );
        }
        // capture() resolves with a file URI (png).
        return shot.capture();
      },
    };
    browserController.setWebView(wvRef);
    // Pick up any URL the AI requested before mount.
    const pending = browserController.url;
    if (pending) setUrl(pending);
    return () => {
      browserController.setWebView(null);
    };
  }, []);

  // When the AI navigates while mounted, update the source.
  useEffect(() => {
    const target = browserController.url;
    if (target && target !== url) setUrl(target);
  });

  if (!visible) return null;

  return (
    <View style={{ flex: 1 }}>
      <ViewShot ref={shotRef} style={{ flex: 1 }} options={{ format: "png", quality: 0.9 }}>
        <WebView
          ref={webViewRef}
          source={{ uri: url }}
          style={{ flex: 1 }}
          onMessage={(event) => {
            browserController.handleMessage(event.nativeEvent.data);
          }}
          onNavigationStateChange={(nav) => {
            browserController.setUrl(nav.url);
          }}
        />
      </ViewShot>
    </View>
  );
}
