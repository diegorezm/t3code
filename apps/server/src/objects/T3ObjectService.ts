import {
  DesignNodeId,
  T3ObjectContent,
  T3ObjectError,
  T3ObjectId,
  emptyDesignDocument,
  type T3Object,
  type T3ObjectActor,
  type T3ObjectCreateInput,
  type T3ObjectDeleteInput,
  type T3ObjectDeleteResult,
  type T3ObjectKind,
  type T3ObjectListInput,
  type T3ObjectListResult,
  type T3ObjectListRevisionsInput,
  type T3ObjectListRevisionsResult,
  type T3ObjectMutateDesignInput,
  type T3ObjectMutationResult,
  type T3ObjectReadInput,
  type T3ObjectReadResult,
  type T3ObjectReadRevisionInput,
  type T3ObjectReadRevisionResult,
  type T3ObjectRenameInput,
  type T3ObjectReplaceDesignInput,
  type T3ObjectRestoreRevisionInput,
  type T3ObjectRevision,
  type T3ObjectRevisionSummary,
  type T3ObjectSetArchivedInput,
  type T3ObjectStreamEvent,
  type T3ObjectSubscribeInput,
  type T3ObjectSummary,
  type ThreadId,
} from "@t3tools/contracts";
import {
  applyDesignMutations,
  countDesignNodes,
  validateDesignDocument,
} from "@t3tools/shared/designDocument";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

const MAX_REVISIONS_PER_OBJECT = 100;
const DEFAULT_REVISION_LIST_LIMIT = 50;

const T3ObjectContentJson = Schema.fromJsonString(T3ObjectContent);
const decodeContentJson = Schema.decodeUnknownEffect(T3ObjectContentJson);
const encodeContentJson = Schema.encodeUnknownEffect(T3ObjectContentJson);
const isT3ObjectError = Schema.is(T3ObjectError);

interface ObjectRow {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly revision: number;
  readonly node_count: number;
  readonly content_json: string;
  readonly created_by_thread_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly archived_at: string | null;
}

interface ObjectSummaryRow {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly revision: number;
  readonly node_count: number;
  readonly created_by_thread_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly archived_at: string | null;
}

interface RevisionSummaryRow {
  readonly object_id: string;
  readonly revision: number;
  readonly actor: string;
  readonly summary: string;
  readonly thread_id: string | null;
  readonly created_at: string;
}

interface RevisionRow extends RevisionSummaryRow {
  readonly content_json: string;
}

