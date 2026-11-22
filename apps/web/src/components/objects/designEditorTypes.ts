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

function isNodeDescendant(
  doc: DesignDocument,
  candidateAncestorId: DesignNodeId,
  nodeId: DesignNodeId,
): boolean {
  let cursor = doc.nodes[nodeId];
  while (cursor !== undefined) {
    if (cursor.parentId === candidateAncestorId) return true;
    if (cursor.parentId === null) return false;
    cursor = doc.nodes[cursor.parentId];
  }
  return false;
}

export function normalizeSelectedNodeIds(
  doc: DesignDocument,
  ids: ReadonlyArray<DesignNodeId>,
): ReadonlyArray<DesignNodeId> {
  const unique: Array<DesignNodeId> = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id) || !(id in doc.nodes)) continue;
    seen.add(id);
    unique.push(id);
  }
  if (unique.length <= 1) return unique;
  return unique.filter(
    (id) => !unique.some((other) => other !== id && isNodeDescendant(doc, other, id)),
  );
}

export function getSelectAllNodeIds(
  doc: DesignDocument,
  currentSelectedIds: ReadonlyArray<DesignNodeId>,
): ReadonlyArray<DesignNodeId> {
  const normalized = normalizeSelectedNodeIds(doc, currentSelectedIds);
  if (normalized.length > 0) {
    const first = doc.nodes[normalized[0]!];
    if (first !== undefined && first.parentId !== null) {
      const parent = doc.nodes[first.parentId];
      if (parent?.type === "frame") {
        const siblings = parent.childIds.filter((id) => {
          const child = doc.nodes[id];
          return child !== undefined && child.visible !== false && child.locked !== true;
        });
        if (siblings.length > 0) return siblings;
      }
    }
  }
  return doc.rootIds.filter((id) => {
    const node = doc.nodes[id];
    return node !== undefined && node.visible !== false && node.locked !== true;
  });
}

function getNodeWorldPosition(doc: DesignDocument, nodeId: DesignNodeId): Point2D {
  let x = 0;
  let y = 0;
  let cursor = doc.nodes[nodeId];
  while (cursor !== undefined) {
    x += cursor.x;
    y += cursor.y;
    if (cursor.parentId === null) break;
    cursor = doc.nodes[cursor.parentId];
  }
  return { x, y };
}

function defaultCloneNodeId(): DesignNodeId {
  const token = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return DesignNodeId.make(`node_${token}`);
}

function createUniqueIdFactory(
  doc: DesignDocument,
  createId: () => DesignNodeId = defaultCloneNodeId,
): () => DesignNodeId {
  const usedIds = new Set<string>(Object.keys(doc.nodes));
  return () => {
    let candidate = createId();
    while (usedIds.has(candidate)) {
      candidate = createId();
    }
    usedIds.add(candidate);
    return candidate;
  };
}

export function buildDuplicateNodesOps(
  doc: DesignDocument,
  nodeIds: ReadonlyArray<DesignNodeId>,
  createId: () => DesignNodeId = defaultCloneNodeId,
): {
  readonly ops: ReadonlyArray<DesignMutationOp>;
  readonly rootCloneIds: ReadonlyArray<DesignNodeId>;
} | null {
  const normalized = normalizeSelectedNodeIds(doc, nodeIds);
  if (normalized.length === 0) return null;

  const nextUniqueId = createUniqueIdFactory(doc, createId);
  const ops: Array<DesignMutationOp> = [];
  const rootCloneIds: Array<DesignNodeId> = [];

  // Track extra insertions per parent so multi-node sibling duplicates stay cleanly ordered.
  const insertedCountByParent = new Map<string, number>();

  for (const nodeId of normalized) {
    const original = doc.nodes[nodeId];
    if (original === undefined) continue;

    const parentKey = original.parentId ?? "__root__";
    const parent = original.parentId === null ? undefined : doc.nodes[original.parentId];
    const inAutoLayoutParent = parent?.type === "frame" && parent.layout !== undefined;
    const siblings = getSiblingIds(doc, original);
    const originalIndex = siblings.indexOf(nodeId);
    const prevInserted = insertedCountByParent.get(parentKey) ?? 0;
    const insertIndex = originalIndex >= 0 ? originalIndex + 1 + prevInserted : undefined;
    insertedCountByParent.set(parentKey, prevInserted + 1);

    const rootCloneId = nextUniqueId();
    rootCloneIds.push(rootCloneId);

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
  }

  return ops.length > 0 ? { ops, rootCloneIds } : null;
}

