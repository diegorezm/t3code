import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS t3_objects (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      revision INTEGER NOT NULL,
      node_count INTEGER NOT NULL DEFAULT 0,
      content_json TEXT NOT NULL,
      created_by_thread_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_t3_objects_updated_at
    ON t3_objects (archived_at, updated_at DESC)
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS t3_object_revisions (
      object_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      actor TEXT NOT NULL,
      summary TEXT NOT NULL,
      thread_id TEXT,
      content_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (object_id, revision),
      FOREIGN KEY (object_id) REFERENCES t3_objects (id) ON DELETE CASCADE
    )
  `;
});
