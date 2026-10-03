/**
 * 知识库 (Knowledge Base) — management UI.
 *
 * Sheet with the document list: upload (txt/md), indexing progress,
 * delete. PDF/Word are honestly labeled "coming soon" — no fake support.
 *
 * Sora gray, compact refined type, lucide icons only. Zero emoji.
 */

import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { BookOpen, FileText, Loader2, Plus, Trash2, TriangleAlert } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, View } from "react-native";
import { useApiGroups } from "../api-groups/store";
import { TText } from "../font";
import { t } from "../i18n";
import { taskProgressStore } from "../our-space/task-progress-instance";
import { SoraAmbient } from "../sora-ambient";
import { Button, Empty, Sheet, useColors, useStyles } from "../ui";
import { type IndexProgress, indexDocument } from "./indexer";
import { knowledgeStore } from "./instance";
import type { KbDoc } from "./store";

const SUPPORTED_EXT = /\.(txt|md|markdown)$/i;
const UNSUPPORTED_EXT = /\.(pdf|docx?|pptx?|xlsx?)$/i;

function statusLabel(doc: KbDoc): string {
  switch (doc.status) {
    case "ready":
      return t("kb.status.ready", { count: doc.chunkCount });
    case "indexing":
      return t("kb.status.indexing");
    case "failed":
      return t("kb.status.failed");
  }
}

export function KnowledgeSheet({ onClose }: { onClose: () => void }) {
  const colors = useColors();
  const s = useStyles();
  const { active } = useApiGroups();
  const [docs, setDocs] = useState<KbDoc[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<IndexProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setDocs(await knowledgeStore.listDocs());
  }, []);

  useEffect(() => {
    void refresh();
    return knowledgeStore.subscribe(() => {
      void refresh();
    });
  }, [refresh]);

  const pickAndIndex = useCallback(async () => {
    setError(null);
    const res = await DocumentPicker.getDocumentAsync({
      type: ["text/plain", "text/markdown", "*.txt", "*.md", "*.markdown"],
      copyToCacheDirectory: true,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const asset = res.assets[0];
    const name = asset.name ?? "untitled";
    if (UNSUPPORTED_EXT.test(name)) {
      setError(t("kb.unsupportedSoon"));
      return;
    }
    if (!SUPPORTED_EXT.test(name)) {
      setError(t("kb.unsupportedType"));
      return;
    }
    if (!active) {
      setError(t("kb.noApiGroup"));
      return;
    }
    setBusy(true);
    const taskId = `kb-index-${Date.now()}`;
    try {
      const text = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      const kind = /\.md$/i.test(name) ? "md" : "txt";
      const doc = await knowledgeStore.addDoc(name, kind, asset.size ?? text.length);
      await taskProgressStore.upsert({
        id: taskId,
        name: t("kb.indexingTask"),
        progress: 0,
        stage: "",
        status: "running",
        backgroundUri: null,
      });
      await taskProgressStore.saveIndex();
      await indexDocument(knowledgeStore, active, doc.id, text, kind === "md", {
        onProgress: (p) => {
          setProgress(p);
          const total = Math.max(1, p.total);
          const pct = p.phase === "chunking" ? 0.1 : 0.1 + 0.9 * (p.done / total);
          void taskProgressStore.upsert({
            id: taskId,
            name: t("kb.indexingTask"),
            progress: pct,
            stage: t("kb.indexingStage", { done: p.done, total: p.total }),
            status: "running",
            backgroundUri: null,
          });
        },
      });
      await taskProgressStore.upsert({
        id: taskId,
        name: t("kb.indexingTask"),
        progress: 1,
        stage: t("kb.indexingDone"),
        status: "done",
        backgroundUri: null,
      });
      await taskProgressStore.saveIndex();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await taskProgressStore.upsert({
        id: taskId,
        name: t("kb.indexingTask"),
        progress: 0,
        stage: msg,
        status: "stuck",
        backgroundUri: null,
      });
      await taskProgressStore.saveIndex();
      setError(
        msg === "noApiGroup"
          ? t("kb.noApiGroup")
          : msg === "emptyDocument"
            ? t("kb.emptyDocument")
            : t("kb.indexFailed", { reason: msg }),
      );
    } finally {
      setBusy(false);
      setProgress(null);
      void refresh();
    }
  }, [active, refresh]);

  const removeDoc = useCallback(
    (doc: KbDoc) => {
      Alert.alert(t("kb.deleteTitle"), t("kb.deleteConfirm", { name: doc.name }), [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.delete"),
          style: "destructive",
          onPress: () => {
            void knowledgeStore.deleteDoc(doc.id).then(refresh);
          },
        },
      ]);
    },
    [refresh],
  );

  return (
    <Sheet title={t("kb.title")} subtitle={t("kb.subtitle")} onClose={onClose}>
      {error && (
        <View style={[s.error, { marginBottom: 12 }]}>
          <TText style={{ color: colors.danger, fontSize: 13 }}>{error}</TText>
        </View>
      )}
      {busy && progress && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <ActivityIndicator size="small" color={colors.blueDark} />
          <TText style={s.small}>
            {progress.phase === "chunking"
              ? t("kb.progress.chunking")
              : t("kb.progress.embedding", { done: progress.done, total: progress.total })}
          </TText>
        </View>
      )}
      {docs.length === 0 && !busy ? (
        <Empty
          icon={BookOpen}
          title={t("kb.empty")}
          detail={t("kb.emptyDetail")}
          ambientVideo={<SoraAmbient video="idle" slot="knowledge" size={64} />}
        >
          <Button onPress={() => void pickAndIndex()} disabled={busy}>
            {t("kb.upload")}
          </Button>
        </Empty>
      ) : (
        <View style={{ gap: 2 }}>
          {docs.map((doc) => (
            <View
              key={doc.id}
              style={[
                s.between,
                { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.line },
              ]}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
                {doc.status === "indexing" ? (
                  <Loader2 size={18} color={colors.muted} />
                ) : doc.status === "failed" ? (
                  <TriangleAlert size={18} color={colors.danger} />
                ) : (
                  <FileText size={18} color={colors.text} />
                )}
                <View style={{ flex: 1 }}>
                  <TText style={s.text} numberOfLines={1}>
                    {doc.name}
                  </TText>
                  <TText
                    style={[
                      s.small,
                      { color: doc.status === "failed" ? colors.danger : colors.muted },
                    ]}
                  >
                    {statusLabel(doc)}
                  </TText>
                </View>
              </View>
              <Pressable
                onPress={() => removeDoc(doc)}
                hitSlop={12}
                accessibilityLabel={t("common.delete")}
              >
                <Trash2 size={16} color={colors.muted} />
              </Pressable>
            </View>
          ))}
          <View style={{ paddingTop: 14 }}>
            <Button onPress={() => void pickAndIndex()} disabled={busy}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Plus size={16} color={colors.text} />
                <TText style={s.text}>{t("kb.upload")}</TText>
              </View>
            </Button>
            <TText style={[s.small, { color: colors.muted, marginTop: 10, textAlign: "center" }]}>
              {t("kb.formatsNote")}
            </TText>
          </View>
        </View>
      )}
    </Sheet>
  );
}
