import { assert, describe, it } from "@effect/vitest";
import { DesignNodeId, T3ObjectError, ThreadId } from "@t3tools/contracts";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { runMigrations } from "../persistence/Migrations.ts";
import * as T3ObjectService from "./T3ObjectService.ts";

const isT3ObjectError = Schema.is(T3ObjectError);

const makeTestLayer = () => {
  const sqliteLayer = NodeSqliteClient.layer({ filename: ":memory:" });
  const migrationLayer = Layer.effectDiscard(runMigrations()).pipe(Layer.provide(sqliteLayer));
  return T3ObjectService.layer.pipe(
    Layer.provide(sqliteLayer),
    Layer.provide(migrationLayer),
    Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
  );
};

describe("T3ObjectService", () => {
  it.effect(
    "creates, mutates, tracks actor revisions, restores non-destructively, and archives",
    () =>
      Effect.gen(function* () {
        const objects = yield* T3ObjectService.T3ObjectService;
        const threadId = ThreadId.make("thread-design-1");

        const created = yield* objects.create({
          kind: "design",
          title: "Landing Hero",
          actor: "agent",
          threadId,
          summary: "Initial blank canvas",
        });
        assert.strictEqual(created.object.revision, 1);
        assert.strictEqual(created.object.nodeCount, 0);
        assert.strictEqual(created.revision.actor, "agent");
        assert.strictEqual(created.revision.threadId, threadId);

        // Agent adds a frame and headline in one atomic batch.
        const rev2 = yield* objects.mutateDesign({
          id: created.object.id,
          expectedRevision: 1,
          actor: "agent",
          threadId,
          summary: "Added hero frame and title",
          ops: [
            {
              op: "add",
              node: {
                id: DesignNodeId.make("hero"),
                type: "frame",
                name: "Hero Frame",
                width: 1200,
                height: 600,
                fill: "#0f172a",
              },
            },
            {
              op: "add",
              node: {
                id: DesignNodeId.make("headline"),
                type: "text",
                name: "Headline",
                parentId: DesignNodeId.make("hero"),
                width: 600,
                height: 48,
                text: "Hello T3 Objects",
                fontSize: 36,
                color: "#f8fafc",
              },
            },
          ],
        });
        assert.strictEqual(rev2.object.revision, 2);
        assert.strictEqual(rev2.object.nodeCount, 2);

        // User edits the headline text.
        const rev3 = yield* objects.mutateDesign({
          id: created.object.id,
          expectedRevision: 2,
          actor: "user",
          summary: "Updated headline copy",
          ops: [
            {
              op: "update",
              id: DesignNodeId.make("headline"),
              patch: { text: "Custom user copy" },
            },
          ],
        });
        assert.strictEqual(rev3.object.revision, 3);
        assert.strictEqual(rev3.revision.actor, "user");

        // Stale expectedRevision fails with revision_conflict + currentRevision.
        const staleExit = yield* Effect.exit(
          objects.mutateDesign({
            id: created.object.id,
            expectedRevision: 2,
            summary: "Stale edit",
            ops: [{ op: "setBackground", background: "#000000" }],
          }),
        );
        assert.isTrue(Exit.isFailure(staleExit));
        const staleError = Exit.isFailure(staleExit) ? staleExit.cause.reasons[0] : undefined;
        assert.isDefined(staleError);
        if (staleError && staleError._tag === "Fail" && isT3ObjectError(staleError.error)) {
          assert.strictEqual(staleError.error.code, "revision_conflict");
          assert.strictEqual(staleError.error.currentRevision, 3);
        }

        // Restore revision 2 creates revision 4 with revision 2's content.
        const rev4 = yield* objects.restoreRevision({
          id: created.object.id,
          revision: 2,
          actor: "user",
        });
        assert.strictEqual(rev4.object.revision, 4);
        const restoredHeadline = rev4.object.content.document.nodes["headline"];
        assert.strictEqual(
          restoredHeadline?.type === "text" ? restoredHeadline.text : "",
          "Hello T3 Objects",
        );

        const history = yield* objects.listRevisions({ id: created.object.id });
        assert.deepStrictEqual(
          history.revisions.map((r) => [r.revision, r.actor]),
          [
            [4, "user"],
            [3, "user"],
            [2, "agent"],
            [1, "agent"],
          ],
        );

        // Archive hides from default list, unarchive brings it back.
        yield* objects.setArchived({ id: created.object.id, archived: true });
        const activeList = yield* objects.list();
        assert.strictEqual(activeList.objects.length, 0);
        const allList = yield* objects.list({ includeArchived: true });
        assert.strictEqual(allList.objects.length, 1);

        yield* objects.setArchived({ id: created.object.id, archived: false });
        const restoredList = yield* objects.list();
        assert.strictEqual(restoredList.objects.length, 1);

        const deleted = yield* objects.delete({ id: created.object.id });
        assert.isTrue(deleted.deleted);
        const missing = yield* Effect.exit(objects.read({ id: created.object.id }));
        assert.isTrue(Exit.isFailure(missing));
      }).pipe(Effect.provide(makeTestLayer())),
  );

  it.effect("streams initial snapshot and live create/update/openRequested events", () =>
    Effect.gen(function* () {
      const objects = yield* T3ObjectService.T3ObjectService;
      const snapshotSeen = yield* Deferred.make<void>();

      const collectorFiber = yield* objects.subscribe().pipe(
        Stream.tap((event) =>
          event.type === "snapshot" ? Deferred.succeed(snapshotSeen, undefined) : Effect.void,
        ),
        Stream.take(4),
        Stream.runCollect,
        Effect.forkChild,
      );

      yield* Deferred.await(snapshotSeen);

      const created = yield* objects.create({
        kind: "design",
        title: "Live Canvas",
        actor: "agent",
      });
      yield* objects.mutateDesign({
        id: created.object.id,
        actor: "agent",
        summary: "Set background",
        ops: [{ op: "setBackground", background: "#111111" }],
      });
      yield* objects.requestOpen({ id: created.object.id, threadId: null });

      const events = yield* Fiber.join(collectorFiber);
      assert.deepStrictEqual(
        events.map((event) => event.type),
        ["snapshot", "created", "updated", "openRequested"],
      );
      const createdEvent = events[1];
      const updatedEvent = events[2];
      assert.isTrue(createdEvent?.type === "created" && !("content" in createdEvent.object));
      assert.isTrue(
        updatedEvent?.type === "updated" &&
          !("content" in updatedEvent.object) &&
          updatedEvent.object.revision === 2,
      );
    }).pipe(Effect.provide(makeTestLayer())),
  );

  it.effect("applies initial create ops atomically and leaves no orphan on invalid ops", () =>
    Effect.gen(function* () {
      const objects = yield* T3ObjectService.T3ObjectService;

      const failed = yield* Effect.exit(
        objects.create({
          kind: "design",
          title: "Broken Initial Ops",
          actor: "agent",
          ops: [
            {
              op: "add",
              node: {
                id: DesignNodeId.make("child"),
                type: "rect",
                name: "Orphan Child",
                parentId: DesignNodeId.make("missing-parent"),
                width: 100,
                height: 100,
              },
            },
          ],
        }),
      );
      assert.isTrue(Exit.isFailure(failed));
      const failedReason = Exit.isFailure(failed) ? failed.cause.reasons[0] : undefined;
      assert.isTrue(
        failedReason?._tag === "Fail" &&
          isT3ObjectError(failedReason.error) &&
          failedReason.error.code === "invalid_request",
      );
      const listAfterFailure = yield* objects.list({ includeArchived: true });
      assert.strictEqual(listAfterFailure.objects.length, 0);

      const created = yield* objects.create({
        kind: "design",
        title: "Atomic Initial Ops",
        actor: "agent",
        ops: [
          {
            op: "add",
            node: {
              id: DesignNodeId.make("frame-1"),
              type: "frame",
              name: "Card",
              width: 320,
              height: 200,
            },
          },
          {
            op: "add",
            node: {
              id: DesignNodeId.make("title-1"),
              type: "text",
              name: "Title",
              parentId: DesignNodeId.make("frame-1"),
              width: 280,
              height: 32,
              text: "Atomic",
            },
          },
        ],
      });
      assert.strictEqual(created.object.revision, 1);
      assert.strictEqual(created.object.nodeCount, 2);
      const history = yield* objects.listRevisions({ id: created.object.id });
      assert.strictEqual(history.revisions.length, 1);
    }).pipe(Effect.provide(makeTestLayer())),
  );
});
