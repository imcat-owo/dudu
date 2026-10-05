/**
 * CookieAudit — D4 cookie audit UI.
 *
 * Shows the active tab's JS-readable cookies (via browserController.evaluate
 * reading document.cookie) and lets her clear them. Honest about limits:
 * HttpOnly cookies are invisible to JS and can't be cleared from here.
 */

import { Cookie, RefreshCw, Trash2, X } from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useStrings } from "../i18n";
import { browserController } from "./controller";
import { CLEAR_COOKIES_JS, type CookieItem, parseCookies } from "./cookies";

export function CookieAuditButton() {
  const { t } = useStrings();
  const [open, setOpen] = useState(false);
  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityLabel={t("browser.cookieAudit")}
        accessibilityRole="button"
      >
        <Cookie size={18} />
      </TouchableOpacity>
      <CookieAuditSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function CookieAuditSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useStrings();
  const [cookies, setCookies] = useState<CookieItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [cleared, setCleared] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    setCleared(false);
    try {
      const res = await browserController.evaluate("return document.cookie;");
      if (!res.ok) {
        setError(t("browser.cookieLoadFail"));
        setCookies(null);
      } else {
        setCookies(parseCookies(res.value ?? ""));
      }
    } catch {
      setError(t("browser.cookieLoadFail"));
      setCookies(null);
    } finally {
      setLoading(false);
    }
  }

  async function clear() {
    Alert.alert(t("browser.cookieAudit"), t("browser.cookieClearConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("browser.cookieClear"),
        style: "destructive",
        onPress: async () => {
          setLoading(true);
          setError("");
          try {
            const res = await browserController.evaluate(CLEAR_COOKIES_JS);
            if (!res.ok) {
              setError(t("browser.cookieLoadFail"));
            } else {
              setCookies(parseCookies(res.value ?? ""));
              setCleared(true);
            }
          } catch {
            setError(t("browser.cookieLoadFail"));
          } finally {
            setLoading(false);
          }
        },
      },
    ]);
  }

  return (
    <Modal visible={open} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, paddingTop: 60, paddingHorizontal: 16 }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 8,
          }}
        >
          <Text style={{ fontSize: 18, fontWeight: "600" }}>{t("browser.cookieAudit")}</Text>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel={t("common.close")}
            accessibilityRole="button"
          >
            <X size={20} />
          </TouchableOpacity>
        </View>
        <Text style={{ fontSize: 13, color: "#666", marginBottom: 12 }}>
          {t("browser.cookieAuditDesc")}
        </Text>

        <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
          <TouchableOpacity
            onPress={load}
            disabled={loading}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 10,
              backgroundColor: "#f0f0f0",
              opacity: loading ? 0.5 : 1,
            }}
            accessibilityRole="button"
          >
            <RefreshCw size={14} />
            <Text style={{ fontSize: 14 }}>{t("browser.cookieRefresh")}</Text>
          </TouchableOpacity>
          {cookies && cookies.length > 0 && (
            <TouchableOpacity
              onPress={clear}
              disabled={loading}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 10,
                backgroundColor: "#ffe8e8",
                opacity: loading ? 0.5 : 1,
              }}
              accessibilityRole="button"
            >
              <Trash2 size={14} />
              <Text style={{ fontSize: 14 }}>{t("browser.cookieClear")}</Text>
            </TouchableOpacity>
          )}
        </View>

        {loading && <ActivityIndicator style={{ marginTop: 24 }} />}
        {!loading && error !== "" && (
          <Text style={{ fontSize: 14, color: "#a00", marginTop: 12 }}>{error}</Text>
        )}
        {!loading && error === "" && cookies === null && (
          <Text style={{ fontSize: 14, color: "#666", marginTop: 12 }}>
            {t("browser.cookieRefresh")}
          </Text>
        )}
        {!loading && error === "" && cookies !== null && cookies.length === 0 && (
          <Text style={{ fontSize: 14, color: "#666", marginTop: 12 }}>
            {cleared ? t("browser.cookieCleared") : t("browser.cookiesEmpty")}
          </Text>
        )}
        {!loading && cookies !== null && cookies.length > 0 && (
          <>
            <Text style={{ fontSize: 13, color: "#666", marginBottom: 8 }}>
              {t("browser.cookieCount", { n: cookies.length })}
            </Text>
            <ScrollView style={{ flex: 1 }}>
              {cookies.map((c) => (
                <View
                  key={c.name}
                  style={{
                    paddingVertical: 10,
                    paddingHorizontal: 12,
                    borderRadius: 10,
                    backgroundColor: "#f7f7f7",
                    marginBottom: 8,
                  }}
                >
                  <Text style={{ fontSize: 14, fontWeight: "600" }} numberOfLines={1}>
                    {c.name}
                  </Text>
                  <Text style={{ fontSize: 12, color: "#555", marginTop: 4 }} numberOfLines={3}>
                    {c.value || "—"}
                  </Text>
                </View>
              ))}
            </ScrollView>
          </>
        )}

        <Text style={{ fontSize: 12, color: "#999", marginTop: 12, marginBottom: 24 }}>
          {t("browser.cookieNote")}
        </Text>
      </View>
    </Modal>
  );
}
