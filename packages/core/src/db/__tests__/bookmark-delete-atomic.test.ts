import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { IDatabase } from "../../services/platform";
import { deleteBookmarkAtomically } from "../bookmark-delete-command";

let sqlite: DatabaseSync;
let database: IDatabase;
const schema = `
  CREATE TABLE bookmarks (id TEXT PRIMARY KEY, book_id TEXT NOT NULL,
    cfi TEXT NOT NULL, label TEXT, chapter_title TEXT, created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT 0, sync_version INTEGER DEFAULT 0,
    last_modified_by TEXT DEFAULT '');
  CREATE TABLE sync_tombstones (id TEXT NOT NULL, table_name TEXT NOT NULL,
    deleted_at INTEGER NOT NULL, device_id TEXT NOT NULL, PRIMARY KEY(id, table_name));
  INSERT INTO bookmarks (id, book_id, cfi, created_at, updated_at)
    VALUES ('saved', 'book', 'page', 10, 10);
`;
function adapter(connection: DatabaseSync): IDatabase {
  return {
    async execute(sql, params = []) {
      connection.prepare(sql).run(...(params as SQLInputValue[]));
    },
    async select<T>(sql: string, params: unknown[] = []) {
      return connection.prepare(sql).all(...(params as SQLInputValue[])) as T[];
    },
    async close() {
      connection.close();
    },
  };
}
function rows(table: string) {
  return sqlite.prepare(`SELECT * FROM ${table}`).all();
}
beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(schema);
  database = adapter(sqlite);
});
afterEach(() => sqlite.close());

it("commits deletion and its sync tombstone together", async () => {
  await deleteBookmarkAtomically(database, "saved", "device", 100);
  expect(rows("bookmarks")).toEqual([]);
  expect(rows("sync_tombstones")).toEqual([
    { id: "saved", table_name: "bookmarks", deleted_at: 100, device_id: "device" },
  ]);
  expect(rows("bookmark_delete_commands")).toEqual([]);
});
it("rolls back the tombstone when deletion fails", async () => {
  sqlite.exec(
    "CREATE TRIGGER fail_delete BEFORE DELETE ON bookmarks BEGIN SELECT RAISE(ABORT, 'delete failed'); END",
  );
  await expect(deleteBookmarkAtomically(database, "saved", "device", 100)).rejects.toThrow(
    "delete failed",
  );
  expect(rows("bookmarks")).toHaveLength(1);
  expect(rows("sync_tombstones")).toEqual([]);
  expect(rows("bookmark_delete_commands")).toEqual([]);
});
it("preserves the bookmark when tombstone persistence fails", async () => {
  sqlite.exec(
    "CREATE TRIGGER fail_tombstone BEFORE INSERT ON sync_tombstones BEGIN SELECT RAISE(ABORT, 'tombstone failed'); END",
  );
  await expect(deleteBookmarkAtomically(database, "saved", "device", 100)).rejects.toThrow(
    "tombstone failed",
  );
  expect(rows("bookmarks")).toHaveLength(1);
  expect(rows("sync_tombstones")).toEqual([]);
  expect(rows("bookmark_delete_commands")).toEqual([]);
  sqlite.exec("DROP TRIGGER fail_tombstone");
  await deleteBookmarkAtomically(database, "saved", "device", 100);
  expect(rows("bookmarks")).toEqual([]);
});
it("does not advance the timestamp on an absent-id retry", async () => {
  await deleteBookmarkAtomically(database, "saved", "device", 100);
  await deleteBookmarkAtomically(database, "saved", "other", 1000);
  await deleteBookmarkAtomically(database, "never-existed", "device", 1000);
  expect(rows("sync_tombstones")).toEqual([
    { id: "saved", table_name: "bookmarks", deleted_at: 100, device_id: "device" },
  ]);
  expect(rows("bookmark_delete_commands")).toEqual([]);
});
it("deletion wins over already-observed future timestamps", async () => {
  sqlite.exec(
    "UPDATE bookmarks SET updated_at = 500; INSERT INTO sync_tombstones VALUES ('saved', 'bookmarks', 700, 'old')",
  );
  await deleteBookmarkAtomically(database, "saved", "device", 100);
  expect(rows("sync_tombstones")[0].deleted_at).toBe(701);
});
it("does not change the timestamp of a remote direct deletion", async () => {
  await deleteBookmarkAtomically(database, "absent", "device", 100);
  // The sync apply path deletes directly, then remembers the remote timestamp.
  sqlite.exec(
    "DELETE FROM bookmarks WHERE id = 'saved'; INSERT INTO sync_tombstones VALUES ('saved', 'bookmarks', 30, 'remote')",
  );
  expect(rows("sync_tombstones")[0]).toMatchObject({ deleted_at: 30, device_id: "remote" });
});
it("migration errors reject without deleting and can be retried", async () => {
  sqlite.exec("PRAGMA query_only = ON");
  await expect(deleteBookmarkAtomically(database, "saved", "device", 100)).rejects.toThrow();
  expect(rows("bookmarks")).toHaveLength(1);
  sqlite.exec("PRAGMA query_only = OFF");
  await deleteBookmarkAtomically(database, "saved", "device", 100);
  expect(rows("bookmarks")).toEqual([]);
});
it("keeps a second connection's unrelated writes outside a failed deletion", async () => {
  const directory = mkdtempSync(join(tmpdir(), "narra-bookmark-atomic-"));
  const first = new DatabaseSync(join(directory, "test.sqlite"));
  const second = new DatabaseSync(join(directory, "test.sqlite"));
  try {
    first.exec(
      `${schema} CREATE TABLE unrelated (id TEXT PRIMARY KEY); INSERT INTO unrelated VALUES ('before');`,
    );
    second.exec("PRAGMA busy_timeout = 0");
    let blocked = false;
    first.function("probe_other_writer", () => {
      try {
        second.prepare("INSERT INTO unrelated VALUES ('during')").run();
      } catch (error) {
        blocked = String(error).includes("locked");
      }
      return 0;
    });
    first.exec(
      "CREATE TRIGGER fail_delete BEFORE DELETE ON bookmarks BEGIN SELECT probe_other_writer(); SELECT RAISE(ABORT, 'delete failed'); END",
    );
    await expect(deleteBookmarkAtomically(adapter(first), "saved", "device", 100)).rejects.toThrow(
      "delete failed",
    );
    expect(blocked).toBe(true);
    second.prepare("INSERT INTO unrelated VALUES ('after')").run();
    expect(second.prepare("SELECT id FROM unrelated ORDER BY id").all()).toEqual([
      { id: "after" },
      { id: "before" },
    ]);
    expect(second.prepare("SELECT id FROM bookmarks").all()).toEqual([{ id: "saved" }]);
    expect(second.prepare("SELECT * FROM sync_tombstones").all()).toEqual([]);
  } finally {
    second.close();
    first.close();
    rmSync(directory, { recursive: true });
  }
});
