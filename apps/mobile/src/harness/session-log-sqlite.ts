/**
 * Harness Phase 1 — SQLite backend for the append-only session log.
 *
 * expo-sqlite is imported ONLY in this file (same rule as
 * knowledge/instance.ts): the pure log core in session-log.ts stays
 * unit-testable in plain node.
 *
 * Schema: one append-only table. No UPDATE/DELETE of events — the only
 * delete path is whole-session hygiene (deleteSession), user-initiated.
 */

import * as SQLite from "expo-sqlite";
import type { NewSessionEvent, SessionEvent, SessionLogBackend } from "./session-log";

const DB_NAME = "dudu_session_log.db";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS session_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  turn_id TEXT,
  step_id TEXT,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_events_session
  ON session_events (session_id, seq);
`;

type Row = {
  seq: number;
  session_id: string;
  turn_id: string | null;
  step_id: string | null;
  type: string;
  payload: string;
  created_at: number;
};

function rowToEvent(r: Row): SessionEvent {
  return {
    seq: r.seq,
    sessionId: r.session_id,
    turnId: r.turn_id ?? undefined,
    stepId: r.step_id ?? undefined,
    type: r.type as SessionEvent["type"],
    payload: r.payload,
    createdAt: r.created_at,
  };
}

export function createSqliteSessionLogBackend(db: SQLite.SQLiteDatabase): SessionLogBackend {
  return {
    async append(e: NewSessionEvent): Promise<number> {
      const res = await db.runAsync(
        `INSERT INTO session_events
           (session_id, turn_id, step_id, type, payload, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          e.sessionId,
          e.turnId ?? null,
          e.stepId ?? null,
          e.type,
          e.payload,
          e.createdAt ?? Date.now(),
        ],
      );
      return Number(res.lastInsertRowId);
    },
    async read(sessionId: string, fromSeq = 0): Promise<SessionEvent[]> {
      const rows = await db.getAllAsync<Row>(
        `SELECT seq, session_id, turn_id, step_id, type, payload, created_at
           FROM session_events
          WHERE session_id = ? AND seq >= ?
          ORDER BY seq ASC`,
        [sessionId, fromSeq],
      );
      return rows.map(rowToEvent);
    },
    async latestSeq(sessionId: string): Promise<number> {
      const row = await db.getFirstAsync<{ m: number | null }>(
        `SELECT MAX(seq) AS m FROM session_events WHERE session_id = ?`,
        [sessionId],
      );
      return row?.m ?? 0;
    },
    async deleteSession(sessionId: string): Promise<void> {
      await db.runAsync(`DELETE FROM session_events WHERE session_id = ?`, [sessionId]);
    },
  };
}

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/** Open (and migrate) the session-log database. Singleton, safe to call often. */
export function getSessionLogDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      try {
        const db = await SQLite.openDatabaseAsync(DB_NAME);
        await db.execAsync(SCHEMA);
        return db;
      } catch (e) {
        // Don't cache the rejection — retry next call (same rule as the
        // knowledge store: a transient lock must not permanently kill logging).
        dbPromise = null;
        throw e;
      }
    })();
  }
  return dbPromise;
}
