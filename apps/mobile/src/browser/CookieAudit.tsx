/**
 * CookieAudit — D4 cookie audit UI.
 *
 * Shows the active tab's JS-readable cookies (via browserController.evaluate
 * reading document.cookie) and lets her clear them. Honest about limits:
 * HttpOnly cookies are invisible to JS and can't be cleared from here.
 */

import { Cookie, RefreshCw, Trash2, X } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Alert, Modal, ScrollView, TouchableOpacity, View } from "react-native";
import { TText } from "../font";
import { useStrings } from "../i18n";
import { useColors } from "../ui";
import { browserController } from "./controller";
import { CLEAR_COOKIES_JS, type CookieItem, parseCookies } from "./cookies";

export function CookieAuditButton() {
  const { t } = useStrings();
  const colors = useColors();
  const [open, setOpen] = useState(false);
  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityLabel={t("browser.cookieAudit")}
        accessibilityRole="button"
      >
        <Cookie size={18} color={colors.text} />
      </TouchableOpacity>
      <CookieAuditSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function CookieAuditSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useStrings();
  const colors = useColors();
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
      <View
        style={{ flex: 1, paddingTop: 60, paddingHorizontal: 16, backgroundColor: colors.canvas }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 8,
          }}
        >
          <TText style={{ fontSize: 18, fontWeight: "600", color: colors.text }}>
            {t("browser.cookieAudit")}
          </TText>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel={t("common.close")}
            accessibilityRole="button"
          >
            <X size={20} color={colors.text} />
          </TouchableOpacity>
        </View>
        <TText style={{ fontSize: 13, color: colors.muted, marginBottom: 12 }}>
          {t("browser.cookieAuditDesc")}
        </TText>

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
              backgroundColor: colors.secondaryBg,
              opacity: loading ? 0.5 : 1,
            }}
            accessibilityRole="button"
          >
            <RefreshCw size={14} color={colors.text} />
            <TText style={{ fontSize: 14, color: colors.text }}>{t("browser.cookieRefresh")}</TText>
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
                backgroundColor: colors.errorBg,
                opacity: loading ? 0.5 : 1,
              }}
              accessibilityRole="button"
            >
              <Trash2 size={14} color={colors.danger} />
              <TText style={{ fontSize: 14, color: colors.danger }}>
                {t("browser.cookieClear")}
              </TText>
            </TouchableOpacity>
          )}
        </View>

        {loading && <ActivityIndicator style={{ marginTop: 24 }} color={colors.muted} />}
        {!loading && error !== "" && (
          <TText style={{ fontSize: 14, color: colors.danger, marginTop: 12 }}>{error}</TText>
        )}
        {!loading && error === "" && cookies === null && (
          <TText style={{ fontSize: 14, color: colors.muted, marginTop: 12 }}>
            {t("browser.cookieRefresh")}
          </TText>
        )}
        {!loading && error === "" && cookies !== null && cookies.length === 0 && (
          <TText style={{ fontSize: 14, color: colors.muted, marginTop: 12 }}>
            {cleared ? t("browser.cookieCleared") : t("browser.cookiesEmpty")}
          </TText>
        )}
        {!loading && cookies !== null && cookies.length > 0 && (
          <>
            <TText style={{ fontSize: 13, color: colors.muted, marginBottom: 8 }}>
              {t("browser.cookieCount", { n: cookies.length })}
            </TText>
            <ScrollView style={{ flex: 1 }}>
              {cookies.map((c) => (
                <View
                  key={c.name}
                  style={{
                    paddingVertical: 10,
                    paddingHorizontal: 12,
                    borderRadius: 10,
                    backgroundColor: colors.card,
                    marginBottom: 8,
                  }}
                >
                  <TText
                    style={{ fontSize: 14, fontWeight: "600", color: colors.text }}
                    numberOfLines={1}
                  >
                    {c.name}
                  </TText>
                  <TText
                    style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}
                    numberOfLines={3}
                  >
                    {c.value || "—"}
                  </TText>
                </View>
              ))}
            </ScrollView>
          </>
        )}

        <TText style={{ fontSize: 12, color: colors.muted, marginTop: 12, marginBottom: 24 }}>
          {t("browser.cookieNote")}
        </TText>
      </View>
    </Modal>
  );
}
