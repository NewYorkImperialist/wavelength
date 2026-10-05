import "server-only";

import { randomUUID } from "node:crypto";
import type { SQLInputValue } from "node:sqlite";

import { SPECTRUM_DECK } from "@/lib/game/deck";

import { database, transaction } from "../../../server/database.mjs";

/**
 * Typed access to the SQLite database.
 *
 * The server is the only thing that touches it, so every caller is
 * responsible for its own authorization — see `guards.ts`. Every helper here
 * is synchronous; see `transaction` for why that matters.
 */

export { transaction };

/** Per connection, since tests open a fresh database per file. */
const deckSynced = new WeakSet<object>();

function db() {
  const handle = database();
  if (!deckSynced.has(handle)) {
    deckSynced.add(handle);
    syncDeck();
  }
  return handle;
}

/**
 * Make `spectrum_cards` match `deck.ts`. Cards that leave the deck are
 * disabled rather than deleted, because past rounds still reference them.
 */
function syncDeck(): void {
  transaction(() => {
    const handle = database();
    handle.exec("update spectrum_cards set enabled = 0");
    const upsert = handle.prepare(
      `insert into spectrum_cards (id, left_label, right_label, enabled)
       values (?, ?, ?, 1)
       on conflict (id) do update set
         left_label = excluded.left_label,
         right_label = excluded.right_label,
         enabled = 1`,
    );
    for (const card of SPECTRUM_DECK) upsert.run(card.id, card.left, card.right);
  });
}

/** First matching row, or null. */
export function one<T>(sql: string, ...params: SQLInputValue[]): T | null {
  return (db().prepare(sql).get(...params) as T | undefined) ?? null;
}

export function all<T>(sql: string, ...params: SQLInputValue[]): T[] {
  return db().prepare(sql).all(...params) as T[];
}

/** Run a write and report how many rows it touched. */
export function run(sql: string, ...params: SQLInputValue[]): number {
  return Number(db().prepare(sql).run(...params).changes);
}

export const newId = (): string => randomUUID();

export const nowIso = (): string => new Date().toISOString();

/** True when `error` is SQLite rejecting a duplicate key. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    /UNIQUE constraint failed|PRIMARY KEY constraint failed/.test(error.message)
  );
}
