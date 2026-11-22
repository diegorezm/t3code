import { describe, expect, it } from "vite-plus/test";
import { DesignNodeId, emptyDesignDocument } from "@t3tools/contracts";

import {
  applyDesignMutations,
  countDesignNodes,
  validateDesignDocument,
} from "./designDocument.ts";

const makeId = (raw: string) => DesignNodeId.make(raw);

describe("designDocument", () => {
  it("adds nested frame and children in a single batch and updates/reorders/deletes cleanly", () => {
    const base = emptyDesignDocument("#0f1117");
    const added = applyDesignMutations(base, [
      {
        op: "add",
        node: {
          id: makeId("hero"),
          type: "frame",
          name: "Hero",
          x: 0,
          y: 0,
          width: 1200,
          height: 600,
          fill: "#111827",
          layout: { direction: "vertical", gap: 16, padding: 32 },
        },
      },
      {
        op: "add",
        node: {
          id: makeId("title"),
          type: "text",
          name: "Headline",
          parentId: makeId("hero"),
          width: 600,
          height: 48,
          text: "Ship faster",
          fontSize: 40,
          fontWeight: 700,
          color: "#ffffff",
        },
      },
      {
        op: "add",
        node: {
          id: makeId("cta"),
          type: "rect",
          name: "CTA Button",
          parentId: makeId("hero"),
          width: 180,
          height: 44,
          fill: "#2563eb",
          radius: 8,
        },
      },
    ]);

    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(countDesignNodes(added.document)).toBe(3);
    expect(added.document.rootIds).toEqual([makeId("hero")]);
    const hero = added.document.nodes["hero"];
    expect(hero?.type === "frame" ? hero.childIds : []).toEqual([makeId("title"), makeId("cta")]);

    const updated = applyDesignMutations(added.document, [
      {
        op: "update",
        id: makeId("title"),
        patch: { text: "Ship with confidence", color: null },
      },
      {
        op: "reorder",
        id: makeId("cta"),
        index: 0,
      },
    ]);
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    const title = updated.document.nodes["title"];
    expect(title?.type === "text" ? title.text : "").toBe("Ship with confidence");
    expect(title?.type === "text" ? title.color : "present").toBeUndefined();
    const reorderedHero = updated.document.nodes["hero"];
    expect(reorderedHero?.type === "frame" ? reorderedHero.childIds : []).toEqual([
      makeId("cta"),
      makeId("title"),
    ]);

    // Deleting the frame cascades to all descendants.
    const deleted = applyDesignMutations(updated.document, [{ op: "delete", id: makeId("hero") }]);
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;
    expect(countDesignNodes(deleted.document)).toBe(0);
    expect(deleted.document.rootIds).toEqual([]);
  });

  it("rejects cycles on reparent and non-frame parents", () => {
    const setup = applyDesignMutations(emptyDesignDocument(), [
      {
        op: "add",
        node: { id: makeId("outer"), type: "frame", name: "Outer", width: 400, height: 400 },
      },
      {
        op: "add",
        node: {
          id: makeId("inner"),
          type: "frame",
          name: "Inner",
          parentId: makeId("outer"),
          width: 200,
          height: 200,
        },
      },
      {
        op: "add",
        node: {
          id: makeId("box"),
          type: "rect",
          name: "Box",
          parentId: makeId("inner"),
          width: 50,
          height: 50,
        },
      },
    ]);
    expect(setup.ok).toBe(true);
    if (!setup.ok) return;

    const cycle = applyDesignMutations(setup.document, [
      { op: "reparent", id: makeId("outer"), parentId: makeId("inner") },
    ]);
    expect(cycle.ok).toBe(false);

    const badParent = applyDesignMutations(setup.document, [
      { op: "reparent", id: makeId("inner"), parentId: makeId("box") },
    ]);
    expect(badParent.ok).toBe(false);
  });

  it("validates orphan nodes as invalid", () => {
    const result = validateDesignDocument({
      version: 1,
      rootIds: [],
      nodes: {
        orphan: {
          id: makeId("orphan"),
          type: "rect",
          name: "Orphan",
          parentId: null,
          x: 0,
          y: 0,
          width: 100,
          height: 100,
        },
      },
    });
    expect(result.ok).toBe(false);
  });
});
