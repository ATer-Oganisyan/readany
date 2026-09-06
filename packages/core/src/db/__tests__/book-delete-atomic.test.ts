import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { IDatabase } from "../../services/platform";

const ports = vi.hoisted(() => ({
  main: null as IDatabase | null,
  local: null as IDatabase | null,
}));
vi.mock("../../services/platform", () => ({
  getPlatformService: () => ({
    isDesktop: false,
    loadDatabase: async (path: string) =>
      path === "readany_local.db" ? ports.local! : ports.main!,
    kvGetItem: async () => "own-device",
    kvSetItem: async () => {},
  }),
}));
const { deleteBook } = await import("../book-queries");
const { initDatabase, closeDB } = await import("../db-core");
let main: DatabaseSync;
let local: DatabaseSync;
const related = ["highlights", "notes", "bookmarks", "book_tags", "reading_sessions"];
function adapter(sqlite: DatabaseSync): IDatabase {
  return {
    async execute(sql, params = []) {
      sqlite.prepare(sql).run(...(params as SQLInputValue[]));
    },
    async select<T>(sql: string, params: unknown[] = []) {
      return sqlite.prepare(sql).all(...(params as SQLInputValue[])) as T[];
    },
    async close() {},
  };
}
function snapshot() {
  return Object.fromEntries(
    ["books", ...related, "threads", "messages", "sync_tombstones"].map((table) => [
      table,
      main.prepare(`SELECT * FROM ${table} ORDER BY id`).all(),
    ]),
  );
}
beforeEach(async () => {
  main = new DatabaseSync(":memory:");
  local = new DatabaseSync(":memory:");
  ports.main = adapter(main);
  ports.local = adapter(local);
  // Actual application DDL and migrations, not a hand-built approximation.
  await initDatabase();
  for (const [id, version, progress] of [
    ["own", 2, 0.63],
    ["other", 7, 0.1],
  ] as const) {
    main
      .prepare(
        "INSERT INTO books (id,file_path,added_at,updated_at,sync_version,last_modified_by,is_vectorized,vectorize_progress,progress) VALUES (?, 'fixture.epub', 10, 20, ?, 'old-device', 1, 1, ?)",
      )
      .run(id, version, progress);
    main
      .prepare("INSERT INTO threads (id,book_id,created_at,updated_at) VALUES (?, ?, 10, 20)")
      .run(`thread-${id}`, id);
    main
      .prepare("INSERT INTO messages (id,thread_id,role,created_at) VALUES (?, ?, 'user', 20)")
      .run(`message-${id}`, `thread-${id}`);
    main
      .prepare(
        "INSERT INTO highlights (id,book_id,cfi,text,created_at,updated_at) VALUES (?,?,'page','own text',10,20)",
      )
      .run(`highlights-${id}`, id);
    main
      .prepare("INSERT INTO notes (id,book_id,created_at,updated_at) VALUES (?,?,10,20)")
      .run(`notes-${id}`, id);
    main
      .prepare(
        "INSERT INTO bookmarks (id,book_id,cfi,created_at,updated_at) VALUES (?,?,'page',10,20)",
      )
      .run(`bookmarks-${id}`, id);
    main.prepare("INSERT INTO tags (id,name) VALUES (?,?)").run(`tag-${id}`, id);
    main
      .prepare("INSERT INTO book_tags (id,book_id,tag_id,updated_at) VALUES (?,?,?,20)")
      .run(`book_tags-${id}`, id, `tag-${id}`);
    main
      .prepare("INSERT INTO reading_sessions (id,book_id,started_at,updated_at) VALUES (?,?,10,20)")
      .run(`reading_sessions-${id}`, id);
    local
      .prepare(
        "INSERT INTO chunks (id,book_id,chapter_index,content,token_count) VALUES (?,?,0,'own text',2)",
      )
      .run(`chunk-${id}`, id);
  }
});
afterEach(async () => {
  await closeDB();
  main.close();
  local.close();
  vi.restoreAllMocks();
});

it.each([false, true])(
  "rolls back all main data when final book mutation fails (soft=%s)",
  async (preserveData) => {
    main.exec(`CREATE TRIGGER fail_final BEFORE ${preserveData ? "UPDATE" : "DELETE"} ON books WHEN OLD.id='own'
    BEGIN SELECT RAISE(ABORT, 'injected final failure'); END;`);
    const before = snapshot();
    await expect(deleteBook("own", { preserveData })).rejects.toThrow("injected final failure");
    expect(snapshot()).toEqual(before);
    expect(local.prepare("SELECT * FROM chunks WHERE book_id='own'").all()).toHaveLength(1);
  },
);

