/**
 * The SQLite database: one file, one connection, one process.
 *
 * Plain JavaScript rather than TypeScript because two module graphs load it:
 * the custom server (`server/index.mjs`, which Node runs directly, unbundled)
 * and the Next bundle (through `src/lib/server/db.ts`). The connection lives
 * on `globalThis` so both end up sharing it rather than opening two.
 *
 * Node's built-in `node:sqlite` is synchronous. That is a feature here: a
 * transaction that contains no `await` cannot interleave with another
 * request, so every race the old Postgres code fenced with conditional
 * updates is closed by construction.
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { MIGRATIONS } from "./schema.mjs";

/** @returns {string} */
export function databasePath() {
  const configured = process.env.DATABASE_PATH;
  if (configured !== undefined && configured !== "") return configured;
  return join(process.cwd(), "data", "wavelength.db");
}

/**
 * @typedef {{ db: DatabaseSync, path: string }} DatabaseHandle
 */

const KEY = Symbol.for("wavelength.database");

/** @returns {DatabaseSync} */
export function database() {
  /** @type {Record<symbol, DatabaseHandle | undefined>} */
  const store = /** @type {any} */ (globalThis);
  const path = databasePath();

  const existing = store[KEY];
  // Tests switch DATABASE_PATH between files; follow them.
  if (existing !== undefined && existing.path === path) return existing.db;
  existing?.db.close();

  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);

  // WAL lets a reader proceed while a write commits, and survives a crash
  // mid-write without corrupting the file.
  db.exec("pragma journal_mode = wal");
  db.exec("pragma synchronous = normal");
  db.exec("pragma foreign_keys = on");
  db.exec("pragma busy_timeout = 5000");

  migrate(db);

  store[KEY] = { db, path };
  return db;
}

/**
 * Apply any migrations past the file's `user_version`, each in its own
 * transaction. Append new migrations to MIGRATIONS; never edit a shipped one.
 *
 * @param {DatabaseSync} db
 */
function migrate(db) {
  const row = /** @type {{ user_version: number }} */ (db.prepare("pragma user_version").get());
  for (let version = row.user_version; version < MIGRATIONS.length; version++) {
    db.exec("begin immediate");
    try {
      db.exec(/** @type {string} */ (MIGRATIONS[version]));
      db.exec(`pragma user_version = ${version + 1}`);
      db.exec("commit");
    } catch (error) {
      db.exec("rollback");
      throw error;
    }
  }
}

/**
 * Run `fn` inside a write transaction. `fn` must be synchronous — an `await`
 * inside would let another request's statements land mid-transaction.
 *
 * A call nested inside another simply joins the outer transaction, so helpers
 * can be transactional on their own and still compose.
 *
 * @template T
 * @param {() => T} fn
 * @returns {T}
 */
export function transaction(fn) {
  const db = database();
  if (db.isTransaction) return fn();
  db.exec("begin immediate");
  try {
    const result = fn();
    db.exec("commit");
    return result;
  } catch (error) {
    db.exec("rollback");
    throw error;
  }
}
