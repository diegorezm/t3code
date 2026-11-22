import { DesignNodeId, emptyDesignDocument } from "@t3tools/contracts";
import { applyDesignMutations } from "@t3tools/shared/designDocument";
import type { IUI } from "leafer-ui";
import { describe, expect, it } from "vite-plus/test";

import {
  designDocumentToLeaferTree,
  extractTransformTargets,
  getFrameLabelName,
  mapFlowAlign,
  parseCssLinearGradient,
  parseFrameLabelNodeId,
} from "./leaferSceneAdapter";

describe("leaferSceneAdapter", () => {
  it("converts frames with Auto Layout, text, and sanitized SVGs to Leafer tree nodes", () => {
    const mutated = applyDesignMutations(emptyDesignDocument("#0f1117"), [
      {
        op: "add",
        node: {
          id: DesignNodeId.make("card"),
          type: "frame",
          name: "Card",
          x: 40,
          y: 80,
          width: 360,
          height: 200,
          fill: "#18181b",
          stroke: "#27272a",
          radius: 16,
          layout: {
            direction: "vertical",
            gap: 12,
            padding: 20,
            alignItems: "center",
            justifyContent: "space-between",
          },
        },
      },
      {
        op: "add",
        node: {
          id: DesignNodeId.make("title"),
          type: "text",
          name: "Heading",
          parentId: DesignNodeId.make("card"),
          width: 320,
          height: 32,
          widthMode: "fill",
          text: "Hello Leafer",
          color: "#f8fafc",
          fontSize: 24,
          fontWeight: 700,
        },
      },
      {
        op: "add",
        node: {
          id: DesignNodeId.make("icon"),
          type: "svg",
          name: "Icon",
          parentId: DesignNodeId.make("card"),
          width: 24,
          height: 24,
          svg: '<svg onclick="bad()"><circle cx="12" cy="12" r="10"/></svg>',
        },
      },
    ]);

    expect(mutated.ok).toBe(true);
    if (!mutated.ok) return;

    const tree = designDocumentToLeaferTree(mutated.document);
    // Root frame gets a clickable, non-editable artboard label plus the Box itself.
    expect(tree).toHaveLength(2);
    expect(tree[0]?.tag).toBe("Text");
    expect(tree[0]?.editable).toBe(false);
    expect(tree[0]?.hittable).toBe(true);
    expect(parseFrameLabelNodeId(tree[0]?.name)).toBe(DesignNodeId.make("card"));

    const card = tree[1];
    expect(card?.tag).toBe("Box");
    expect(card?.flow).toBe("y");
    expect(card?.gap).toBe("auto");
    expect(card?.padding).toEqual([20, 20, 20, 20]);
    expect(card?.children).toHaveLength(2);

    const title = card?.children?.[0];
    expect(title?.tag).toBe("Text");
    expect(title?.autoWidth).toBe(1);
    expect(title?.text).toBe("Hello Leafer");

    const icon = card?.children?.[1];
    expect(icon?.tag).toBe("Image");
    expect(String(icon?.url)).toContain("data:image/svg+xml");
    expect(String(icon?.url)).not.toContain("onclick");
  });

  it("parses CSS linear-gradient values into Leafer linear fills", () => {
    const fill = parseCssLinearGradient("linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)");
    expect(typeof fill).toBe("object");
    if (typeof fill !== "object" || fill === null || !("stops" in fill)) return;
    expect(fill.type).toBe("linear");
    expect(fill.stops).toEqual([
      { offset: 0, color: "#6366f1" },
      { offset: 1, color: "#8b5cf6" },
    ]);
  });

  it("maps Auto Layout alignItems and justifyContent to Leafer flowAlign", () => {
    expect(
      mapFlowAlign({
        direction: "horizontal",
        alignItems: "center",
        justifyContent: "center",
      }),
    ).toBe("center");
    expect(
      mapFlowAlign({
        direction: "vertical",
        alignItems: "end",
        justifyContent: "start",
      }),
    ).toBe("top-right");
  });

  it("extracts transformed targets from editor.list even when EditorMoveEvent.list is empty", () => {
    const frameA = { id: "frame-a" } as IUI;
    const frameB = { id: "frame-b" } as IUI;

    expect(extractTransformTargets([frameA, frameB], frameA, [])).toEqual([frameA, frameB]);
    expect(extractTransformTargets([], frameA, [])).toEqual([frameA]);
    expect(extractTransformTargets([], undefined, [frameB])).toEqual([frameB]);
    expect(extractTransformTargets([], null, [])).toEqual([]);
  });

  it("round-trips frame label names and ignores non-label names", () => {
    const id = DesignNodeId.make("hero-frame");
    expect(parseFrameLabelNodeId(getFrameLabelName(id))).toBe(id);
    expect(parseFrameLabelNodeId("label:")).toBeNull();
    expect(parseFrameLabelNodeId("hero-frame")).toBeNull();
    expect(parseFrameLabelNodeId(undefined)).toBeNull();
  });
});
