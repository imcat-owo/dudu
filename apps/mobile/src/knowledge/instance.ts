/**
 * Knowledge base — store singleton (React Native side).
 *
 * Phase 2: SQLite-backed via expo-sqlite (better for large datasets than
 * AsyncStorage JSON blobs). Migrates existing Phase 1 data on first run.
 * The pure stores stay unit-testable via injection.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SQLite from "expo-sqlite";
import { KnowledgeStore } from "./store";
import { type KbDatabase, SqliteKnowledgeStore } from "./vec-store";

const DB_NAME = "dudu_kb.db";
const MIGRATION_KEY = "dudu.kb.v2.migrated";

function wrapExpoDb(db: SQLite.SQLiteDatabase): KbDatabase {
  type BindValue = string | number | null | Uint8Array;
  const cast = (params?: unknown[]): BindValue[] =>
    (params ?? []).map((p) =>
      typeof p === "string" || typeof p === "number" || p === null || p instanceof Uint8Array
        ? p
        : String(p),
    );
  return {
    runAsync: (sql: string, params?: unknown[]) =>
      db.runAsync(sql, cast(params)) as Promise<unknown>,
    getAllAsync: <T>(sql: string, params?: unknown[]) =>
      db.getAllAsync(sql, cast(params)) as Promise<T[]>,
    getFirstAsync: <T>(sql: string, params?: unknown[]) =>
      db.getFirstAsync(sql, cast(params)) as Promise<T | null>,
  };
}

let storePromise: Promise<SqliteKnowledgeStore> | null = null;

/**
 * Get the SQLite knowledge store, migrating Phase 1 AsyncStorage data
 * on first run. Safe to call multiple times (singleton).
 */
export function getKnowledgeStore(): Promise<SqliteKnowledgeStore> {
  if (!storePromise) {
    storePromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      const store = new SqliteKnowledgeStore(wrapExpoDb(db));
      await migrateIfNeeded(store);
      return store;
    })();
  }
  return storePromise;
}

/**
 * One-time migration: copy docs/chunks from Phase 1 AsyncStorage
 * (KnowledgeStore) into SQLite. Marks completion so it never re-runs.
 * Chunk docIds are remapped to the new doc ids (UI lists by name).
 */
async function migrateIfNeeded(sqlite: SqliteKnowledgeStore): Promise<void> {
  try {
    const done = await AsyncStorage.getItem(MIGRATION_KEY);
    if (done === "1") return;

    const legacy = new KnowledgeStore(AsyncStorage);
    const docs = await legacy.listDocs();
    if (docs.length === 0) {
      await AsyncStorage.setItem(MIGRATION_KEY, "1");
      return;
    }

    for (const doc of docs) {
      const created = await sqlite.addDoc(doc.name, doc.kind, doc.size);
      await sqlite.updateDoc(created.id, {
        chunkCount: doc.chunkCount,
        status: doc.status,
        error: doc.error,
      });
      const chunks = await legacy.listChunks(doc.id);
      if (chunks.length > 0) {
        const remapped = chunks.map((c) => ({ ...c, docId: created.id }));
        await sqlite.putChunks(remapped);
      }
    }

    await AsyncStorage.setItem(MIGRATION_KEY, "1");
  } catch {
    // Migration failure must not break the app — SQLite starts empty,
    // Phase 1 data stays in AsyncStorage untouched.
  }
}

/**
 * Legacy singleton (Phase 1). Prefer getKnowledgeStore() for new code.
 * Kept for API compatibility during the transition.
 */
export const knowledgeStore = new KnowledgeStore(AsyncStorage);