it("commits all hard-delete main rows and tombstones together, retaining other books", async () => {
  await deleteBook("own");
  for (const table of ["books", ...related, "threads", "messages"]) {
    expect(main.prepare(`SELECT * FROM ${table}`).all()).toHaveLength(1);
  }
  const tombstones = main
    .prepare("SELECT table_name FROM sync_tombstones ORDER BY table_name")
    .all();
  expect(tombstones.map((row) => row.table_name)).toEqual(
    ["books", ...related, "messages", "threads"].sort(),
  );
  expect(local.prepare("SELECT id,book_id FROM chunks").all()).toEqual([
    { id: "chunk-other", book_id: "other" },
  ]);
});

it("soft-delete preserves personal records and progress, removes only own chat and chunks", async () => {
  await deleteBook("own", { preserveData: true });
  expect(main.prepare("SELECT * FROM books WHERE id='own'").get()).toMatchObject({
    progress: 0.63,
    is_vectorized: 0,
    vectorize_progress: 0,
    sync_version: 8,
    last_modified_by: "own-device",
  });
  expect(main.prepare("SELECT deleted_at FROM books WHERE id='own'").get()?.deleted_at).toEqual(
    expect.any(Number),
  );
  for (const table of related) expect(main.prepare(`SELECT * FROM ${table}`).all()).toHaveLength(2);
  expect(main.prepare("SELECT table_name FROM sync_tombstones ORDER BY table_name").all()).toEqual([
    { table_name: "messages" },
    { table_name: "threads" },
  ]);
});

it("does not report committed main deletion as failed when local chunk cleanup fails", async () => {
  local.exec(
    "CREATE TRIGGER fail_chunks BEFORE DELETE ON chunks BEGIN SELECT RAISE(ABORT, 'cleanup unavailable'); END;",
  );
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await expect(deleteBook("own")).resolves.toBeUndefined();
  expect(main.prepare("SELECT * FROM books WHERE id='own'").all()).toEqual([]);
  expect(local.prepare("SELECT * FROM chunks WHERE book_id='own'").all()).toHaveLength(1);
});

it.each(["tombstone", "messages", "notes"])(
  "rolls back on %s failure and permits an explicit retry",
  async (failure) => {
    main.exec(
      failure === "tombstone"
        ? "CREATE TRIGGER fail_write BEFORE INSERT ON sync_tombstones BEGIN SELECT RAISE(ABORT, 'injected failure'); END;"
        : `CREATE TRIGGER fail_write BEFORE DELETE ON ${failure} BEGIN SELECT RAISE(ABORT, 'injected failure'); END;`,
    );
    const before = snapshot();
    await expect(deleteBook("own")).rejects.toThrow("injected failure");
    expect(snapshot()).toEqual(before);
    expect(main.prepare("SELECT * FROM book_delete_commands").all()).toEqual([]);
    main.exec("DROP TRIGGER fail_write");
    await deleteBook("own");
    expect(main.prepare("SELECT * FROM books WHERE id='own'").all()).toEqual([]);
  },
);

it("does not advance hard-delete tombstones on absent-id retry or direct remote deletion", async () => {
  await deleteBook("own");
  const before = snapshot();
  await deleteBook("own");
  expect(snapshot()).toEqual(before);
  main.exec("DELETE FROM books WHERE id='other'");
  expect(main.prepare("SELECT * FROM sync_tombstones WHERE id='other'").all()).toEqual([]);
});

it("retries failed command initialization without losing any main records", async () => {
  main.exec("PRAGMA query_only=ON");
  const before = snapshot();
  await expect(deleteBook("own")).rejects.toThrow();
  expect(snapshot()).toEqual(before);
  main.exec("PRAGMA query_only=OFF");
  await deleteBook("own");
  expect(main.prepare("SELECT * FROM books WHERE id='own'").all()).toEqual([]);
});

it("keeps deletion timestamps ahead of future observed rows and tombstones", async () => {
  main.exec(
    "UPDATE books SET updated_at=9000000000000 WHERE id='own'; INSERT INTO sync_tombstones VALUES ('own', 'books', 9100000000000, 'remote');",
  );
  await deleteBook("own");
  expect(
    main.prepare("SELECT deleted_at FROM sync_tombstones WHERE id='own'").get()?.deleted_at,
  ).toBe(9100000000001);
});

it("uses the real messages created_at column as its deletion timestamp floor", async () => {
  const columns = main
    .prepare("PRAGMA table_info(messages)")
    .all()
    .map((column) => column.name);
  expect(columns).not.toContain("updated_at");
  main.exec("UPDATE messages SET created_at=9000000000000 WHERE id='message-own'");
  await deleteBook("own", { preserveData: true });
  expect(
    main
      .prepare(
        "SELECT deleted_at FROM sync_tombstones WHERE id='message-own' AND table_name='messages'",
      )
      .get()?.deleted_at,
  ).toBe(9000000000001);
  expect(main.prepare("SELECT id FROM tags ORDER BY id").all()).toEqual([
    { id: "tag-other" },
    { id: "tag-own" },
  ]);
});
