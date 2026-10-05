/**
 * Remote backup UI — WebDAV / S3 config + upload/download.
 * Credentials go to SecureStore, never logs.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { Alert, ScrollView, TextInput, View } from "react-native";
import { TText } from "../font";
import { t } from "../i18n";
import { Button, SectionHeading, useColors } from "../ui";
import {
  s3Download,
  s3Upload,
  validateS3,
  validateWebDav,
  webdavDownload,
  webdavList,
  webdavUpload,
  type S3Config,
  type WebDavConfig,
} from "./remote";
import { collectBackup, parseBackup, serializeBackup, applyBackup } from "../backup";
import { getKnowledgeStore } from "../knowledge/instance";

const WD_URL_KEY = "dudu.backup.webdav.url.v1";
const WD_USER_KEY = "dudu.backup.webdav.user.v1";
const WD_PATH_KEY = "dudu.backup.webdav.path.v1";
const WD_PASS_KEY = "dudu.backup.webdav.pass.v1"; // SecureStore
const S3_CFG_KEY = "dudu.backup.s3.cfg.v1";
const S3_SECRET_KEY = "dudu.backup.s3.secret.v1"; // SecureStore

function secureBackend() {
  return {
    getItem: async (key: string) => {
      const { getItemAsync } = await import("expo-secure-store");
      return getItemAsync(key);
    },
    setItem: async (key: string, value: string) => {
      const { setItemAsync } = await import("expo-secure-store");
      return setItemAsync(key, value);
    },
  };
}

export function RemoteBackupSection() {
  const colors = useColors();
  const [tab, setTab] = useState<"webdav" | "s3">("webdav");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  // WebDAV fields
  const [wdUrl, setWdUrl] = useState("");
  const [wdUser, setWdUser] = useState("");
  const [wdPass, setWdPass] = useState("");
  const [wdPath, setWdPath] = useState("dudu_backups");
  // S3 fields
  const [s3Endpoint, setS3Endpoint] = useState("");
  const [s3Region, setS3Region] = useState("us-east-1");
  const [s3Bucket, setS3Bucket] = useState("");
  const [s3Key, setS3Key] = useState("");
  const [s3Secret, setS3Secret] = useState("");
  const [s3Prefix, setS3Prefix] = useState("dudu_backups");
  const [cloudFiles, setCloudFiles] = useState<string[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        setWdUrl((await AsyncStorage.getItem(WD_URL_KEY)) ?? "");
        setWdUser((await AsyncStorage.getItem(WD_USER_KEY)) ?? "");
        setWdPath((await AsyncStorage.getItem(WD_PATH_KEY)) ?? "dudu_backups");
        const s3raw = await AsyncStorage.getItem(S3_CFG_KEY);
        if (s3raw) {
          const c = JSON.parse(s3raw) as Partial<S3Config>;
          setS3Endpoint(c.endpoint ?? "");
          setS3Region(c.region ?? "us-east-1");
          setS3Bucket(c.bucket ?? "");
          setS3Key(c.accessKeyId ?? "");
          setS3Prefix(c.prefix ?? "dudu_backups");
        }
      } catch {
        // ignore
      }
    })();
  }, []);

  const saveWebDav = async () => {
    const err = validateWebDav(wdUrl);
    if (err) {
      setNotice(t("backup.remote.testFailed"));
      return;
    }
    await AsyncStorage.setItem(WD_URL_KEY, wdUrl.trim());
    await AsyncStorage.setItem(WD_USER_KEY, wdUser.trim());
    await AsyncStorage.setItem(WD_PATH_KEY, wdPath.trim() || "dudu_backups");
    if (wdPass) await secureBackend().setItem(WD_PASS_KEY, wdPass);
    setNotice(t("globalmd.saved"));
  };

  const saveS3 = async () => {
    const err = validateS3(s3Endpoint, s3Bucket, s3Key);
    if (err) {
      setNotice(t("backup.remote.testFailed"));
      return;
    }
    await AsyncStorage.setItem(
      S3_CFG_KEY,
      JSON.stringify({
        endpoint: s3Endpoint.trim(),
        region: s3Region.trim() || "us-east-1",
        bucket: s3Bucket.trim(),
        accessKeyId: s3Key.trim(),
        prefix: s3Prefix.trim() || "dudu_backups",
        pathStyle: true,
        includeFiles: true,
      } satisfies S3Config),
    );
    if (s3Secret) await secureBackend().setItem(S3_SECRET_KEY, s3Secret);
    setNotice(t("globalmd.saved"));
  };

  const doUpload = async () => {
    setBusy(true);
    setNotice("");
    try {
      const backup = await collectBackup(AsyncStorage, secureBackend(), await getKnowledgeStore());
      const json = serializeBackup(backup);
      const stamp = new Date().toISOString().slice(0, 10);
      const filename = `dudu-backup-${stamp}.json`;
      if (tab === "webdav") {
        const password = (await secureBackend().getItem(WD_PASS_KEY)) ?? "";
        await webdavUpload(
          { kind: "webdav", config: { url: wdUrl.trim(), username: wdUser.trim(), path: wdPath.trim(), includeFiles: true }, password },
          filename,
          json,
        );
      } else {
        const secret = (await secureBackend().getItem(S3_SECRET_KEY)) ?? "";
        await s3Upload(
          {
            kind: "s3",
            config: {
              endpoint: s3Endpoint.trim(),
              region: s3Region.trim(),
              bucket: s3Bucket.trim(),
              accessKeyId: s3Key.trim(),
              prefix: s3Prefix.trim(),
              pathStyle: true,
              includeFiles: true,
            },
            secretAccessKey: secret,
          },
          filename,
          json,
        );
      }
      setNotice(t("backup.remote.uploadDone"));
    } catch (e) {
      setNotice(t("backup.remote.uploadFailed", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };

  const doList = async () => {
    setBusy(true);
    setNotice("");
    try {
      if (tab === "webdav") {
        const password = (await secureBackend().getItem(WD_PASS_KEY)) ?? "";
        const files = await webdavList({
          kind: "webdav",
          config: { url: wdUrl.trim(), username: wdUser.trim(), path: wdPath.trim(), includeFiles: true },
          password,
        });
        setCloudFiles(files);
      } else {
        setNotice(t("backup.remote.empty"));
      }
    } catch {
      setNotice(t("backup.remote.testFailed"));
    } finally {
      setBusy(false);
    }
  };

  const doDownload = (filename: string) => {
    Alert.alert(t("backup.remote.download"), filename, [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("backup.remote.download"),
        onPress: () =>
          void (async () => {
            setBusy(true);
            try {
              let text: string;
              if (tab === "webdav") {
                const password = (await secureBackend().getItem(WD_PASS_KEY)) ?? "";
                text = await webdavDownload(
                  {
                    kind: "webdav",
                    config: { url: wdUrl.trim(), username: wdUser.trim(), path: wdPath.trim(), includeFiles: true },
                    password,
                  },
                  filename,
                );
              } else {
                const secret = (await secureBackend().getItem(S3_SECRET_KEY)) ?? "";
                text = await s3Download(
                  {
                    kind: "s3",
                    config: {
                      endpoint: s3Endpoint.trim(),
                      region: s3Region.trim(),
                      bucket: s3Bucket.trim(),
                      accessKeyId: s3Key.trim(),
                      prefix: s3Prefix.trim(),
                      pathStyle: true,
                      includeFiles: true,
                    },
                    secretAccessKey: secret,
                  },
                  filename,
                );
              }
              const parsed = parseBackup(text);
              if (!parsed.ok) {
                setNotice(t("import.failed"));
                return;
              }
              await applyBackup(parsed.backup, AsyncStorage, secureBackend(), await getKnowledgeStore(), {
                mode: "overwrite",
              });
              setNotice(t("backup.restoreDone"));
            } catch (e) {
              setNotice(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          })(),
      },
    ]);
  };

  const inputStyle = {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    padding: 10,
    color: colors.text,
    marginBottom: 10,
  };

  return (
    <ScrollView>
      <SectionHeading title={t("backup.remote.title")} />
      <TText style={{ color: colors.muted, fontSize: 12, marginBottom: 10 }}>{t("backup.remote.securityNote")}</TText>
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
        <Button primary={tab === "webdav"} onPress={() => setTab("webdav")}>
          {t("backup.remote.webdav")}
        </Button>
        <Button primary={tab === "s3"} onPress={() => setTab("s3")}>
          {t("backup.remote.s3")}
        </Button>
      </View>

      {tab === "webdav" ? (
        <View>
          <TText>{t("backup.remote.url")}</TText>
          <TextInput value={wdUrl} onChangeText={setWdUrl} placeholder={t("backup.remote.urlPlaceholder")} autoCapitalize="none" style={inputStyle} />
          <TText>{t("backup.remote.username")}</TText>
          <TextInput value={wdUser} onChangeText={setWdUser} autoCapitalize="none" style={inputStyle} />
          <TText>{t("backup.remote.password")}</TText>
          <TextInput value={wdPass} onChangeText={setWdPass} secureTextEntry placeholder="••••••" style={inputStyle} />
          <TText>{t("backup.remote.path")}</TText>
          <TextInput value={wdPath} onChangeText={setWdPath} autoCapitalize="none" style={inputStyle} />
          <Button onPress={() => void saveWebDav()}>{t("common.save")}</Button>
        </View>
      ) : (
        <View>
          <TText>{t("backup.remote.endpoint")}</TText>
          <TextInput value={s3Endpoint} onChangeText={setS3Endpoint} placeholder={t("backup.remote.endpointPlaceholder")} autoCapitalize="none" style={inputStyle} />
          <TText>{t("backup.remote.region")}</TText>
          <TextInput value={s3Region} onChangeText={setS3Region} autoCapitalize="none" style={inputStyle} />
          <TText>{t("backup.remote.bucket")}</TText>
          <TextInput value={s3Bucket} onChangeText={setS3Bucket} autoCapitalize="none" style={inputStyle} />
          <TText>{t("backup.remote.accessKey")}</TText>
          <TextInput value={s3Key} onChangeText={setS3Key} autoCapitalize="none" style={inputStyle} />
          <TText>{t("backup.remote.secretKey")}</TText>
          <TextInput value={s3Secret} onChangeText={setS3Secret} secureTextEntry placeholder="••••••" style={inputStyle} />
          <TText>{t("backup.remote.prefix")}</TText>
          <TextInput value={s3Prefix} onChangeText={setS3Prefix} autoCapitalize="none" style={inputStyle} />
          <Button onPress={() => void saveS3()}>{t("common.save")}</Button>
        </View>
      )}

      <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
        <Button primary onPress={() => void doUpload()} disabled={busy}>
          {busy ? t("backup.remote.uploading") : t("backup.remote.upload")}
        </Button>
        <Button onPress={() => void doList()} disabled={busy}>
          {t("backup.remote.list")}
        </Button>
      </View>

      {cloudFiles.map((f) => (
        <View key={f} style={{ flexDirection: "row", alignItems: "center", padding: 8, borderBottomWidth: 1, borderColor: colors.line }}>
          <TText style={{ flex: 1 }}>{f}</TText>
          <Button onPress={() => doDownload(f)}>{t("backup.remote.download")}</Button>
        </View>
      ))}

      {notice ? <TText style={{ marginTop: 8 }}>{notice}</TText> : null}
    </ScrollView>
  );
}
