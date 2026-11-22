import {
  DesignNodeId,
  emptyDesignDocument,
  T3ObjectId,
  type T3ObjectRevisionSummary,
} from "@t3tools/contracts";
import { applyDesignMutations } from "@t3tools/shared/designDocument";
import { describe, expect, it } from "vite-plus/test";
import {
  buildDuplicateNodeOps,
  buildReorderNodeOp,
  clampBubblePosition,
  findPreviousRevision,
  getLayerOrderAvailability,
} from "./designEditorTypes";

describe("designEditorTypes", () => {
  it("positions the floating chat bubble near the anchor and clamps inside the viewport", () => {
    const viewport = { width: 800, height: 600 };
    const bubble = { width: 320, height: 112 };

    expect(clampBubblePosition({ x: 400, y: 200 }, viewport, bubble)).toEqual({
      left: 240,
      top: 214,
    });

    expect(clampBubblePosition({ x: 400, y: 540 }, viewport, bubble)).toEqual({
      left: 240,
      top: 414,
    });

    expect(clampBubblePosition({ x: 20, y: 200 }, viewport, bubble)).toEqual({
      left: 12,
      top: 214,
    });
    expect(clampBubblePosition({ x: 790, y: 200 }, viewport, bubble)).toEqual({
      left: 468,
      top: 214,
    });
  });

  it("finds the nearest earlier revision for non-destructive undo stepping", () => {
    const objectId = T3ObjectId.make("obj-1");
    const revisions: ReadonlyArray<T3ObjectRevisionSummary> = [
      {
        objectId,
        revision: 5,
        actor: "agent",
        summary: "fifth",
        threadId: null,
        createdAt: "2026-01-01T00:05:00Z",
      },
      {
        objectId,
        revision: 3,
        actor: "agent",
        summary: "third",
        threadId: null,
        createdAt: "2026-01-01T00:03:00Z",
      },
      {
        objectId,
        revision: 1,
        actor: "user",
        summary: "first",
        threadId: null,
        createdAt: "2026-01-01T00:01:00Z",
      },
    ];

    expect(findPreviousRevision(revisions, 5)).toBe(3);
    expect(findPreviousRevision(revisions, 3)).toBe(1);
    expect(findPreviousRevision(revisions, 1)).toBeNull();
  });

  it("deep-clones a frame subtree and inserts it directly after the original", () => {
    const seeded = applyDesignMutations(emptyDesignDocument("#0f1117"), [
      {
        op: "add",
        node: {
          id: DesignNodeId.make("frame-1"),
          type: "frame",
          name: "Hero",
          x: 100,
          y: 50,
          width: 400,
          height: 300,
          fill: "#18181b",
        },
      },
      {
        op: "add",
        node: {
          id: DesignNodeId.make("label-1"),
          type: "text",
          name: "Heading",
          parentId: DesignNodeId.make("frame-1"),
          x: 24,
          y: 24,
          width: 200,
          height: 32,
          text: "Welcome",
          fontSize: 20,
        },
      },
      {
        op: "add",
        node: {
          id: DesignNodeId.make("frame-2"),
          type: "frame",
          name: "Footer",
          x: 600,
          y: 50,
          width: 400,
          height: 120,
        },
      },
    ]);
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;

    let seq = 1;
    const dup = buildDuplicateNodeOps(seeded.document, DesignNodeId.make("frame-1"), () =>
      DesignNodeId.make(`clone-${seq++}`),
    );
    expect(dup).not.toBeNull();
    if (dup === null) return;

    const applied = applyDesignMutations(seeded.document, dup.ops);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    expect(applied.document.rootIds).toEqual([
      DesignNodeId.make("frame-1"),
      dup.rootCloneId,
      DesignNodeId.make("frame-2"),
    ]);
    const clonedFrame = applied.document.nodes[dup.rootCloneId];
    expect(clonedFrame?.type).toBe("frame");
    expect(clonedFrame?.name).toBe("Hero copy");
    expect(clonedFrame?.x).toBe(120);
    expect(clonedFrame?.y).toBe(70);
    if (clonedFrame?.type !== "frame") return;
    expect(clonedFrame.childIds).toHaveLength(1);
    const clonedChild = applied.document.nodes[clonedFrame.childIds[0]!];
    expect(clonedChild?.type).toBe("text");
    expect(clonedChild?.name).toBe("Heading");
    expect(clonedChild?.x).toBe(24);
    expect(clonedChild?.y).toBe(24);
  });

  it("computes layer order availability and reorder operations", () => {
    const seeded = applyDesignMutations(emptyDesignDocument("#0f1117"), [
      {
        op: "add",
        node: { id: DesignNodeId.make("a"), type: "rect", name: "A", width: 50, height: 50 },
      },
      {
        op: "add",
        node: { id: DesignNodeId.make("b"), type: "rect", name: "B", width: 50, height: 50 },
      },
      {
        op: "add",
        node: { id: DesignNodeId.make("c"), type: "rect", name: "C", width: 50, height: 50 },
      },
    ]);
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;

    const a = DesignNodeId.make("a");
    const b = DesignNodeId.make("b");
    const c = DesignNodeId.make("c");

    expect(getLayerOrderAvailability(seeded.document, a)).toEqual({
      canBringForward: true,
      canSendBackward: false,
    });
    expect(getLayerOrderAvailability(seeded.document, b)).toEqual({
      canBringForward: true,
      canSendBackward: true,
    });
    expect(getLayerOrderAvailability(seeded.document, c)).toEqual({
      canBringForward: false,
      canSendBackward: true,
    });

    expect(buildReorderNodeOp(seeded.document, a, "back")).toBeNull();
    expect(buildReorderNodeOp(seeded.document, c, "front")).toBeNull();
    expect(buildReorderNodeOp(seeded.document, a, "forward")).toEqual({
      op: "reorder",
      id: a,
      index: 1,
    });
    expect(buildReorderNodeOp(seeded.document, a, "front")).toEqual({
      op: "reorder",
      id: a,
      index: 2,
    });
    expect(buildReorderNodeOp(seeded.document, c, "backward")).toEqual({
      op: "reorder",
      id: c,
      index: 1,
    });
    expect(buildReorderNodeOp(seeded.document, c, "back")).toEqual({
      op: "reorder",
      id: c,
      index: 0,
    });
  });
});
