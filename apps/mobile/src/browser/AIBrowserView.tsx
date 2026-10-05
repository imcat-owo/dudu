/**
 * AIBrowserView — the WebView the AI drives, now with tabs for her.
 *
 * D4: Multi-tab UI. She can open tabs, switch between them, and see her
 * history. The AI drives the ACTIVE tab through browserController.
 *
 * Message flow: injected JS posts results via
 * window.ReactNativeWebView.postMessage -> onMessage -> controller.
 *
 * Screenshots: the WebView is wrapped in ViewShot (react-native-view-shot,
 * native module — needs a dev build, not Expo Go). captureScreenshot()
 * captures the rendered page as a PNG file for the AI's vision.
 */

import { Plus, X } from "lucide-react-native";
import { useEffect, useRef } from "react";
import { ScrollView, TouchableOpacity, View } from "react-native";
import ViewShot, { type ViewShotRef } from "react-native-view-shot";
import { WebView } from "react-native-webview";
import { TText } from "../font";
import { useStrings } from "../i18n";
import { useColors } from "../ui";
import { CookieAuditButton } from "./CookieAudit";
import { type BrowserWebViewRef, browserController } from "./controller";
import { browserTabStore, useBrowserTabs } from "./tabs";

function TabWebView({ tabId, url, visible }: { tabId: string; url: string; visible: boolean }) {
  const webViewRef = useRef<WebView>(null);
  const shotRef = useRef<ViewShotRef>(null);

  useEffect(() => {
    if (!visible) return;
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
        return shot.capture();
      },
    };
    browserController.setWebView(wvRef);
    return () => {
      browserController.setWebView(null);
    };
  }, [visible]);

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
            browserTabStore.navigateTab(tabId, nav.url);
            if (nav.title) browserTabStore.setTabTitle(tabId, nav.title);
            browserTabStore.recordHistory(nav.url, nav.title || nav.url);
          }}
        />
      </ViewShot>
    </View>
  );
}

export default function AIBrowserView({ visible }: { visible: boolean }) {
  const { tabs, activeId } = useBrowserTabs();
  const { t } = useStrings();
  const colors = useColors();
  const activeTab = tabs.find((t) => t.id === activeId) ?? tabs[0];

  // The AI's pending navigation goes to the active tab.
  useEffect(() => {
    const pending = browserController.url;
    if (pending && pending !== activeTab.url) {
      browserTabStore.navigateTab(activeTab.id, pending);
    }
  });

  if (!visible) return null;

  return (
    <View style={{ flex: 1 }}>
      {/* Tab bar */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingVertical: 6,
          paddingHorizontal: 8,
          gap: 6,
        }}
      >
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", gap: 6 }}>
            {tabs.map((tab) => (
              <TouchableOpacity
                key={tab.id}
                onPress={() => browserTabStore.activateTab(tab.id)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 12,
                  backgroundColor: tab.id === activeId ? colors.card : colors.inputBg,
                  maxWidth: 160,
                }}
              >
                <TText numberOfLines={1} style={{ fontSize: 12, flex: 1, color: colors.text }}>
                  {tab.title || t("browser.newTab")}
                </TText>
                {tabs.length > 1 && (
                  <TouchableOpacity
                    onPress={() => browserTabStore.closeTab(tab.id)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <X size={12} color={colors.muted} />
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
        <TouchableOpacity
          onPress={() => browserTabStore.openTab()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel="New tab"
        >
          <Plus size={18} color={colors.text} />
        </TouchableOpacity>
        <CookieAuditButton />
      </View>
      {/* Tab contents */}
      <View style={{ flex: 1 }}>
        {tabs.map((tab) => (
          <TabWebView key={tab.id} tabId={tab.id} url={tab.url} visible={tab.id === activeId} />
        ))}
      </View>
    </View>
  );
}
