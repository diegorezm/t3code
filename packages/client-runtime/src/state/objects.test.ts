import { describe, expect, it } from "vite-plus/test";
import { T3ObjectId, ThreadId, emptyDesignDocument } from "@t3tools/contracts";

import { EMPTY_OBJECTS_ENVIRONMENT_STATE, reduceT3ObjectStreamEvent } from "./objects.ts";

describe("reduceT3ObjectStreamEvent", () => {
  it("folds snapshot, create, update, rename, archive, openRequested, and delete events", () => {
    const id = T3ObjectId.make("obj-1");
    const threadId = ThreadId.make("thread-1");

    const s1 = reduceT3ObjectStreamEvent(EMPTY_OBJECTS_ENVIRONMENT_STATE, {
      type: "snapshot",
      objects: [],
    });
    expect(s1.loaded).toBe(true);
    expect(Object.keys(s1.summariesById)).toHaveLength(0);

    const s2 = reduceT3ObjectStreamEvent(s1, {
      type: "created",
      object: {
        id,
        kind: "design",
        title: "Hero",
        revision: 1,
        nodeCount: 0,
        createdByThreadId: threadId,
        createdAt: "2026-11-21T18:00:00.000Z",
        updatedAt: "2026-11-21T18:00:00.000Z",
        archivedAt: null,
        content: { kind: "design", document: emptyDesignDocument() },
      },
    });
    expect(s2.summariesById[id]?.title).toBe("Hero");
    expect(s2.objectsById[id]?.revision).toBe(1);

    const s3 = reduceT3ObjectStreamEvent(s2, {
      type: "renamed",
      id,
      title: "Landing Hero",
      updatedAt: "2026-11-21T18:01:00.000Z",
    });
    expect(s3.summariesById[id]?.title).toBe("Landing Hero");
    expect(s3.objectsById[id]?.title).toBe("Landing Hero");

    const s4 = reduceT3ObjectStreamEvent(s3, {
      type: "openRequested",
      id,
      threadId,
    });
    expect(s4.lastOpenRequest).toEqual({ id, threadId, seq: 1 });

    const s5 = reduceT3ObjectStreamEvent(s4, {
      type: "archived",
      id,
      archivedAt: "2026-11-21T18:02:00.000Z",
      updatedAt: "2026-11-21T18:02:00.000Z",
    });
    expect(s5.summariesById[id]?.archivedAt).toBe("2026-11-21T18:02:00.000Z");

    const s6 = reduceT3ObjectStreamEvent(s5, { type: "deleted", id });
    expect(s6.summariesById[id]).toBeUndefined();
    expect(s6.objectsById[id]).toBeUndefined();
  });
});
