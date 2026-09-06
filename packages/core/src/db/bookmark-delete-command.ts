import type { IDatabase } from "../services/platform";

const initialized = new WeakMap<IDatabase, Promise<void>>();

/** A single SQLite statement owns both writes, including on pooled adapters.
 * This command table is deliberately absent from the sync table whitelist.
 * Do not put the trigger on bookmarks: remote sync deletes must keep their
 * original timestamp instead of producing a new local deletion.
 */
export async function deleteBookmarkAtomically(
  database: IDatabase,
  id: string,
  deviceId: string,
  deletedAt: number,
): Promise<void> {
  let ready = initialized.get(database);
  if (!ready) {
    ready = (async () => {
      await database.execute(`CREATE TABLE IF NOT EXISTS bookmark_delete_commands (
        id TEXT PRIMARY KEY NOT NULL,
        deleted_at INTEGER NOT NULL,
        device_id TEXT NOT NULL
      )`);
      await database.execute(`CREATE TRIGGER IF NOT EXISTS bookmark_delete_command_v1
        AFTER INSERT ON bookmark_delete_commands
        BEGIN
          INSERT OR REPLACE INTO sync_tombstones (id, table_name, deleted_at, device_id)
          SELECT NEW.id, 'bookmarks',
            MAX(NEW.deleted_at, COALESCE(bookmarks.updated_at, 0) + 1,
              COALESCE((SELECT deleted_at FROM sync_tombstones
                WHERE id = NEW.id AND table_name = 'bookmarks'), 0) + 1),
            NEW.device_id
          FROM bookmarks WHERE id = NEW.id;
          DELETE FROM bookmarks WHERE id = NEW.id;
          DELETE FROM bookmark_delete_commands WHERE id = NEW.id;
        END`);
    })();
    initialized.set(database, ready);
    // A failed migration must reject the caller and remain retryable.
    void ready.catch(() => initialized.delete(database));
  }
  await ready;
  await database.execute(
    "INSERT INTO bookmark_delete_commands (id, deleted_at, device_id) VALUES (?, ?, ?)",
    [id, deletedAt, deviceId],
  );
}
