import {
  DesignNodeId,
  type DesignDocument,
  type DesignMutationOp,
  type DesignNode,
  type DesignNodeInput,
  type DesignPadding,
  type T3ObjectRevisionSummary,
} from "@t3tools/contracts";
import { msg } from "gt-react";
import { m } from "~/i18n/messages";

export type DesignTool = "select" | "hand" | "frame" | "rect" | "ellipse" | "text" | "line";

export type DesignDrawTool = Exclude<DesignTool, "select" | "hand">;

export type LayerOrderDirection = "front" | "forward" | "backward" | "back";

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

function getSiblingIds(doc: DesignDocument, node: DesignNode): ReadonlyArray<DesignNodeId> {
  if (node.parentId === null) return doc.rootIds;
  const parent = doc.nodes[node.parentId];
  return parent?.type === "frame" ? parent.childIds : [];
}

export function getLayerOrderAvailability(
  doc: DesignDocument,
  nodeId: DesignNodeId,
): { readonly canBringForward: boolean; readonly canSendBackward: boolean } {
  const node = doc.nodes[nodeId];
  if (node === undefined) {
    return { canBringForward: false, canSendBackward: false };
  }
  const siblings = getSiblingIds(doc, node);
  const index = siblings.indexOf(nodeId);
  if (index < 0 || siblings.length <= 1) {
    return { canBringForward: false, canSendBackward: false };
  }
  return {
    canBringForward: index < siblings.length - 1,
    canSendBackward: index > 0,
  };
}

export function buildReorderNodeOp(
  doc: DesignDocument,
  nodeId: DesignNodeId,
  direction: LayerOrderDirection,
): DesignMutationOp | null {
  const node = doc.nodes[nodeId];
  if (node === undefined) return null;
  const siblings = getSiblingIds(doc, node);
  const index = siblings.indexOf(nodeId);
  if (index < 0 || siblings.length <= 1) return null;

  let targetIndex: number;
  switch (direction) {
    case "front":
      targetIndex = siblings.length - 1;
      break;
    case "forward":
      targetIndex = Math.min(siblings.length - 1, index + 1);
      break;
    case "backward":
      targetIndex = Math.max(0, index - 1);
      break;
    case "back":
      targetIndex = 0;
      break;
  }

  if (targetIndex === index) return null;
  return { op: "reorder", id: nodeId, index: targetIndex };
}

function cloneNodeToInput(
  node: DesignNode,
  overrides: {
    readonly id: DesignNodeId;
    readonly name: string;
    readonly parentId: DesignNodeId | null;
    readonly x: number;
    readonly y: number;
  },
): DesignNodeInput {
  const base = {
    id: overrides.id,
    name: overrides.name,
    parentId: overrides.parentId,
    x: overrides.x,
    y: overrides.y,
    width: node.width,
    height: node.height,
    ...(node.rotation !== undefined ? { rotation: node.rotation } : {}),
    ...(node.opacity !== undefined ? { opacity: node.opacity } : {}),
    ...(node.visible !== undefined ? { visible: node.visible } : {}),
    ...(node.locked !== undefined ? { locked: node.locked } : {}),
    ...(node.fill !== undefined ? { fill: node.fill } : {}),
    ...(node.stroke !== undefined ? { stroke: node.stroke } : {}),
    ...(node.strokeWidth !== undefined ? { strokeWidth: node.strokeWidth } : {}),
    ...(node.radius !== undefined ? { radius: node.radius } : {}),
    ...(node.shadow !== undefined ? { shadow: { ...node.shadow } } : {}),
    ...(node.widthMode !== undefined ? { widthMode: node.widthMode } : {}),
    ...(node.heightMode !== undefined ? { heightMode: node.heightMode } : {}),
  };

  switch (node.type) {
    case "frame":
      return {
        ...base,
        type: "frame",
        ...(node.clip !== undefined ? { clip: node.clip } : {}),
        ...(node.layout !== undefined ? { layout: { ...node.layout } } : {}),
      };
    case "rect":
      return { ...base, type: "rect" };
    case "ellipse":
      return { ...base, type: "ellipse" };
    case "text":
      return {
        ...base,
        type: "text",
        text: node.text,
        ...(node.color !== undefined ? { color: node.color } : {}),
        ...(node.fontSize !== undefined ? { fontSize: node.fontSize } : {}),
        ...(node.fontWeight !== undefined ? { fontWeight: node.fontWeight } : {}),
        ...(node.fontFamily !== undefined ? { fontFamily: node.fontFamily } : {}),
        ...(node.lineHeight !== undefined ? { lineHeight: node.lineHeight } : {}),
        ...(node.letterSpacing !== undefined ? { letterSpacing: node.letterSpacing } : {}),
        ...(node.textAlign !== undefined ? { textAlign: node.textAlign } : {}),
      };
    case "line":
      return {
        ...base,
        type: "line",
        ...(node.strokeDasharray !== undefined ? { strokeDasharray: node.strokeDasharray } : {}),
      };
    case "svg":
      return { ...base, type: "svg", svg: node.svg };
    case "image":
      return {
        ...base,
        type: "image",
        src: node.src,
        ...(node.objectFit !== undefined ? { objectFit: node.objectFit } : {}),
      };
  }
}

function defaultCloneNodeId(): DesignNodeId {
  const token = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return DesignNodeId.make(`node_${token}`);
}

export function buildDuplicateNodeOps(
  doc: DesignDocument,
  nodeId: DesignNodeId,
  createId: () => DesignNodeId = defaultCloneNodeId,
): { readonly ops: ReadonlyArray<DesignMutationOp>; readonly rootCloneId: DesignNodeId } | null {
  const original = doc.nodes[nodeId];
  if (original === undefined) return null;

  const usedIds = new Set<string>(Object.keys(doc.nodes));
  const nextUniqueId = (): DesignNodeId => {
    let candidate = createId();
    while (usedIds.has(candidate)) {
      candidate = createId();
    }
    usedIds.add(candidate);
    return candidate;
  };

  const parent = original.parentId === null ? undefined : doc.nodes[original.parentId];
  const inAutoLayoutParent = parent?.type === "frame" && parent.layout !== undefined;
  const siblings = getSiblingIds(doc, original);
  const originalIndex = siblings.indexOf(nodeId);
  const insertIndex = originalIndex >= 0 ? originalIndex + 1 : undefined;

  const ops: Array<DesignMutationOp> = [];
  const rootCloneId = nextUniqueId();

  const visit = (
    source: DesignNode,
    cloneId: DesignNodeId,
    parentId: DesignNodeId | null,
    isRoot: boolean,
  ) => {
    const input = cloneNodeToInput(source, {
      id: cloneId,
      name: isRoot ? `${source.name} copy` : source.name,
      parentId,
      x: isRoot && !inAutoLayoutParent ? source.x + 20 : source.x,
      y: isRoot && !inAutoLayoutParent ? source.y + 20 : source.y,
    });
    ops.push(
      isRoot && insertIndex !== undefined
        ? { op: "add", node: input, index: insertIndex }
        : { op: "add", node: input },
    );

    if (source.type === "frame") {
      for (const childId of source.childIds) {
        const child = doc.nodes[childId];
        if (child === undefined) continue;
        visit(child, nextUniqueId(), cloneId, false);
      }
    }
  };

  visit(original, rootCloneId, original.parentId, true);
  return { ops, rootCloneId };
}
