import { useState } from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";
import { ErrorNotice } from "./ui";
import { radii } from "./theme/radii";
export default function BrowserConsole({ url }: { url: string }) {
  const [error, setError] = useState("");
  return (
    <View>
      <ErrorNotice error={error} />
      <WebView
        source={{ uri: url }}
        onError={(event) => setError(event.nativeEvent.description)}
        style={{ height: 520, borderRadius: radii.md }}
      />
    </View>
  );
}