export function buildDuplicateNodeOps(
  doc: DesignDocument,
  nodeId: DesignNodeId,
  createId: () => DesignNodeId = defaultCloneNodeId,
): { readonly ops: ReadonlyArray<DesignMutationOp>; readonly rootCloneId: DesignNodeId } | null {
  const result = buildDuplicateNodesOps(doc, [nodeId], createId);
  if (result === null || result.rootCloneIds[0] === undefined) return null;
  return { ops: result.ops, rootCloneId: result.rootCloneIds[0] };
}

export interface DesignClipboardNodeTree {
  readonly input: DesignNodeInput;
  readonly children: ReadonlyArray<DesignClipboardNodeTree>;
}

export interface DesignClipboardEntry {
  readonly sourceId: DesignNodeId;
  readonly sourceParentId: DesignNodeId | null;
  readonly worldX: number;
  readonly worldY: number;
  readonly tree: DesignClipboardNodeTree;
}

export interface DesignClipboardPayload {
  readonly __t3DesignClipboard: 1;
  readonly entries: ReadonlyArray<DesignClipboardEntry>;
}

function serializeSubtree(doc: DesignDocument, node: DesignNode): DesignClipboardNodeTree {
  const input = cloneNodeToInput(node, {
    id: node.id,
    name: node.name,
    parentId: node.parentId,
    x: node.x,
    y: node.y,
  });
  const children: Array<DesignClipboardNodeTree> = [];
  if (node.type === "frame") {
    for (const childId of node.childIds) {
      const child = doc.nodes[childId];
      if (child === undefined) continue;
      children.push(serializeSubtree(doc, child));
    }
  }
  return { input, children };
}

export function serializeDesignClipboard(
  doc: DesignDocument,
  nodeIds: ReadonlyArray<DesignNodeId>,
): DesignClipboardPayload | null {
  const normalized = normalizeSelectedNodeIds(doc, nodeIds);
  if (normalized.length === 0) return null;

  const entries: Array<DesignClipboardEntry> = [];
  for (const id of normalized) {
    const node = doc.nodes[id];
    if (node === undefined) continue;
    const world = getNodeWorldPosition(doc, id);
    entries.push({
      sourceId: id,
      sourceParentId: node.parentId,
      worldX: world.x,
      worldY: world.y,
      tree: serializeSubtree(doc, node),
    });
  }
  return entries.length > 0 ? { __t3DesignClipboard: 1, entries } : null;
}

const VALID_NODE_TYPES = new Set(["frame", "rect", "ellipse", "text", "line", "svg", "image"]);

function isValidClipboardTree(value: unknown): value is DesignClipboardNodeTree {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { input?: unknown; children?: unknown };
  if (typeof candidate.input !== "object" || candidate.input === null) return false;
  const input = candidate.input as {
    type?: unknown;
    name?: unknown;
    width?: unknown;
    height?: unknown;
  };
  if (
    typeof input.type !== "string" ||
    !VALID_NODE_TYPES.has(input.type) ||
    typeof input.name !== "string" ||
    typeof input.width !== "number" ||
    typeof input.height !== "number"
  ) {
    return false;
  }
  if (!Array.isArray(candidate.children)) return false;
  return candidate.children.every((child) => isValidClipboardTree(child));
}

export function parseDesignClipboard(raw: string): DesignClipboardPayload | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed) as {
      __t3DesignClipboard?: unknown;
      entries?: unknown;
    };
    if (parsed.__t3DesignClipboard !== 1 || !Array.isArray(parsed.entries)) return null;
    if (parsed.entries.length === 0) return null;
    for (const entry of parsed.entries) {
      if (typeof entry !== "object" || entry === null) return null;
      const item = entry as {
        sourceId?: unknown;
        sourceParentId?: unknown;
        worldX?: unknown;
        worldY?: unknown;
        tree?: unknown;
      };
      if (
        typeof item.sourceId !== "string" ||
        (item.sourceParentId !== null && typeof item.sourceParentId !== "string") ||
        typeof item.worldX !== "number" ||
        typeof item.worldY !== "number" ||
        !isValidClipboardTree(item.tree)
      ) {
        return null;
      }
    }
    return parsed as DesignClipboardPayload;
  } catch {
    return null;
  }
}

