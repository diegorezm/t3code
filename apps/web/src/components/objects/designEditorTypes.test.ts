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
  buildDuplicateNodesOps,
  buildPasteNodesOps,
  buildReorderNodeOp,
  clampBubblePosition,
  findPreviousRevision,
  getLayerOrderAvailability,
  getSelectAllNodeIds,
  normalizeSelectedNodeIds,
  parseDesignClipboard,
  serializeDesignClipboard,
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

  it("normalizes multi-selection by deduplicating and pruning descendants", () => {
    const seeded = applyDesignMutations(emptyDesignDocument("#0f1117"), [
      {
        op: "add",
        node: {
          id: DesignNodeId.make("card"),
          type: "frame",
          name: "Card",
          width: 300,
          height: 200,
        },
      },
      {
        op: "add",
        node: {
          id: DesignNodeId.make("title"),
          type: "text",
          name: "Title",
          parentId: DesignNodeId.make("card"),
          width: 200,
          height: 30,
          text: "Hello",
        },
      },
      {
        op: "add",
        node: {
          id: DesignNodeId.make("badge"),
          type: "rect",
          name: "Badge",
          width: 80,
          height: 24,
        },
      },
    ]);
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;

    const card = DesignNodeId.make("card");
    const title = DesignNodeId.make("title");
    const badge = DesignNodeId.make("badge");
    const missing = DesignNodeId.make("missing");

    expect(normalizeSelectedNodeIds(seeded.document, [card, title, badge, card, missing])).toEqual([
      card,
      badge,
    ]);
    expect(getSelectAllNodeIds(seeded.document, [title])).toEqual([title]);
    expect(getSelectAllNodeIds(seeded.document, [])).toEqual([card, badge]);
  });

  it("serializes, parses, and pastes single and multi-node subtrees across contexts", () => {
    const seeded = applyDesignMutations(emptyDesignDocument("#0f1117"), [
      {
        op: "add",
        node: {
          id: DesignNodeId.make("card-a"),
          type: "frame",
          name: "Starter",
          x: 100,
          y: 50,
          width: 240,
          height: 300,
        },
      },
      {
        op: "add",
        node: {
          id: DesignNodeId.make("label-a"),
          type: "text",
          name: "Label",
          parentId: DesignNodeId.make("card-a"),
          x: 20,
          y: 20,
          width: 120,
          height: 24,
          text: "Starter",
        },
      },
      {
        op: "add",
        node: {
          id: DesignNodeId.make("card-b"),
          type: "frame",
          name: "Pro",
          x: 400,
          y: 50,
          width: 240,
          height: 300,
        },
      },
    ]);
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;

    const cardA = DesignNodeId.make("card-a");
    const labelA = DesignNodeId.make("label-a");
    const cardB = DesignNodeId.make("card-b");

    // Copying parent + descendant prunes descendant so subtree isn't duplicated.
    const clipboard = serializeDesignClipboard(seeded.document, [cardA, labelA]);
    expect(clipboard).not.toBeNull();
    if (clipboard === null) return;
    expect(clipboard.entries).toHaveLength(1);
    expect(clipboard.entries[0]?.tree.children).toHaveLength(1);

    const roundTripped = parseDesignClipboard(JSON.stringify(clipboard));
    expect(roundTripped).toEqual(clipboard);
    expect(parseDesignClipboard("plain text")).toBeNull();
    expect(parseDesignClipboard('{"foo":1}')).toBeNull();

    // Pasting while the copied frame itself is still selected pastes as an offset sibling (not inside itself).
    let seq = 1;
    const pastedSibling = buildPasteNodesOps(seeded.document, clipboard, {
      selectedIds: [cardA],
      pasteCount: 1,
      createId: () => DesignNodeId.make(`pasted-${seq++}`),
    });
    expect(pastedSibling).not.toBeNull();
    if (pastedSibling === null) return;
    const appliedSibling = applyDesignMutations(seeded.document, pastedSibling.ops);
    expect(appliedSibling.ok).toBe(true);
    if (!appliedSibling.ok) return;
    const cloneA = appliedSibling.document.nodes[pastedSibling.pastedRootIds[0]!];
    expect(cloneA?.parentId).toBeNull();
    expect(cloneA?.x).toBe(120);
    expect(cloneA?.y).toBe(70);
    expect(cloneA?.type === "frame" ? cloneA.childIds.length : 0).toBe(1);

    // Pasting a copied child while another frame (cardB) is selected pastes inside cardB.
    const childClipboard = serializeDesignClipboard(seeded.document, [labelA]);
    expect(childClipboard).not.toBeNull();
    if (childClipboard === null) return;
    const pastedIntoB = buildPasteNodesOps(seeded.document, childClipboard, {
      selectedIds: [cardB],
      createId: () => DesignNodeId.make(`pasted-${seq++}`),
    });
    expect(pastedIntoB).not.toBeNull();
    if (pastedIntoB === null) return;
    const appliedIntoB = applyDesignMutations(seeded.document, pastedIntoB.ops);
    expect(appliedIntoB.ok).toBe(true);
    if (!appliedIntoB.ok) return;
    const pastedLabel = appliedIntoB.document.nodes[pastedIntoB.pastedRootIds[0]!];
    expect(pastedLabel?.parentId).toBe(cardB);

    // Pasting at explicit world coordinates places multi-node selection with preserved relative offsets.
    const multiClipboard = serializeDesignClipboard(seeded.document, [cardA, cardB]);
    expect(multiClipboard).not.toBeNull();
    if (multiClipboard === null) return;
    const pastedAt = buildPasteNodesOps(seeded.document, multiClipboard, {
      pasteAt: { x: 50, y: 500 },
      createId: () => DesignNodeId.make(`pasted-${seq++}`),
    });
    expect(pastedAt).not.toBeNull();
    if (pastedAt === null) return;
    const appliedAt = applyDesignMutations(seeded.document, pastedAt.ops);
    expect(appliedAt.ok).toBe(true);
    if (!appliedAt.ok) return;
    expect(appliedAt.document.nodes[pastedAt.pastedRootIds[0]!]?.x).toBe(50);
    expect(appliedAt.document.nodes[pastedAt.pastedRootIds[0]!]?.y).toBe(500);
    expect(appliedAt.document.nodes[pastedAt.pastedRootIds[1]!]?.x).toBe(350);
    expect(appliedAt.document.nodes[pastedAt.pastedRootIds[1]!]?.y).toBe(500);

    // Multi-node duplicate clones both cards in one batch.
    const dupMulti = buildDuplicateNodesOps(seeded.document, [cardA, cardB], () =>
      DesignNodeId.make(`dup-${seq++}`),
    );
    expect(dupMulti?.rootCloneIds).toHaveLength(2);
  });
});
