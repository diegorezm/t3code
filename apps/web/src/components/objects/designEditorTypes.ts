import type {
  DesignDocument,
  DesignNode,
  DesignNodeId,
  DesignNodeInput,
  DesignPadding,
  T3ObjectRevisionSummary,
} from "@t3tools/contracts";
import { msg } from "gt-react";
import { m } from "~/i18n/messages";

export type DesignTool = "select" | "hand" | "frame" | "rect" | "ellipse" | "text" | "line";

export type DesignDrawTool = Exclude<DesignTool, "select" | "hand">;

export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export interface ViewportTransform {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export interface NodeBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

export interface Point2D {
  readonly x: number;
  readonly y: number;
}

export function clampZoom(zoom: number): number {
  return Math.min(4, Math.max(0.15, Math.round(zoom * 100) / 100));
}

export function normalizePadding(padding: DesignPadding | undefined): {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
} {
  if (padding === undefined) {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
  if (typeof padding === "number") {
    return { top: padding, right: padding, bottom: padding, left: padding };
  }
  return padding;
}

export function computeResizedBounds(
  start: NodeBounds,
  handle: ResizeHandle,
  dx: number,
  dy: number,
): NodeBounds {
  let x = start.x;
  let y = start.y;
  let width = start.width;
  let height = start.height;

  if (handle.includes("e")) {
    width = Math.max(8, start.width + dx);
  }
  if (handle.includes("s")) {
    height = Math.max(8, start.height + dy);
  }
  if (handle.includes("w")) {
    const nextWidth = Math.max(8, start.width - dx);
    x = start.x + (start.width - nextWidth);
    width = nextWidth;
  }
  if (handle.includes("n")) {
    const nextHeight = Math.max(8, start.height - dy);
    y = start.y + (start.height - nextHeight);
    height = nextHeight;
  }

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

export function computeDocumentBounds(doc: DesignDocument): NodeBounds | null {
  const roots = doc.rootIds
    .map((id) => doc.nodes[id])
    .filter((node): node is DesignNode => node !== undefined && node.visible !== false);
  if (roots.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of roots) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

export function makeNodeInputForTool(
  tool: DesignDrawTool,
  bounds: NodeBounds,
  parentId: DesignNodeId | null,
): DesignNodeInput {
  const width = Math.max(tool === "line" ? 24 : 32, Math.round(bounds.width));
  const height = Math.max(tool === "line" ? 4 : 24, Math.round(bounds.height));
  const x = Math.round(bounds.x);
  const y = Math.round(bounds.y);

  switch (tool) {
    case "frame":
      return {
        type: "frame",
        name: "Frame",
        parentId,
        x,
        y,
        width: Math.max(120, width),
        height: Math.max(80, height),
        fill: "#18181b",
        stroke: "#27272a",
        strokeWidth: 1,
        radius: 12,
        clip: true,
      };
    case "rect":
      return {
        type: "rect",
        name: "Rectangle",
        parentId,
        x,
        y,
        width,
        height,
        fill: "#2563eb",
        radius: 8,
      };
    case "ellipse":
      return {
        type: "ellipse",
        name: "Ellipse",
        parentId,
        x,
        y,
        width,
        height,
        fill: "#7c3aed",
      };
    case "text":
      return {
        type: "text",
        name: "Text",
        parentId,
        x,
        y,
        width: Math.max(160, width),
        height: Math.max(32, height),
        text: m(msg("Text")),
        color: "#f8fafc",
        fontSize: 18,
        fontWeight: 500,
      };
    case "line":
      return {
        type: "line",
        name: "Line",
        parentId,
        x,
        y,
        width: Math.max(80, width),
        height: Math.max(4, Math.min(height, 16)),
        stroke: "#71717a",
        strokeWidth: 2,
      };
  }
}

export function clampBubblePosition(
  anchor: Point2D,
  viewport: ViewportSize,
  bubble: ViewportSize,
  margin = 12,
  offset = 14,
): { readonly left: number; readonly top: number } {
  const maxLeft = Math.max(margin, viewport.width - bubble.width - margin);
  const idealLeft = anchor.x - bubble.width / 2;
  const left = Math.round(Math.min(maxLeft, Math.max(margin, idealLeft)));

  const belowTop = anchor.y + offset;
  const aboveTop = anchor.y - bubble.height - offset;
  const maxTop = Math.max(margin, viewport.height - bubble.height - margin);
  const chosenTop =
    belowTop + bubble.height + margin <= viewport.height
      ? belowTop
      : aboveTop >= margin
        ? aboveTop
        : belowTop;
  const top = Math.round(Math.min(maxTop, Math.max(margin, chosenTop)));

  return { left, top };
}

export function findPreviousRevision(
  revisions: ReadonlyArray<T3ObjectRevisionSummary>,
  cursorRevision: number,
): number | null {
  let candidate: number | null = null;
  for (const rev of revisions) {
    if (rev.revision < cursorRevision && (candidate === null || rev.revision > candidate)) {
      candidate = rev.revision;
    }
  }
  return candidate;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}
