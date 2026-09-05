import type { IDatabase } from "../services/platform";

const initialized = new WeakMap<IDatabase, Promise<void>>();

// Only fixed identifiers enter this SQL generator. Each tombstone must commit
// with its deletion; unlike legacy insertTombstone, errors are not swallowed.
function tombstones(table: string, where: string, timestamp = "updated_at"): string {
  return `INSERT OR REPLACE INTO sync_tombstones (id, table_name, deleted_at, device_id)
    SELECT source.id, '${table}',
      MAX(NEW.deleted_at, COALESCE(source.${timestamp}, 0) + 1,
        COALESCE((SELECT deleted_at FROM sync_tombstones
          WHERE id = source.id AND table_name = '${table}'), 0) + 1), NEW.device_id
    FROM ${table} AS source WHERE ${where};`;
}

/** A local-only command trigger keeps all main-DB changes in one SQLite
 * statement, without assuming that separate execute calls share a transaction.
 * No trigger is attached to books: remote sync retains its deletion semantics.
 * Derived chunks live in a different database and are intentionally excluded.
 */
export async function deleteBookAtomically(
  database: IDatabase,
  id: string,
  preserveData: boolean,
  deviceId: string,
  deletedAt: number,
): Promise<void> {
  let ready = initialized.get(database);
  if (!ready) {
    ready = (async () => {
      await database.execute(`CREATE TABLE IF NOT EXISTS book_delete_commands (
        id TEXT PRIMARY KEY NOT NULL,
        preserve_data INTEGER NOT NULL CHECK (preserve_data IN (0, 1)),
        deleted_at INTEGER NOT NULL,
        device_id TEXT NOT NULL
      )`);
      await database.execute(`CREATE TRIGGER IF NOT EXISTS book_delete_command_v1
        AFTER INSERT ON book_delete_commands
        BEGIN
          ${tombstones("messages", "source.thread_id IN (SELECT id FROM threads WHERE book_id = NEW.id)", "created_at")}
          ${tombstones("threads", "source.book_id = NEW.id")}
          ${["highlights", "notes", "bookmarks", "book_tags", "reading_sessions"]
            .map((table) => tombstones(table, "source.book_id = NEW.id AND NEW.preserve_data = 0"))
            .join("\n")}
          ${tombstones("books", "source.id = NEW.id AND NEW.preserve_data = 0")}
          DELETE FROM messages WHERE thread_id IN (SELECT id FROM threads WHERE book_id = NEW.id);
          DELETE FROM threads WHERE book_id = NEW.id;
          DELETE FROM highlights WHERE book_id = NEW.id AND NEW.preserve_data = 0;
          DELETE FROM notes WHERE book_id = NEW.id AND NEW.preserve_data = 0;
          DELETE FROM bookmarks WHERE book_id = NEW.id AND NEW.preserve_data = 0;
          DELETE FROM book_tags WHERE book_id = NEW.id AND NEW.preserve_data = 0;
          DELETE FROM reading_sessions WHERE book_id = NEW.id AND NEW.preserve_data = 0;
          UPDATE books SET deleted_at = NEW.deleted_at, is_vectorized = 0, vectorize_progress = 0,
            updated_at = MAX(NEW.deleted_at, COALESCE(updated_at, 0) + 1),
            sync_version = (SELECT COALESCE(MAX(sync_version), 0) + 1 FROM books),
            last_modified_by = NEW.device_id
          WHERE id = NEW.id AND NEW.preserve_data = 1;
          DELETE FROM books WHERE id = NEW.id AND NEW.preserve_data = 0;
          DELETE FROM book_delete_commands WHERE id = NEW.id;
        END`);
    })();
    initialized.set(database, ready);
    void ready.catch(() => initialized.delete(database));
  }
  await ready;
  await database.execute(
    "INSERT INTO book_delete_commands (id, preserve_data, deleted_at, device_id) VALUES (?, ?, ?, ?)",
    [id, preserveData ? 1 : 0, deletedAt, deviceId],
  );
}