export function buildPasteNodesOps(
  doc: DesignDocument,
  payload: DesignClipboardPayload,
  options: {
    readonly selectedIds?: ReadonlyArray<DesignNodeId>;
    readonly pasteAt?: Point2D | null;
    readonly pasteCount?: number;
    readonly viewportCenter?: Point2D;
    readonly createId?: () => DesignNodeId;
  } = {},
): {
  readonly ops: ReadonlyArray<DesignMutationOp>;
  readonly pastedRootIds: ReadonlyArray<DesignNodeId>;
} | null {
  if (payload.entries.length === 0) return null;

  const nextUniqueId = createUniqueIdFactory(doc, options.createId);
  const offset = 20 * Math.max(1, options.pasteCount ?? 1);
  const sourceIdSet = new Set<string>(payload.entries.map((entry) => entry.sourceId));

  // If the user explicitly selected a different single frame (not one of the copied nodes),
  // paste directly inside that frame.
  const normalizedSelected = normalizeSelectedNodeIds(doc, options.selectedIds ?? []);
  const explicitTargetFrame =
    options.pasteAt == null && normalizedSelected.length === 1
      ? (() => {
          const candidateId = normalizedSelected[0]!;
          const candidate = doc.nodes[candidateId];
          if (candidate?.type !== "frame") return null;
          if (sourceIdSet.has(candidateId)) return null;
          return candidate;
        })()
      : null;

  let minWorldX = Infinity;
  let minWorldY = Infinity;
  let maxWorldX = -Infinity;
  let maxWorldY = -Infinity;
  for (const entry of payload.entries) {
    minWorldX = Math.min(minWorldX, entry.worldX);
    minWorldY = Math.min(minWorldY, entry.worldY);
    maxWorldX = Math.max(maxWorldX, entry.worldX + entry.tree.input.width);
    maxWorldY = Math.max(maxWorldY, entry.worldY + entry.tree.input.height);
  }
  const groupW = Math.max(0, maxWorldX - minWorldX);
  const groupH = Math.max(0, maxWorldY - minWorldY);

  const ops: Array<DesignMutationOp> = [];
  const pastedRootIds: Array<DesignNodeId> = [];

  const emitTree = (
    tree: DesignClipboardNodeTree,
    cloneId: DesignNodeId,
    parentId: DesignNodeId | null,
    x: number,
    y: number,
  ) => {
    const input: DesignNodeInput = {
      ...tree.input,
      id: cloneId,
      parentId,
      x: Math.round(x),
      y: Math.round(y),
    };
    ops.push({ op: "add", node: input });
    for (const child of tree.children) {
      emitTree(child, nextUniqueId(), cloneId, child.input.x ?? 0, child.input.y ?? 0);
    }
  };

  for (const entry of payload.entries) {
    const cloneId = nextUniqueId();
    pastedRootIds.push(cloneId);

    if (options.pasteAt !== undefined && options.pasteAt !== null) {
      const targetX = options.pasteAt.x + (entry.worldX - minWorldX);
      const targetY = options.pasteAt.y + (entry.worldY - minWorldY);
      emitTree(entry.tree, cloneId, null, targetX, targetY);
      continue;
    }

    if (explicitTargetFrame !== null) {
      const inAutoLayout = explicitTargetFrame.layout !== undefined;
      const targetX = inAutoLayout ? (entry.tree.input.x ?? 0) : 20 + (entry.worldX - minWorldX);
      const targetY = inAutoLayout ? (entry.tree.input.y ?? 0) : 20 + (entry.worldY - minWorldY);
      emitTree(entry.tree, cloneId, explicitTargetFrame.id, targetX, targetY);
      continue;
    }

    if (entry.sourceParentId === null) {
      const targetX = (entry.tree.input.x ?? entry.worldX) + offset;
      const targetY = (entry.tree.input.y ?? entry.worldY) + offset;
      emitTree(entry.tree, cloneId, null, targetX, targetY);
      continue;
    }

    const originalParent = doc.nodes[entry.sourceParentId];
    if (originalParent?.type === "frame") {
      const inAutoLayout = originalParent.layout !== undefined;
      const targetX = inAutoLayout ? (entry.tree.input.x ?? 0) : (entry.tree.input.x ?? 0) + offset;
      const targetY = inAutoLayout ? (entry.tree.input.y ?? 0) : (entry.tree.input.y ?? 0) + offset;
      emitTree(entry.tree, cloneId, originalParent.id, targetX, targetY);
      continue;
    }

    // Fallback (e.g., pasted across different Design Objects): place centered in viewport.
    const center = options.viewportCenter ?? { x: 120 + groupW / 2, y: 120 + groupH / 2 };
    const targetX = center.x - groupW / 2 + (entry.worldX - minWorldX);
    const targetY = center.y - groupH / 2 + (entry.worldY - minWorldY);
    emitTree(entry.tree, cloneId, null, targetX, targetY);
  }

  return ops.length > 0 ? { ops, pastedRootIds } : null;
}
