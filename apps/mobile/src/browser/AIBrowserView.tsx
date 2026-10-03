/**
 * AIBrowserView — the WebView the AI drives.
 *
 * Mounts a real WebView and registers its ref with browserController.
 * The AI tools (browser_navigate/snapshot/click/input/...) drive it
 * through the controller. She can see what's happening — the view is
 * visible when the browser tab is open.
 *
 * Message flow: injected JS posts results via
 * window.ReactNativeWebView.postMessage -> onMessage -> controller.
 */
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";
import { type BrowserWebViewRef, browserController } from "./controller";

export default function AIBrowserView({ visible }: { visible: boolean }) {
  const ref = useRef<WebView>(null);
  const [url, setUrl] = useState("about:blank");

  useEffect(() => {
    const wvRef: BrowserWebViewRef = {
      injectJavaScript: (js: string) => ref.current?.injectJavaScript(js),
      goBack: () => ref.current?.goBack(),
      goForward: () => ref.current?.goForward(),
      reload: () => ref.current?.reload(),
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
      <WebView
        ref={ref}
        source={{ uri: url }}
        style={{ flex: 1 }}
        onMessage={(event) => {
          browserController.handleMessage(event.nativeEvent.data);
        }}
        onNavigationStateChange={(nav) => {
          browserController.setUrl(nav.url);
        }}
      />
    </View>
  );
}