function toSummary(row: ObjectSummaryRow): T3ObjectSummary {
  return {
    id: T3ObjectId.make(row.id),
    kind: row.kind as T3ObjectKind,
    title: row.title,
    revision: row.revision,
    nodeCount: row.node_count,
    createdByThreadId: row.created_by_thread_id as ThreadId | null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

function toRevisionSummary(row: RevisionSummaryRow): T3ObjectRevisionSummary {
  return {
    objectId: T3ObjectId.make(row.object_id),
    revision: row.revision,
    actor: row.actor as T3ObjectActor,
    summary: row.summary,
    threadId: row.thread_id as ThreadId | null,
    createdAt: row.created_at,
  };
}

function mapStorageError(message: string, objectId?: T3ObjectId) {
  return (error: unknown): T3ObjectError =>
    isT3ObjectError(error)
      ? error
      : new T3ObjectError({
          code: "storage_error",
          message,
          ...(objectId !== undefined ? { objectId } : {}),
        });
}

function notFoundError(objectId: T3ObjectId): T3ObjectError {
  return new T3ObjectError({
    code: "not_found",
    message: `Object "${objectId}" does not exist.`,
    objectId,
  });
}

function nowIso(): Effect.Effect<string> {
  return DateTime.now.pipe(Effect.map((now) => DateTime.formatIso(DateTime.toUtc(now))));
}

function countContentNodes(content: T3ObjectContent): number {
  switch (content.kind) {
    case "design":
      return countDesignNodes(content.document);
  }
}

export class T3ObjectService extends Context.Service<
  T3ObjectService,
  {
    readonly list: (input?: T3ObjectListInput) => Effect.Effect<T3ObjectListResult, T3ObjectError>;
    readonly read: (input: T3ObjectReadInput) => Effect.Effect<T3ObjectReadResult, T3ObjectError>;
    readonly create: (
      input: T3ObjectCreateInput & { readonly actor?: T3ObjectActor },
    ) => Effect.Effect<T3ObjectMutationResult, T3ObjectError>;
    readonly rename: (
      input: T3ObjectRenameInput,
    ) => Effect.Effect<T3ObjectReadResult, T3ObjectError>;
    readonly setArchived: (
      input: T3ObjectSetArchivedInput,
    ) => Effect.Effect<T3ObjectReadResult, T3ObjectError>;
    readonly delete: (
      input: T3ObjectDeleteInput,
    ) => Effect.Effect<T3ObjectDeleteResult, T3ObjectError>;
    readonly mutateDesign: (
      input: T3ObjectMutateDesignInput & { readonly actor?: T3ObjectActor },
    ) => Effect.Effect<T3ObjectMutationResult, T3ObjectError>;
    readonly replaceDesign: (
      input: T3ObjectReplaceDesignInput & { readonly actor?: T3ObjectActor },
    ) => Effect.Effect<T3ObjectMutationResult, T3ObjectError>;
    readonly listRevisions: (
      input: T3ObjectListRevisionsInput,
    ) => Effect.Effect<T3ObjectListRevisionsResult, T3ObjectError>;
    readonly readRevision: (
      input: T3ObjectReadRevisionInput,
    ) => Effect.Effect<T3ObjectReadRevisionResult, T3ObjectError>;
    readonly restoreRevision: (
      input: T3ObjectRestoreRevisionInput & { readonly actor?: T3ObjectActor },
    ) => Effect.Effect<T3ObjectMutationResult, T3ObjectError>;
    readonly requestOpen: (input: {
      readonly id: T3ObjectId;
      readonly threadId?: ThreadId | null;
    }) => Effect.Effect<T3ObjectReadResult, T3ObjectError>;
    readonly subscribe: (
      input?: T3ObjectSubscribeInput,
    ) => Stream.Stream<T3ObjectStreamEvent, T3ObjectError>;
  }
>()("t3/objects/T3ObjectService") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const random = yield* SecureRandom.SecureRandom;
  const eventsPubSub = yield* PubSub.unbounded<T3ObjectStreamEvent>();

  const decodeStoredContent = Effect.fn("T3ObjectService.decodeStoredContent")(function* (
    rawJson: string,
    objectId: T3ObjectId,
  ) {
    return yield* decodeContentJson(rawJson).pipe(
      Effect.mapError(
        () =>
          new T3ObjectError({
            code: "storage_error",
            message: `Stored content for object "${objectId}" is invalid.`,
            objectId,
          }),
      ),
    );
  });

  const encodeStoredContent = Effect.fn("T3ObjectService.encodeStoredContent")(function* (
    content: T3ObjectContent,
    objectId?: T3ObjectId,
  ) {
    return yield* encodeContentJson(content).pipe(
      Effect.mapError(
        () =>
          new T3ObjectError({
            code: "invalid_request",
            message: "Could not serialize object content.",
            ...(objectId !== undefined ? { objectId } : {}),
          }),
      ),
    );
  });

  const decodeObjectRow = Effect.fn("T3ObjectService.decodeObjectRow")(function* (row: ObjectRow) {
    const summary = toSummary(row);
    const content = yield* decodeStoredContent(row.content_json, summary.id);
    return {
      ...summary,
      content,
    } satisfies T3Object;
  });

  const pruneRevisions = Effect.fn("T3ObjectService.pruneRevisions")(function* (
    objectId: T3ObjectId,
  ) {
    yield* sql`
      DELETE FROM t3_object_revisions
      WHERE object_id = ${objectId}
        AND revision NOT IN (
          SELECT revision
          FROM t3_object_revisions
          WHERE object_id = ${objectId}
          ORDER BY revision DESC
          LIMIT ${MAX_REVISIONS_PER_OBJECT}
        )
    `;
  });

  const selectObjectRow = Effect.fn("T3ObjectService.selectObjectRow")(function* (
    objectId: T3ObjectId,
  ) {
    const rows = yield* sql<ObjectRow>`
      SELECT
        id, kind, title, revision, node_count, content_json,
        created_by_thread_id, created_at, updated_at, archived_at
      FROM t3_objects
      WHERE id = ${objectId}
      LIMIT 1
    `;
    const row = rows[0];
    if (row === undefined) {
      return yield* notFoundError(objectId);
    }
    return row;
  });

  const list = Effect.fn("T3ObjectService.list")(function* (input?: T3ObjectListInput) {
    const includeArchived = input?.includeArchived === true;
    const kind = input?.kind;
    const rows = yield* (
      includeArchived && kind !== undefined
        ? sql<ObjectSummaryRow>`
            SELECT
              id, kind, title, revision, node_count,
              created_by_thread_id, created_at, updated_at, archived_at
            FROM t3_objects
            WHERE kind = ${kind}
            ORDER BY updated_at DESC, id ASC
          `
        : includeArchived
          ? sql<ObjectSummaryRow>`
              SELECT
                id, kind, title, revision, node_count,
                created_by_thread_id, created_at, updated_at, archived_at
              FROM t3_objects
              ORDER BY updated_at DESC, id ASC
            `
          : kind !== undefined
            ? sql<ObjectSummaryRow>`
                SELECT
                  id, kind, title, revision, node_count,
                  created_by_thread_id, created_at, updated_at, archived_at
                FROM t3_objects
                WHERE archived_at IS NULL AND kind = ${kind}
                ORDER BY updated_at DESC, id ASC
              `
            : sql<ObjectSummaryRow>`
                SELECT
                  id, kind, title, revision, node_count,
                  created_by_thread_id, created_at, updated_at, archived_at
                FROM t3_objects
                WHERE archived_at IS NULL
                ORDER BY updated_at DESC, id ASC
              `
    ).pipe(Effect.mapError(mapStorageError("Failed to list objects.")));

    return {
      objects: rows.map(toSummary),
    } satisfies T3ObjectListResult;
  });

  const read = Effect.fn("T3ObjectService.read")(function* (input: T3ObjectReadInput) {
    const row = yield* selectObjectRow(input.id).pipe(
      Effect.mapError(mapStorageError("Failed to read object.", input.id)),
    );
    const object = yield* decodeObjectRow(row);
    return { object } satisfies T3ObjectReadResult;
  });

  const create = Effect.fn("T3ObjectService.create")(function* (
    input: T3ObjectCreateInput & { readonly actor?: T3ObjectActor },
  ) {
    const document = input.document ?? emptyDesignDocument();
    const validation = validateDesignDocument(document);
    if (!validation.ok) {
      return yield* new T3ObjectError({
        code: "invalid_request",
        message: validation.message,
      });
    }

    const id = T3ObjectId.make(yield* random.uuidV4().pipe(Effect.orDie));
    const createdAt = yield* nowIso();
    const content: T3ObjectContent = { kind: input.kind, document };
    const contentJson = yield* encodeStoredContent(content, id);
    const nodeCount = countContentNodes(content);
    const actor: T3ObjectActor = input.actor ?? "user";
    const summary = input.summary ?? "Created object";
    const threadId = input.threadId ?? null;

    yield* sql
      .withTransaction(
        Effect.gen(function* () {
          yield* sql`
            INSERT INTO t3_objects (
              id, kind, title, revision, node_count, content_json,
              created_by_thread_id, created_at, updated_at, archived_at
            )
            VALUES (
              ${id}, ${input.kind}, ${input.title}, 1, ${nodeCount}, ${contentJson},
              ${threadId}, ${createdAt}, ${createdAt}, NULL
            )
          `;
          yield* sql`
            INSERT INTO t3_object_revisions (
              object_id, revision, actor, summary, thread_id, content_json, created_at
            )
            VALUES (
              ${id}, 1, ${actor}, ${summary}, ${threadId}, ${contentJson}, ${createdAt}
            )
          `;
        }),
      )
      .pipe(Effect.mapError(mapStorageError("Failed to create object.", id)));

    const object: T3Object = {
      id,
      kind: input.kind,
      title: input.title,
      revision: 1,
      nodeCount,
      createdByThreadId: threadId,
      createdAt,
      updatedAt: createdAt,
      archivedAt: null,
      content,
    };
    const revision: T3ObjectRevisionSummary = {
      objectId: id,
      revision: 1,
      actor,
      summary,
      threadId,
      createdAt,
    };

    yield* PubSub.publish(eventsPubSub, { type: "created", object });
    return { object, revision } satisfies T3ObjectMutationResult;
  });

  const rename = Effect.fn("T3ObjectService.rename")(function* (input: T3ObjectRenameInput) {
    const updatedAt = yield* nowIso();
    const row = yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const existing = yield* selectObjectRow(input.id);
          yield* sql`
            UPDATE t3_objects
            SET title = ${input.title}, updated_at = ${updatedAt}
            WHERE id = ${input.id}
          `;
          return { ...existing, title: input.title, updated_at: updatedAt } satisfies ObjectRow;
        }),
      )
      .pipe(Effect.mapError(mapStorageError("Failed to rename object.", input.id)));

    const object = yield* decodeObjectRow(row);
    yield* PubSub.publish(eventsPubSub, {
      type: "renamed",
      id: object.id,
      title: object.title,
      updatedAt: object.updatedAt,
    });
    return { object } satisfies T3ObjectReadResult;
  });

  const setArchived = Effect.fn("T3ObjectService.setArchived")(function* (
    input: T3ObjectSetArchivedInput,
  ) {
    const updatedAt = yield* nowIso();
    const archivedAt = input.archived ? updatedAt : null;
    const row = yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const existing = yield* selectObjectRow(input.id);
          yield* sql`
            UPDATE t3_objects
            SET archived_at = ${archivedAt}, updated_at = ${updatedAt}
            WHERE id = ${input.id}
          `;
          return {
            ...existing,
            archived_at: archivedAt,
            updated_at: updatedAt,
          } satisfies ObjectRow;
        }),
      )
      .pipe(Effect.mapError(mapStorageError("Failed to update archive state.", input.id)));

    const object = yield* decodeObjectRow(row);
    yield* PubSub.publish(eventsPubSub, {
      type: "archived",
      id: object.id,
      archivedAt: object.archivedAt,
      updatedAt: object.updatedAt,
    });
    return { object } satisfies T3ObjectReadResult;
  });

  const remove = Effect.fn("T3ObjectService.delete")(function* (input: T3ObjectDeleteInput) {
    const existed = yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const rows = yield* sql<{ readonly id: string }>`
            SELECT id FROM t3_objects WHERE id = ${input.id} LIMIT 1
          `;
          if (rows.length === 0) return false;
          yield* sql`DELETE FROM t3_object_revisions WHERE object_id = ${input.id}`;
          yield* sql`DELETE FROM t3_objects WHERE id = ${input.id}`;
          return true;
        }),
      )
      .pipe(Effect.mapError(mapStorageError("Failed to delete object.", input.id)));

    if (existed) {
      yield* PubSub.publish(eventsPubSub, { type: "deleted", id: input.id });
    }
    return { deleted: existed } satisfies T3ObjectDeleteResult;
  });

  const commitNewContent = Effect.fn("T3ObjectService.commitNewContent")(function* (input: {
    readonly id: T3ObjectId;
    readonly expectedRevision?: number | undefined;
    readonly actor: T3ObjectActor;
    readonly summary: string;
    readonly threadId: ThreadId | null;
    readonly computeNext: (
      current: T3ObjectContent,
    ) => Effect.Effect<T3ObjectContent, T3ObjectError>;
  }) {
    const updatedAt = yield* nowIso();
    const result = yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const existing = yield* selectObjectRow(input.id);
          if (
            input.expectedRevision !== undefined &&
            existing.revision !== input.expectedRevision
          ) {
            return yield* new T3ObjectError({
              code: "revision_conflict",
              message: `Object "${input.id}" is at revision ${existing.revision}, expected ${input.expectedRevision}.`,
              objectId: input.id,
              currentRevision: existing.revision,
            });
          }

          const currentContent = yield* decodeStoredContent(existing.content_json, input.id);
          const nextContent = yield* input.computeNext(currentContent);
          const nextContentJson = yield* encodeStoredContent(nextContent, input.id);
          const nextRevision = existing.revision + 1;
          const nextNodeCount = countContentNodes(nextContent);

          yield* sql`
            UPDATE t3_objects
            SET
              revision = ${nextRevision},
              node_count = ${nextNodeCount},
              content_json = ${nextContentJson},
              updated_at = ${updatedAt}
            WHERE id = ${input.id}
          `;
          yield* sql`
            INSERT INTO t3_object_revisions (
              object_id, revision, actor, summary, thread_id, content_json, created_at
            )
            VALUES (
              ${input.id},
              ${nextRevision},
              ${input.actor},
              ${input.summary},
              ${input.threadId},
              ${nextContentJson},
              ${updatedAt}
            )
          `;
          yield* pruneRevisions(input.id);

          const object: T3Object = {
            id: T3ObjectId.make(existing.id),
            kind: existing.kind as T3ObjectKind,
            title: existing.title,
            revision: nextRevision,
            nodeCount: nextNodeCount,
            createdByThreadId: existing.created_by_thread_id as ThreadId | null,
            createdAt: existing.created_at,
            updatedAt,
            archivedAt: existing.archived_at,
            content: nextContent,
          };
          const revision: T3ObjectRevisionSummary = {
            objectId: object.id,
            revision: nextRevision,
            actor: input.actor,
            summary: input.summary,
            threadId: input.threadId,
            createdAt: updatedAt,
          };
          return { object, revision } satisfies T3ObjectMutationResult;
        }),
      )
      .pipe(Effect.mapError(mapStorageError("Failed to update object.", input.id)));

    yield* PubSub.publish(eventsPubSub, {
      type: "updated",
      object: result.object,
      revision: result.revision,
    });
    return result;
  });

  const mutateDesign = Effect.fn("T3ObjectService.mutateDesign")(function* (
    input: T3ObjectMutateDesignInput & { readonly actor?: T3ObjectActor },
  ) {
    const idSeed = yield* random.uuidV4().pipe(Effect.orDie);
    const idPrefix = idSeed.slice(0, 8);
    let generatedCounter = 1;
    const nextNodeId = () => DesignNodeId.make(`n_${idPrefix}_${generatedCounter++}`);

    return yield* commitNewContent({
      id: input.id,
      expectedRevision: input.expectedRevision,
      actor: input.actor ?? "user",
      summary: input.summary,
      threadId: input.threadId ?? null,
      computeNext: (current) => {
        if (current.kind !== "design") {
          return Effect.fail(
            new T3ObjectError({
              code: "invalid_request",
              message: `Object "${input.id}" is "${current.kind}", not "design".`,
              objectId: input.id,
            }),
          );
        }
        const applied = applyDesignMutations(current.document, input.ops, nextNodeId);
        if (!applied.ok) {
          return Effect.fail(
            new T3ObjectError({
              code: "invalid_request",
              message: applied.message,
              objectId: input.id,
            }),
          );
        }
        return Effect.succeed({ kind: "design", document: applied.document });
      },
    });
  });

  const replaceDesign = Effect.fn("T3ObjectService.replaceDesign")(function* (
    input: T3ObjectReplaceDesignInput & { readonly actor?: T3ObjectActor },
  ) {
    const validation = validateDesignDocument(input.document);
    if (!validation.ok) {
      return yield* new T3ObjectError({
        code: "invalid_request",
        message: validation.message,
        objectId: input.id,
      });
    }
    return yield* commitNewContent({
      id: input.id,
      expectedRevision: input.expectedRevision,
      actor: input.actor ?? "user",
      summary: input.summary,
      threadId: input.threadId ?? null,
      computeNext: (current) => {
        if (current.kind !== "design") {
          return Effect.fail(
            new T3ObjectError({
              code: "invalid_request",
              message: `Object "${input.id}" is "${current.kind}", not "design".`,
              objectId: input.id,
            }),
          );
        }
        return Effect.succeed({ kind: "design", document: input.document });
      },
    });
  });

  const listRevisions = Effect.fn("T3ObjectService.listRevisions")(function* (
    input: T3ObjectListRevisionsInput,
  ) {
    const limit = input.limit ?? DEFAULT_REVISION_LIST_LIMIT;
    const rows = yield* Effect.gen(function* () {
      yield* selectObjectRow(input.id);
      return yield* sql<RevisionSummaryRow>`
        SELECT object_id, revision, actor, summary, thread_id, created_at
        FROM t3_object_revisions
        WHERE object_id = ${input.id}
        ORDER BY revision DESC
        LIMIT ${limit}
      `;
    }).pipe(Effect.mapError(mapStorageError("Failed to list object revisions.", input.id)));

    return {
      revisions: rows.map(toRevisionSummary),
    } satisfies T3ObjectListRevisionsResult;
  });

  const readRevision = Effect.fn("T3ObjectService.readRevision")(function* (
    input: T3ObjectReadRevisionInput,
  ) {
    const row = yield* sql<RevisionRow>`
      SELECT object_id, revision, actor, summary, thread_id, content_json, created_at
      FROM t3_object_revisions
      WHERE object_id = ${input.id} AND revision = ${input.revision}
      LIMIT 1
    `.pipe(
      Effect.mapError(mapStorageError("Failed to read object revision.", input.id)),
      Effect.flatMap((rows) => {
        const match = rows[0];
        if (match === undefined) {
          return Effect.fail(
            new T3ObjectError({
              code: "not_found",
              message: `Revision ${input.revision} of object "${input.id}" does not exist.`,
              objectId: input.id,
            }),
          );
        }
        return Effect.succeed(match);
      }),
    );

    const content = yield* decodeStoredContent(row.content_json, input.id);
    const revision: T3ObjectRevision = {
      ...toRevisionSummary(row),
      content,
    };
    return { revision } satisfies T3ObjectReadRevisionResult;
  });

  const restoreRevision = Effect.fn("T3ObjectService.restoreRevision")(function* (
    input: T3ObjectRestoreRevisionInput & { readonly actor?: T3ObjectActor },
  ) {
    const target = yield* readRevision({ id: input.id, revision: input.revision });
    return yield* commitNewContent({
      id: input.id,
      expectedRevision: input.expectedRevision,
      actor: input.actor ?? "user",
      summary: `Restored revision #${input.revision}`,
      threadId: input.threadId ?? null,
      computeNext: () => Effect.succeed(target.revision.content),
    });
  });

  const requestOpen = Effect.fn("T3ObjectService.requestOpen")(function* (input: {
    readonly id: T3ObjectId;
    readonly threadId?: ThreadId | null;
  }) {
    const result = yield* read({ id: input.id });
    yield* PubSub.publish(eventsPubSub, {
      type: "openRequested",
      id: result.object.id,
      threadId: input.threadId ?? null,
    });
    return result;
  });

  const subscribe: T3ObjectService["Service"]["subscribe"] = (input = {}) =>
    Stream.unwrap(
      Effect.gen(function* () {
        // Subscribe before snapshotting so concurrent writes are buffered rather than dropped.
        const subscription = yield* PubSub.subscribe(eventsPubSub);
        const snapshot = Stream.fromEffect(
          list({ includeArchived: input.includeArchived }).pipe(
            Effect.map((result): T3ObjectStreamEvent => ({
              type: "snapshot",
              objects: result.objects,
            })),
          ),
        );
        return Stream.concat(snapshot, Stream.fromSubscription(subscription));
      }),
    );

  return T3ObjectService.of({
    list,
    read,
    create,
    rename,
    setArchived,
    delete: remove,
    mutateDesign,
    replaceDesign,
    listRevisions,
    readRevision,
    restoreRevision,
    requestOpen,
    subscribe,
  });
});

export const layer = Layer.effect(T3ObjectService, make);
