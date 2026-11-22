import { describe, expect, it } from "vite-plus/test";
import { DesignNodeId, emptyDesignDocument } from "@t3tools/contracts";

import { applyDesignMutations } from "./designDocument.ts";
import {
  inspectDesignDocument,
  renderDesignToHtml,
  renderDesignToSvg,
  sanitizeDesignSvg,
} from "./designRender.ts";

describe("designRender", () => {
  it("renders auto-layout frames, escapes text, and strips unsafe svg/image scripts", () => {
    const mutated = applyDesignMutations(emptyDesignDocument("#10141c"), [
      {
        op: "add",
        node: {
          id: DesignNodeId.make("card"),
          type: "frame",
          name: "Card",
          x: 100,
          y: 50,
          width: 400,
          height: 220,
          fill: "#1e293b",
          radius: 16,
          layout: { direction: "vertical", gap: 12, padding: 20 },
        },
      },
      {
        op: "add",
        node: {
          id: DesignNodeId.make("title"),
          type: "text",
          name: "Title",
          parentId: DesignNodeId.make("card"),
          width: 360,
          height: 32,
          text: "<script>alert(1)</script>",
          color: "#ffffff",
          fontSize: 24,
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
          svg: '<svg onclick="alert(1)"><script>bad()</script><circle cx="12" cy="12" r="10"/></svg>',
        },
      },
    ]);

    expect(mutated.ok).toBe(true);
    if (!mutated.ok) return;

    const rendered = renderDesignToHtml(mutated.document, { frameId: DesignNodeId.make("card") });
    expect(rendered.width).toBe(400);
    expect(rendered.height).toBe(220);
    expect(rendered.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).not.toContain("onclick=");
    expect(rendered.html).toContain("display:flex");

    const tree = inspectDesignDocument(mutated.document);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.children).toHaveLength(2);

    const exportedSvg = renderDesignToSvg(mutated.document, { frameId: DesignNodeId.make("card") });
    expect(exportedSvg.width).toBe(400);
    expect(exportedSvg.height).toBe(220);
    expect(exportedSvg.svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(exportedSvg.svg).toContain('id="Card"');
    expect(exportedSvg.svg).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(exportedSvg.svg).not.toContain("<script>");
  });

  it("sanitizes svg event handlers and foreignObject", () => {
    const cleaned = sanitizeDesignSvg(
      '<svg onload="x()"><foreignObject><div>hi</div></foreignObject><path d="M0 0"/></svg>',
    );
    expect(cleaned).not.toContain("onload=");
    expect(cleaned).not.toContain("foreignObject");
    expect(cleaned).toContain('<path d="M0 0"/>');
  });

  it("exports individual nested components and multi-node selections with transparent backgrounds", () => {
    const mutated = applyDesignMutations(emptyDesignDocument("#10141c"), [
      {
        op: "add",
        node: {
          id: DesignNodeId.make("page"),
          type: "frame",
          name: "Page",
          x: 0,
          y: 0,
          width: 800,
          height: 400,
          fill: "#0f172a",
          layout: { direction: "horizontal", gap: 20, padding: 24 },
        },
      },
      {
        op: "add",
        node: {
          id: DesignNodeId.make("card-a"),
          type: "frame",
          name: "Starter",
          parentId: DesignNodeId.make("page"),
          width: 240,
          height: 300,
          fill: "#1e293b",
          radius: 16,
        },
      },
      {
        op: "add",
        node: {
          id: DesignNodeId.make("title-a"),
          type: "text",
          name: "Starter Title",
          parentId: DesignNodeId.make("card-a"),
          x: 16,
          y: 16,
          width: 180,
          height: 28,
          text: "Starter",
        },
      },
      {
        op: "add",
        node: {
          id: DesignNodeId.make("card-b"),
          type: "frame",
          name: "Pro",
          parentId: DesignNodeId.make("page"),
          width: 260,
          height: 300,
          fill: "#312e81",
          radius: 16,
        },
      },
    ]);
    expect(mutated.ok).toBe(true);
    if (!mutated.ok) return;

    const singleSvg = renderDesignToSvg(mutated.document, {
      nodeIds: [DesignNodeId.make("card-a"), DesignNodeId.make("title-a")],
      transparent: true,
    });
    expect(singleSvg.width).toBe(240);
    expect(singleSvg.height).toBe(300);
    expect(singleSvg.svg).not.toContain('fill="#10141c"');
    expect(singleSvg.svg).toContain('id="Starter"');
    expect(singleSvg.svg).not.toContain('id="Pro"');

    const multiSvg = renderDesignToSvg(mutated.document, {
      nodeIds: [DesignNodeId.make("card-a"), DesignNodeId.make("card-b")],
      transparent: true,
    });
    // Two horizontal cards (240 + 20 gap + 260 = 520)
    expect(multiSvg.width).toBe(520);
    expect(multiSvg.height).toBe(300);
    expect(multiSvg.svg).toContain('id="Starter"');
    expect(multiSvg.svg).toContain('id="Pro"');

    const singleHtml = renderDesignToHtml(mutated.document, {
      nodeIds: [DesignNodeId.make("card-a")],
      transparent: true,
    });
    expect(singleHtml.width).toBe(240);
    expect(singleHtml.height).toBe(300);
    expect(singleHtml.html).toContain("background: transparent");
    expect(singleHtml.html).toContain("Starter");
    expect(singleHtml.html).not.toContain("Pro");
  });
});
