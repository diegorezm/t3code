import { T3ObjectId, type T3ObjectRevisionSummary } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  clampBubblePosition,
  computeResizedBounds,
  findPreviousRevision,
} from "./designEditorTypes";

describe("designEditorTypes", () => {
  it("computes resized bounds from corner and edge handles with minimum size clamp", () => {
    const start = { x: 100, y: 100, width: 200, height: 120 };

    expect(computeResizedBounds(start, "se", 40, 30)).toEqual({
      x: 100,
      y: 100,
      width: 240,
      height: 150,
    });

    expect(computeResizedBounds(start, "nw", 50, 20)).toEqual({
      x: 150,
      y: 120,
      width: 150,
      height: 100,
    });

    expect(computeResizedBounds(start, "w", 500, 0)).toEqual({
      x: 292,
      y: 100,
      width: 8,
      height: 120,
    });
  });

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
});
