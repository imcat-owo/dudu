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
import {
  BookOpen,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  TriangleAlert,
} from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, View } from "react-native";
import { useApiGroups } from "../api-groups/store";
import { TText } from "../font";
import { t } from "../i18n";
import { taskProgressStore } from "../our-space/task-progress-instance";
import { SoraAmbient } from "../sora-ambient";
import { Button, Empty, Sheet, useColors, useStyles } from "../ui";
import { healInterruptedDocs, type IndexProgress, indexDocument, reindexDocument } from "./indexer";
import { getKnowledgeStore } from "./instance";
import { PdfTextExtractor } from "./pdf-extract";
import type { KbDoc } from "./store";
import type { SqliteKnowledgeStore } from "./vec-store";

const SUPPORTED_EXT = /\.(txt|md|markdown|pdf)$/i;
const UNSUPPORTED_EXT = /\.(docx?|pptx?|xlsx?)$/i;

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
  const [, setStore] = useState<SqliteKnowledgeStore | null>(null);
  // PDF extraction state: when set, renders a hidden PdfTextExtractor.
  const [pdfJob, setPdfJob] = useState<{
    uri: string;
    name: string;
    size: number;
    taskId: string;
  } | null>(null);

  const refresh = useCallback(async () => {
    const s = await getKnowledgeStore();
    setStore(s);
    setDocs(await s.listDocs());
  }, []);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    let cancelled = false;
    void getKnowledgeStore().then((s) => {
      if (cancelled) return;
      setStore(s);
      // Self-healing: docs left "indexing" by a crashed session would spin
      // forever — mark the stale ones failed (recent ones might still be
      // indexing right now, so those are left alone).
      void healInterruptedDocs(s).then((healed) => {
        if (healed > 0) void s.listDocs().then(setDocs);
      });
      unsub = s.subscribe(() => {
        void s.listDocs().then(setDocs);
      });
      void s.listDocs().then(setDocs);
    });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, []);

  const pickAndIndex = useCallback(async () => {
    setError(null);
    const res = await DocumentPicker.getDocumentAsync({
      type: [
        "text/plain",
        "text/markdown",
        "application/pdf",
        "*.txt",
        "*.md",
        "*.markdown",
        "*.pdf",
      ],
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
    const isPdf = /\.pdf$/i.test(name);
    const taskId = `kb-index-${Date.now()}`;
    if (isPdf) {
      // PDF text extraction happens in a hidden WebView (see pdfJob below).
      setBusy(true);
      setPdfJob({ uri: asset.uri, name, size: asset.size ?? 0, taskId });
      return;
    }
    setBusy(true);
    try {
      const text = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      const kind = /\.md$/i.test(name) ? "md" : "txt";
      await indexTextAsset(name, kind, asset.size ?? text.length, text, taskId);
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
      setError(t("kb.indexFailed", { reason: msg }));
    } finally {
      setBusy(false);
      setProgress(null);
      void refresh();
    }
  }, [active, refresh]);

  /** Shared indexing pipeline for extracted text (txt/md/pdf). */
  const indexTextAsset = useCallback(
    async (
      name: string,
      kind: "txt" | "md" | "pdf",
      size: number,
      text: string,
      taskId: string,
    ) => {
      const s = await getKnowledgeStore();
      const doc = await s.addDoc(name, kind, size);
      await taskProgressStore.upsert({
        id: taskId,
        name: t("kb.indexingTask"),
        progress: 0,
        stage: "",
        status: "running",
        backgroundUri: null,
      });
      await taskProgressStore.saveIndex();
      try {
        await indexDocument(s, active, doc.id, text, kind === "md", {
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
      } catch (e) {
        // Embedding/storage failed mid-index: the doc is already marked
        // failed by indexDocument — make sure the task card doesn't stay
        // "running" forever either.
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
        throw e;
      }
      await taskProgressStore.upsert({
        id: taskId,
        name: t("kb.indexingTask"),
        progress: 1,
        stage: t("kb.indexingDone"),
        status: "done",
        backgroundUri: null,
      });
      await taskProgressStore.saveIndex();
    },
    [active],
  );

  /** PDF extraction completed in the hidden WebView — now index the text. */
  const handlePdfDone = useCallback(
    async (text: string) => {
      const job = pdfJob;
      setPdfJob(null);
      if (!job) return;
      if (!text.trim()) {
        setError(t("kb.emptyDocument"));
        setBusy(false);
        return;
      }
      try {
        await indexTextAsset(job.name, "pdf", job.size || text.length, text, job.taskId);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
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
    },
    [pdfJob, indexTextAsset, refresh],
  );

  const handlePdfError = useCallback(
    (message: string, taskId?: string) => {
      setPdfJob(null);
      setBusy(false);
      const reason =
        message === "timeout"
          ? t("kb.pdfExtractTimeout")
          : message === "pdfJsLoadTimeout"
            ? t("kb.pdfJsLoadTimeout")
            : message;
      setError(t("kb.pdfExtractFailed", { reason }));
      // PDF extraction failed before indexing even started: don't leave
      // the task card spinning "running" forever.
      if (taskId) {
        void taskProgressStore
          .upsert({
            id: taskId,
            name: t("kb.indexingTask"),
            progress: 0,
            stage: reason,
            status: "stuck",
            backgroundUri: null,
          })
          .then(() => taskProgressStore.saveIndex());
      }
      void refresh();
    },
    [refresh],
  );

  const removeDoc = useCallback(
    (doc: KbDoc) => {
      Alert.alert(t("kb.deleteTitle"), t("kb.deleteConfirm", { name: doc.name }), [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.delete"),
          style: "destructive",
          onPress: () => {
            void getKnowledgeStore()
              .then((s) => s.deleteDoc(doc.id))
              .then(refresh);
          },
        },
      ]);
    },
    [refresh],
  );

  /** Re-embed a doc's paragraphs with the current embedding model. */
  const reindexDoc = useCallback(
    async (doc: KbDoc) => {
      if (!active) {
        setError(t("kb.noApiGroup"));
        return;
      }
      const taskId = `kb-reindex-${Date.now()}`;
      setBusy(true);
      setError(null);
      try {
        const s = await getKnowledgeStore();
        await taskProgressStore.upsert({
          id: taskId,
          name: t("kb.indexingTask"),
          progress: 0,
          stage: "",
          status: "running",
          backgroundUri: null,
        });
        await taskProgressStore.saveIndex();
        await reindexDocument(s, active, doc.id, {
          onProgress: (p) => {
            const total = Math.max(1, p.total);
            void taskProgressStore.upsert({
              id: taskId,
              name: t("kb.indexingTask"),
              progress: p.done / total,
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
        setError(t("kb.indexFailed", { reason: msg }));
      } finally {
        setBusy(false);
        setProgress(null);
        void refresh();
      }
    },
    [active, refresh],
  );

  return (
    <Sheet title={t("kb.title")} subtitle={t("kb.subtitle")} onClose={onClose}>
      {pdfJob && (
        <PdfTextExtractor
          uri={pdfJob.uri}
          onDone={(text) => {
            void handlePdfDone(text);
          }}
          onError={(message) => {
            void handlePdfError(message, pdfJob.taskId);
          }}
        />
      )}
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
                onPress={() => void reindexDoc(doc)}
                hitSlop={12}
                accessibilityLabel={t("kb.reindex")}
                disabled={busy || doc.status === "indexing"}
              >
                <RefreshCw
                  size={16}
                  color={busy || doc.status === "indexing" ? colors.line : colors.muted}
                />
              </Pressable>
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
