import type {
  DesignDocument,
  DesignMutationOp,
  DesignNodeId,
  DesignNodeInput,
} from "@t3tools/contracts";
import {
  EditorEvent,
  EditorGroupEvent,
  EditorMoveEvent,
  EditorRotateEvent,
  EditorScaleEvent,
  InnerEditorEvent,
} from "@leafer-in/editor";
import "@leafer-in/flow";
import "@leafer-in/text-editor";
import "@leafer-in/view";
import "@leafer-in/viewport";
import {
  App,
  DragEvent,
  Group,
  Leafer,
  MoveEvent,
  PointerEvent as LeaferPointerEvent,
  ZoomEvent,
  type IUI,
  type IUIInputData,
} from "leafer-ui";
import { useGT } from "gt-react";
import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";
import {
  clampBubblePosition,
  isEditableTarget,
  makeNodeInputForTool,
  normalizeSelectedNodeIds,
  type DesignDrawTool,
  type DesignTool,
  type NodeBounds,
  type Point2D,
  type ViewportSize,
  type ViewportTransform,
} from "./designEditorTypes";
import {
  designDocumentToLeaferTree,
  designNodeToLeaferInput,
  extractTransformTargets,
  FRAME_LABEL_OFFSET_Y,
  parseFrameLabelNodeId,
  readLeaferNodePatch,
} from "./leaferSceneAdapter";

export interface DesignCanvasHandle {
  readonly fitView: () => void;
  readonly zoomIn: () => void;
  readonly zoomOut: () => void;
  readonly getNodeAnchorWorld: (id: DesignNodeId) => Point2D | null;
  readonly getViewportCenterWorld: () => Point2D;
  readonly startRename: (id: DesignNodeId) => void;
  readonly isEditingText: () => boolean;
  readonly exportNodesToPng: (
    nodeIds: ReadonlyArray<DesignNodeId> | null,
    options?: { readonly transparent?: boolean; readonly scale?: number },
  ) => Promise<Blob | null>;
}

export type DesignCanvasContextMenuRequest =
  | {
      readonly kind: "node";
      readonly nodeId: DesignNodeId;
      readonly nodeIds: ReadonlyArray<DesignNodeId>;
      readonly clientX: number;
      readonly clientY: number;
      readonly worldX: number;
      readonly worldY: number;
    }
  | {
      readonly kind: "canvas";
      readonly clientX: number;
      readonly clientY: number;
      readonly worldX: number;
      readonly worldY: number;
    };

interface InlineRenameState {
  readonly nodeId: DesignNodeId;
  readonly draft: string;
  readonly worldX: number;
  readonly worldY: number;
}

interface DrawDraft {
  readonly pointerId: number;
  readonly tool: DesignDrawTool;
  readonly parentId: DesignNodeId | null;
  readonly startWorldX: number;
  readonly startWorldY: number;
  readonly currentWorldX: number;
  readonly currentWorldY: number;
}

const BUBBLE_WIDTH_PX = 360;
const BUBBLE_HEIGHT_PX = 52;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 4;

function isDrawTool(tool: DesignTool): tool is DesignDrawTool {
  return tool !== "select" && tool !== "hand";
}

function readTreeViewport(app: App): ViewportTransform {
  const scale = typeof app.tree.scaleX === "number" && app.tree.scaleX > 0 ? app.tree.scaleX : 1;
  return {
    x: app.tree.x ?? 0,
    y: app.tree.y ?? 0,
    zoom: Math.round(scale * 100) / 100,
  };
}

function clearEditorHover(app: App): void {
  // Leafer's `hoverTarget` setter clears `hoverStroker` on null, but its `.d.ts` omits `| null`.
  (app.editor as { hoverTarget: IUI | null }).hoverTarget = null;
}

function sameNodeIdList(a: ReadonlyArray<DesignNodeId>, b: ReadonlyArray<DesignNodeId>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function readEditorSelectedIds(app: App, doc: DesignDocument): ReadonlyArray<DesignNodeId> {
  const raw: Array<DesignNodeId> = [];
  for (const item of app.editor.list) {
    if (typeof item.id === "string" && item.id in doc.nodes) {
      raw.push(item.id as DesignNodeId);
    }
  }
  return normalizeSelectedNodeIds(doc, raw);
}

function syncFrameLabelAppearance(
  labels: ReadonlyMap<string, IUI>,
  selectedIds: ReadonlyArray<DesignNodeId>,
  renamingNodeId: DesignNodeId | null,
): void {
  const selectedSet = new Set<string>(selectedIds);
  for (const [frameId, label] of labels) {
    label.set({
      fill: selectedSet.has(frameId) ? "#60a5fa" : "#71717a",
      visible: frameId !== renamingNodeId,
    });
  }
}

function findFrameLabelNodeId(target: unknown, doc: DesignDocument): DesignNodeId | null {
  const cursor = target as { name?: unknown } | null | undefined;
  const labelNodeId = parseFrameLabelNodeId(cursor?.name);
  return labelNodeId !== null && labelNodeId in doc.nodes ? labelNodeId : null;
}

function findDocumentNodeId(target: unknown, doc: DesignDocument): DesignNodeId | null {
  let cursor = target as { id?: unknown; name?: unknown; parent?: unknown } | null | undefined;
  while (cursor !== null && cursor !== undefined) {
    if (typeof cursor.id === "string" && cursor.id in doc.nodes) {
      return cursor.id as DesignNodeId;
    }
    const labelNodeId = parseFrameLabelNodeId(cursor.name);
    if (labelNodeId !== null && labelNodeId in doc.nodes) {
      return labelNodeId;
    }
    cursor = cursor.parent as { id?: unknown; name?: unknown; parent?: unknown } | null | undefined;
  }
  return null;
}

function findDeepUnlockedNodeId(
  picked: { readonly target?: unknown; readonly path?: { readonly list?: ReadonlyArray<unknown> } },
  doc: DesignDocument,
): DesignNodeId | null {
  const pathList = picked.path?.list;
  if (Array.isArray(pathList) && pathList.length > 0) {
    for (const leaf of pathList) {
      const id = findDocumentNodeId(leaf, doc);
      if (id === null) continue;
      const node = doc.nodes[id];
      if (node === undefined || node.visible === false || node.locked === true) continue;
      if (node.type === "frame" && node.parentId === null && node.childIds.length > 0) {
        continue;
      }
      return id;
    }
  }
  const fallbackId = findDocumentNodeId(picked.target, doc);
  if (fallbackId === null) return null;
  const node = doc.nodes[fallbackId];
  return node !== undefined && node.visible !== false && node.locked !== true ? fallbackId : null;
}

function applySelectionToEditor(
  app: App,
  contentLayer: Group,
  ids: ReadonlyArray<DesignNodeId>,
): void {
  const targets: Array<IUI> = [];
  for (const id of ids) {
    const leaf = contentLayer.findId(id) as IUI | undefined;
    if (leaf !== undefined) {
      targets.push(leaf);
    }
  }
  app.editor.target = targets;
}

export function DesignCanvasViewport({
  doc,
  tool,
  selectedIds,
  pickActive,
  selectionAnchorWorld,
  selectionOverlay,
  bottomOverlay,
  spacePressed,
  handleRef,
  onViewportChange,
  onViewportSizeChange,
  onSelectIds,
  onPickNode,
  onAddNode,
  onCommitOps,
  onContextMenu,
}: {
  readonly doc: DesignDocument;
  readonly tool: DesignTool;
  readonly selectedIds: ReadonlyArray<DesignNodeId>;
  readonly pickActive: boolean;
  readonly selectionAnchorWorld: Point2D | null;
  readonly selectionOverlay: ReactNode;
  readonly bottomOverlay?: ReactNode;
  readonly spacePressed: boolean;
  readonly handleRef: { current: DesignCanvasHandle | null };
  readonly onViewportChange: (next: ViewportTransform) => void;
  readonly onViewportSizeChange: (size: ViewportSize) => void;
  readonly onSelectIds: (ids: ReadonlyArray<DesignNodeId>) => void;
  readonly onPickNode: (id: DesignNodeId | null, anchorWorld: Point2D | null) => void;
  readonly onAddNode: (input: DesignNodeInput) => void;
  readonly onCommitOps: (ops: ReadonlyArray<DesignMutationOp>, summary: string) => void;
  readonly onContextMenu?: (request: DesignCanvasContextMenuRequest) => void;
}) {
  const gt = useGT();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const renameCommittedRef = useRef(false);
  const appRef = useRef<App | null>(null);
  const contentLayerRef = useRef<Group | null>(null);
  const frameLabelsRef = useRef<Map<string, IUI>>(new Map());
  const syncingSelectionRef = useRef(false);
  const editingTextRef = useRef(false);
  const dirtyIdsRef = useRef<Set<string>>(new Set());
  const hasAutoFitRef = useRef(false);

  const [viewport, setViewport] = useState<ViewportTransform>({ x: 64, y: 48, zoom: 1 });
  const [viewportSize, setViewportSize] = useState<ViewportSize>({ width: 800, height: 600 });
  const [drawDraft, setDrawDraft] = useState<DrawDraft | null>(null);
  const drawDraftRef = useRef<DrawDraft | null>(null);
  const [inlineRename, setInlineRename] = useState<InlineRenameState | null>(null);

  const latestRef = useRef({
    doc,
    tool,
    selectedIds,
    pickActive,
    spacePressed,
    inlineRename,
    onViewportChange,
    onViewportSizeChange,
    onSelectIds,
    onPickNode,
    onAddNode,
    onCommitOps,
    onContextMenu,
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps latest callbacks and state synced for Leafer imperative event listeners without recreating the canvas
  useEffect(() => {
    latestRef.current = {
      doc,
      tool,
      selectedIds,
      pickActive,
      spacePressed,
      inlineRename,
      onViewportChange,
      onViewportSizeChange,
      onSelectIds,
      onPickNode,
      onAddNode,
      onCommitOps,
      onContextMenu,
    };
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- observes viewport host dimensions for bubble clamping and compact responsive controls
  useEffect(() => {
    const element = hostRef.current;
    if (element === null) return;
    const applySize = (width: number, height: number) => {
      if (width > 0 && height > 0) {
        const next = { width: Math.round(width), height: Math.round(height) };
        setViewportSize(next);
        latestRef.current.onViewportSizeChange(next);
      }
    };
    const initialRect = element.getBoundingClientRect();
    applySize(initialRect.width, initialRect.height);
    return observeResize(element, (entries) => {
      const entry = entries[0];
      if (entry !== undefined) {
        applySize(entry.contentRect.width, entry.contentRect.height);
      }
    });
  }, []);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- mounts and destroys the Leafer App instance and binds editor, viewport, and text-editor events
  useEffect(() => {
    const mountEl = canvasMountRef.current;
    if (mountEl === null) return;

    const app = new App({
      view: mountEl,
      tree: {
        type: "viewport",
        move: {
          holdSpaceKey: false,
          holdMiddleKey: true,
          drag: false,
        },
        zoom: { min: 0.15, max: 4 },
        wheel: { preventDefault: true },
      },
      editor: {
        keyEvent: false,
        editSize: "size",
        stroke: "#3b82f6",
        strokeWidth: 1.5,
        pointSize: 8,
        hover: true,
        boxSelect: true,
        multipleSelect: true,
        skipNested: true,
        rotateable: true,
        skewable: false,
        openInner: "double",
      },
    });

    const contentLayer = new Group({ name: "t3-design-content" });
    app.tree.add(contentLayer);
    app.tree.x = 64;
    app.tree.y = 48;

    appRef.current = app;
    contentLayerRef.current = contentLayer;
    hasAutoFitRef.current = false;

    const emitViewport = () => {
      const next = readTreeViewport(app);
      setViewport(next);
      latestRef.current.onViewportChange(next);
    };
    emitViewport();

    let zoomAnim: {
      targetZoom: number;
      focal: Point2D;
      rafId: number | null;
      lastTime: number;
    } | null = null;

    const cancelZoomAnim = () => {
      if (zoomAnim?.rafId !== null && zoomAnim?.rafId !== undefined) {
        window.cancelAnimationFrame(zoomAnim.rafId);
      }
      zoomAnim = null;
    };

    const getCurrentZoom = () =>
      typeof app.tree.scaleX === "number" && app.tree.scaleX > 0 ? app.tree.scaleX : 1;

    const applyZoomAt = (focal: Point2D, targetScale: number) => {
      const current = getCurrentZoom();
      const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, targetScale));
      const factor = clamped / current;
      if (Math.abs(factor - 1) < 0.0005) return;
      clearEditorHover(app);
      app.tree.scaleOfWorld(focal, factor, factor);
      app.tree.updateLayout();
      app.editor.updateEditBox();
      emitViewport();
    };

    const smoothZoomTo = (targetScale: number, focal: Point2D, immediate: boolean) => {
      const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, targetScale));
      if (immediate) {
        cancelZoomAnim();
        applyZoomAt(focal, clamped);
        return;
      }

      const step = (now: number) => {
        if (zoomAnim === null) return;
        const dt = Math.min(0.05, Math.max(0.001, (now - zoomAnim.lastTime) / 1000));
        zoomAnim.lastTime = now;
        const current = getCurrentZoom();
        const alpha = 1 - Math.exp(-dt * 20);
        const nextLog =
          Math.log(current) + (Math.log(zoomAnim.targetZoom) - Math.log(current)) * alpha;
        if (Math.abs(Math.log(zoomAnim.targetZoom) - nextLog) < 0.002) {
          const finalZoom = zoomAnim.targetZoom;
          const finalFocal = zoomAnim.focal;
          zoomAnim = null;
          applyZoomAt(finalFocal, finalZoom);
          return;
        }
        applyZoomAt(zoomAnim.focal, Math.exp(nextLog));
        zoomAnim.rafId = window.requestAnimationFrame(step);
      };

      if (zoomAnim === null) {
        zoomAnim = { targetZoom: clamped, focal, rafId: null, lastTime: performance.now() };
        zoomAnim.rafId = window.requestAnimationFrame(step);
      } else {
        zoomAnim.targetZoom = clamped;
        zoomAnim.focal = focal;
      }
    };

    const onCaptureWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const rect = mountEl.getBoundingClientRect();
      const focal: Point2D = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      const rawDelta = event.deltaY || event.deltaX;
      if (rawDelta === 0) return;

      const isTrackpadPinch = Math.abs(rawDelta) < 15 || !Number.isInteger(rawDelta);
      const clampedDelta = Math.max(-120, Math.min(120, rawDelta));
      const baseZoom = zoomAnim !== null ? zoomAnim.targetZoom : getCurrentZoom();
      const factor = Math.exp(-clampedDelta * (isTrackpadPinch ? 0.008 : 0.0018));
      smoothZoomTo(baseZoom * factor, focal, isTrackpadPinch);
    };
    mountEl.addEventListener("wheel", onCaptureWheel, { capture: true, passive: false });

    const flushDirtyTransforms = () => {
      if (dirtyIdsRef.current.size === 0) return;
      const ids = Array.from(dirtyIdsRef.current);
      dirtyIdsRef.current.clear();

      const activeDoc = latestRef.current.doc;
      const ops: Array<DesignMutationOp> = [];
      let lastNodeName = "layer";

      for (const rawId of ids) {
        const nodeId = rawId as DesignNodeId;
        const original = activeDoc.nodes[nodeId];
        if (original === undefined) continue;
        const leaf = contentLayer.findId(nodeId) as IUI | undefined;
        if (leaf === undefined) continue;
        const parent = original.parentId === null ? undefined : activeDoc.nodes[original.parentId];
        const inAutoLayoutParent = parent?.type === "frame" && parent.layout !== undefined;
        const patch = readLeaferNodePatch(leaf, original, inAutoLayoutParent);
        if (patch !== null) {
          ops.push({ op: "update", id: nodeId, patch });
          lastNodeName = original.name;
        }
      }

      if (ops.length > 0) {
        const summary =
          ops.length === 1 ? `Updated ${lastNodeName}` : `Updated ${ops.length} layers`;
        latestRef.current.onCommitOps(ops, summary);
      }
    };

    const syncFrameLabelForLeaf = (leaf: IUI) => {
      if (typeof leaf.id !== "string") return;
      const label = frameLabelsRef.current.get(leaf.id);
      if (label === undefined) return;
      label.x = leaf.x ?? 0;
      label.y = (leaf.y ?? 0) - FRAME_LABEL_OFFSET_Y;
    };

    const openInlineRename = (nodeId: DesignNodeId) => {
      const node = latestRef.current.doc.nodes[nodeId];
      if (node === undefined) return;
      const vp = readTreeViewport(app);
      let worldX = node.x;
      let worldY = node.y - FRAME_LABEL_OFFSET_Y;
      if (!(node.type === "frame" && node.parentId === null)) {
        const leaf = contentLayer.findId(nodeId) as IUI | undefined;
        if (leaf !== undefined) {
          const bounds = leaf.worldBoxBounds;
          worldX = (bounds.x - vp.x) / vp.zoom;
          worldY = (bounds.y - vp.y) / vp.zoom - FRAME_LABEL_OFFSET_Y;
        }
      }
      renameCommittedRef.current = false;
      setInlineRename({ nodeId, draft: node.name, worldX, worldY });
    };

    const markDirty = (event: {
      readonly target?: unknown;
      readonly list?: ReadonlyArray<IUI>;
    }) => {
      const targets = extractTransformTargets(app.editor.list, event.target, event.list);
      for (const item of targets) {
        if (typeof item.id === "string" && item.id.length > 0) {
          dirtyIdsRef.current.add(item.id);
          syncFrameLabelForLeaf(item);
        }
      }
    };

    app.tree.on(MoveEvent.MOVE, () => {
      cancelZoomAnim();
      emitViewport();
    });
    app.tree.on(ZoomEvent.ZOOM, emitViewport);

    app.editor.on(EditorEvent.SELECT, (event: EditorEvent) => {
      if (syncingSelectionRef.current || latestRef.current.pickActive) return;
      const activeDoc = latestRef.current.doc;
      const rawIds: Array<DesignNodeId> = [];
      for (const item of event.list) {
        if (typeof item.id === "string" && item.id in activeDoc.nodes) {
          rawIds.push(item.id as DesignNodeId);
        }
      }
      const nextIds = normalizeSelectedNodeIds(activeDoc, rawIds);
      if (!sameNodeIdList(nextIds, latestRef.current.selectedIds)) {
        latestRef.current.onSelectIds(nextIds);
      }
    });

    app.editor.on(EditorMoveEvent.MOVE, markDirty);
    app.editor.on(EditorScaleEvent.SCALE, markDirty);
    app.editor.on(EditorRotateEvent.ROTATE, markDirty);
    app.editor.on(EditorGroupEvent.CLOSE, (event: EditorGroupEvent) => {
      // Leafer's closeGroup() sets `hitChildren = false`, which would permanently block
      // direct clicks on children inside frames after a double-click + deselect.
      if (event.editTarget !== undefined) {
        event.editTarget.hitChildren = true;
      }
    });
    app.editor.on(DragEvent.END, flushDirtyTransforms);
    app.on(LeaferPointerEvent.UP, flushDirtyTransforms);

    app.editor.on(InnerEditorEvent.OPEN, () => {
      editingTextRef.current = true;
    });

    app.editor.on(InnerEditorEvent.CLOSE, (event: InnerEditorEvent) => {
      editingTextRef.current = false;
      const target = event.editTarget as (IUI & { text?: unknown }) | undefined;
      if (target === undefined || typeof target.id !== "string") return;
      const nodeId = target.id as DesignNodeId;
      const original = latestRef.current.doc.nodes[nodeId];
      if (original?.type !== "text") return;
      const nextText = typeof target.text === "string" ? target.text : String(target.text ?? "");
      if (nextText !== original.text) {
        latestRef.current.onCommitOps(
          [{ op: "update", id: nodeId, patch: { text: nextText } }],
          `Edited text in ${original.name}`,
        );
      }
    });

    app.tree.on(LeaferPointerEvent.DOWN, (event: LeaferPointerEvent) => {
      if (
        !event.left ||
        latestRef.current.pickActive ||
        latestRef.current.spacePressed ||
        latestRef.current.tool !== "select"
      ) {
        return;
      }
      const activeDoc = latestRef.current.doc;
      const labelNodeId = findFrameLabelNodeId(event.target, activeDoc);
      if (labelNodeId === null) return;
      const currentIds = latestRef.current.selectedIds;
      const nextIds = event.shiftKey
        ? currentIds.includes(labelNodeId)
          ? currentIds.filter((id) => id !== labelNodeId)
          : normalizeSelectedNodeIds(activeDoc, [...currentIds, labelNodeId])
        : [labelNodeId];
      syncingSelectionRef.current = true;
      applySelectionToEditor(app, contentLayer, nextIds);
      syncingSelectionRef.current = false;
      latestRef.current.onSelectIds(nextIds);
    });

    // Listen on `app` (including sky/editBox) so Cmd/Ctrl+Click deep-selects even when an
    // enclosing parent frame is already selected and covered by the editor selection box.
    app.on(LeaferPointerEvent.DOWN, (event: LeaferPointerEvent) => {
      if (
        !event.left ||
        !(event.metaKey || event.ctrlKey) ||
        latestRef.current.pickActive ||
        latestRef.current.spacePressed ||
        latestRef.current.tool !== "select" ||
        editingTextRef.current
      ) {
        return;
      }
      if ((event.target as { pointType?: unknown } | undefined)?.pointType !== undefined) {
        return;
      }
      const activeDoc = latestRef.current.doc;
      if (findFrameLabelNodeId(event.target, activeDoc) !== null) return;
      const picked = app.tree.pick({ x: event.x, y: event.y }, { ignoreHittable: true });
      const deepId = findDeepUnlockedNodeId(picked, activeDoc);
      if (deepId === null) return;
      const currentIds = latestRef.current.selectedIds;
      const nextIds = event.shiftKey
        ? currentIds.includes(deepId)
          ? currentIds.filter((id) => id !== deepId)
          : normalizeSelectedNodeIds(activeDoc, [...currentIds, deepId])
        : [deepId];
      syncingSelectionRef.current = true;
      applySelectionToEditor(app, contentLayer, nextIds);
      syncingSelectionRef.current = false;
      latestRef.current.onSelectIds(nextIds);
    });

    app.tree.on(LeaferPointerEvent.DOUBLE_TAP, (event: LeaferPointerEvent) => {
      if (
        latestRef.current.pickActive ||
        latestRef.current.spacePressed ||
        latestRef.current.tool !== "select"
      ) {
        return;
      }
      const labelNodeId = findFrameLabelNodeId(event.target, latestRef.current.doc);
      if (labelNodeId !== null) {
        openInlineRename(labelNodeId);
      }
    });

    app.tree.on(LeaferPointerEvent.TAP, (event: LeaferPointerEvent) => {
      if (!latestRef.current.pickActive || latestRef.current.spacePressed) return;
      const activeDoc = latestRef.current.doc;
      const deepPick = app.tree.pick({ x: event.x, y: event.y }, { ignoreHittable: true });
      const nodeId =
        findDeepUnlockedNodeId(deepPick, activeDoc) ?? findDocumentNodeId(event.target, activeDoc);
      if (nodeId === null) {
        latestRef.current.onPickNode(null, null);
        return;
      }
      const leaf = contentLayer.findId(nodeId) as IUI | undefined;
      const vp = readTreeViewport(app);
      if (leaf !== undefined) {
        const bounds = leaf.worldBoxBounds;
        latestRef.current.onPickNode(nodeId, {
          x: (bounds.x + bounds.width / 2 - vp.x) / vp.zoom,
          y: (bounds.y + bounds.height - vp.y) / vp.zoom,
        });
      } else {
        latestRef.current.onPickNode(nodeId, null);
      }
    });

    const exportNodesToPng = async (
      nodeIds: ReadonlyArray<DesignNodeId> | null,
      options?: { readonly transparent?: boolean; readonly scale?: number },
    ): Promise<Blob | null> => {
      const activeDoc = latestRef.current.doc;
      const isFullCanvas = nodeIds === null;
      const targetIds = isFullCanvas
        ? activeDoc.rootIds.filter((id) => activeDoc.nodes[id]?.visible !== false)
        : normalizeSelectedNodeIds(activeDoc, nodeIds);
      if (targetIds.length === 0) return null;

      interface ExportItemSpec {
        readonly id: DesignNodeId;
        readonly renderBounds: {
          readonly x: number;
          readonly y: number;
          readonly width: number;
          readonly height: number;
        };
        readonly originX: number;
        readonly originY: number;
        readonly boxWidth: number;
        readonly boxHeight: number;
      }

      const specs: Array<ExportItemSpec> = [];
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      for (const id of targetIds) {
        const node = activeDoc.nodes[id];
        if (node === undefined) continue;
        const leaf = contentLayer.findId(id) as IUI | undefined;
        if (leaf !== undefined) {
          const rb = leaf.getBounds("render", "page");
          const worldOrigin = leaf.getWorldPoint({ x: 0, y: 0 });
          const pageOrigin = contentLayer.getInnerPoint(worldOrigin);
          const boxWidth = Math.max(1, leaf.boxBounds.width || node.width);
          const boxHeight = Math.max(1, leaf.boxBounds.height || node.height);
          specs.push({
            id,
            renderBounds: rb,
            originX: pageOrigin.x,
            originY: pageOrigin.y,
            boxWidth,
            boxHeight,
          });
          minX = Math.min(minX, rb.x);
          minY = Math.min(minY, rb.y);
          maxX = Math.max(maxX, rb.x + rb.width);
          maxY = Math.max(maxY, rb.y + rb.height);
        } else {
          specs.push({
            id,
            renderBounds: { x: node.x, y: node.y, width: node.width, height: node.height },
            originX: node.x,
            originY: node.y,
            boxWidth: Math.max(1, node.width),
            boxHeight: Math.max(1, node.height),
          });
          minX = Math.min(minX, node.x);
          minY = Math.min(minY, node.y);
          maxX = Math.max(maxX, node.x + node.width);
          maxY = Math.max(maxY, node.y + node.height);
        }
      }

      if (specs.length === 0 || !Number.isFinite(minX) || !Number.isFinite(minY)) return null;

      const padding = isFullCanvas ? 24 : 0;
      const exportWidth = Math.max(1, Math.ceil(maxX - minX + padding * 2));
      const exportHeight = Math.max(1, Math.ceil(maxY - minY + padding * 2));
      const requestedScale = options?.scale ?? 2;
      const maxDim = Math.max(exportWidth, exportHeight);
      const pixelRatio = Math.max(1, Math.min(requestedScale, Math.floor(8192 / maxDim) || 1));

      const builtItems: Array<IUIInputData> = [];
      for (const spec of specs) {
        const input = designNodeToLeaferInput(activeDoc, spec.id, false);
        if (input === null) continue;
        builtItems.push({
          ...input,
          x: spec.originX - minX + padding,
          y: spec.originY - minY + padding,
          width: spec.boxWidth,
          height: spec.boxHeight,
          visible: true,
          editable: false,
        });
      }
      if (builtItems.length === 0) return null;

      const transparent = options?.transparent ?? !isFullCanvas;
      const backgroundFill = transparent
        ? ""
        : (activeDoc.background ??
          (typeof window !== "undefined"
            ? window.getComputedStyle(mountEl).backgroundColor || "#0f1117"
            : "#0f1117"));

      const offscreenCanvas = document.createElement("canvas");
      const exportLeafer = new Leafer({
        view: offscreenCanvas,
        width: exportWidth,
        height: exportHeight,
        pixelRatio,
        fill: backgroundFill,
      });

      try {
        exportLeafer.add(builtItems as never);
        exportLeafer.updateLayout();
        exportLeafer.forceRender(undefined, true);
        // Allow one frame for any image/SVG data URLs to paint onto the offscreen canvas.
        await new Promise<void>((resolve) => {
          window.requestAnimationFrame(() => resolve());
        });
        exportLeafer.updateLayout();
        exportLeafer.forceRender(undefined, true);

        return await new Promise<Blob | null>((resolve) => {
          offscreenCanvas.toBlob((blob) => resolve(blob), "image/png");
        });
      } finally {
        exportLeafer.destroy();
      }
    };

    handleRef.current = {
      fitView: () => {
        cancelZoomAnim();
        clearEditorHover(app);
        if (contentLayer.children.length === 0) {
          app.tree.x = 64;
          app.tree.y = 48;
          app.tree.scaleX = 1;
          app.tree.scaleY = 1;
        } else {
          app.tree.zoom("fit", 48);
        }
        app.tree.updateLayout();
        app.editor.updateEditBox();
        emitViewport();
      },
      zoomIn: () => {
        const rect = mountEl.getBoundingClientRect();
        const center = { x: rect.width / 2, y: rect.height / 2 };
        const base = zoomAnim !== null ? zoomAnim.targetZoom : getCurrentZoom();
        smoothZoomTo(base * 1.25, center, false);
      },
      zoomOut: () => {
        const rect = mountEl.getBoundingClientRect();
        const center = { x: rect.width / 2, y: rect.height / 2 };
        const base = zoomAnim !== null ? zoomAnim.targetZoom : getCurrentZoom();
        smoothZoomTo(base / 1.25, center, false);
      },
      getNodeAnchorWorld: (id: DesignNodeId) => {
        const leaf = contentLayer.findId(id) as IUI | undefined;
        if (leaf === undefined) return null;
        const bounds = leaf.worldBoxBounds;
        const vp = readTreeViewport(app);
        return {
          x: (bounds.x + bounds.width / 2 - vp.x) / vp.zoom,
          y: (bounds.y + bounds.height - vp.y) / vp.zoom,
        };
      },
      getViewportCenterWorld: () => {
        const rect = mountEl.getBoundingClientRect();
        const vp = readTreeViewport(app);
        return {
          x: (rect.width / 2 - vp.x) / vp.zoom,
          y: (rect.height / 2 - vp.y) / vp.zoom,
        };
      },
      startRename: openInlineRename,
      isEditingText: () => editingTextRef.current,
      exportNodesToPng,
    };

    return () => {
      cancelZoomAnim();
      mountEl.removeEventListener("wheel", onCaptureWheel, { capture: true });
      handleRef.current = null;
      appRef.current = null;
      contentLayerRef.current = null;
      frameLabelsRef.current.clear();
      app.destroy();
    };
  }, [handleRef]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reconciles the Leafer scene graph whenever the DesignDocument changes
  useEffect(() => {
    const app = appRef.current;
    const contentLayer = contentLayerRef.current;
    if (app === null || contentLayer === null || editingTextRef.current) return;

    syncingSelectionRef.current = true;
    app.editor.target = [];
    contentLayer.clear();
    frameLabelsRef.current.clear();
    const nodes = designDocumentToLeaferTree(doc);
    if (nodes.length > 0) {
      contentLayer.add(nodes as never);
      for (const child of contentLayer.children) {
        const labelNodeId = parseFrameLabelNodeId(child.name);
        if (labelNodeId !== null) {
          frameLabelsRef.current.set(labelNodeId, child as IUI);
        }
      }
    }

    if (!hasAutoFitRef.current && doc.rootIds.length > 0) {
      hasAutoFitRef.current = true;
      app.tree.zoom("fit", 48);
      const next = readTreeViewport(app);
      setViewport(next);
      latestRef.current.onViewportChange(next);
    }

    const activeSelectedIds = normalizeSelectedNodeIds(doc, latestRef.current.selectedIds);
    const activeRenameId = latestRef.current.inlineRename?.nodeId ?? null;
    syncFrameLabelAppearance(frameLabelsRef.current, activeSelectedIds, activeRenameId);

    if (activeSelectedIds.length > 0 && !latestRef.current.pickActive) {
      applySelectionToEditor(app, contentLayer, activeSelectedIds);
    }
    syncingSelectionRef.current = false;
  }, [doc]);

  const renamingNodeId = inlineRename?.nodeId ?? null;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps Leafer Editor selection and frame label highlight synced with external selection or inline rename changes
  useEffect(() => {
    const app = appRef.current;
    const contentLayer = contentLayerRef.current;
    if (app === null || contentLayer === null || editingTextRef.current) return;

    const currentEditorIds = readEditorSelectedIds(app, latestRef.current.doc);
    if (pickActive || selectedIds.length === 0) {
      if (currentEditorIds.length > 0 || app.editor.list.length > 0) {
        syncingSelectionRef.current = true;
        app.editor.target = [];
        syncingSelectionRef.current = false;
      }
    } else if (!sameNodeIdList(currentEditorIds, selectedIds)) {
      syncingSelectionRef.current = true;
      applySelectionToEditor(app, contentLayer, selectedIds);
      syncingSelectionRef.current = false;
    }

    syncFrameLabelAppearance(frameLabelsRef.current, selectedIds, renamingNodeId);
  }, [selectedIds, pickActive, renamingNodeId]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- focuses and selects inline rename input after mounting (including when triggered from a closing context menu)
  useEffect(() => {
    if (renamingNodeId === null) return;
    const rafId = window.requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [renamingNodeId]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- switches Leafer pan/edit/pick modes when tool, Space key, or Annotate mode changes
  useEffect(() => {
    const app = appRef.current;
    if (app === null) return;

    const panMode = spacePressed || (!pickActive && tool === "hand");
    const drawMode = !pickActive && !spacePressed && isDrawTool(tool);

    if (app.config.move !== undefined) {
      app.config.move.drag = panMode;
    }
    const editorActive = !panMode && !pickActive && !drawMode;
    app.editor.hittable = editorActive;
    app.editor.visible = editorActive;
  }, [tool, pickActive, spacePressed]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tracks drag-to-draw creation gesture on window for frame/rect/ellipse/text/line tools
  useEffect(() => {
    const toWorld = (clientX: number, clientY: number) => {
      const rect = hostRef.current?.getBoundingClientRect();
      const app = appRef.current;
      if (!rect || app === null) return { x: 0, y: 0 };
      const vp = readTreeViewport(app);
      return {
        x: (clientX - rect.left - vp.x) / vp.zoom,
        y: (clientY - rect.top - vp.y) / vp.zoom,
      };
    };

    const onPointerMove = (event: PointerEvent) => {
      const current = drawDraftRef.current;
      if (current === null || current.pointerId !== event.pointerId) return;
      const world = toWorld(event.clientX, event.clientY);
      const parentFrame =
        current.parentId !== null ? latestRef.current.doc.nodes[current.parentId] : undefined;
      const next: DrawDraft = {
        ...current,
        currentWorldX: parentFrame !== undefined ? world.x - parentFrame.x : world.x,
        currentWorldY: parentFrame !== undefined ? world.y - parentFrame.y : world.y,
      };
      drawDraftRef.current = next;
      setDrawDraft(next);
    };

    const onPointerUp = (event: PointerEvent) => {
      const finished = drawDraftRef.current;
      if (finished === null || finished.pointerId !== event.pointerId) return;
      drawDraftRef.current = null;
      setDrawDraft(null);

      const x = Math.min(finished.startWorldX, finished.currentWorldX);
      const y = Math.min(finished.startWorldY, finished.currentWorldY);
      const width = Math.abs(finished.currentWorldX - finished.startWorldX);
      const height = Math.abs(finished.currentWorldY - finished.startWorldY);
      const bounds: NodeBounds =
        width < 8 && height < 8
          ? {
              x,
              y,
              width: finished.tool === "frame" ? 360 : finished.tool === "text" ? 200 : 140,
              height: finished.tool === "frame" ? 240 : finished.tool === "line" ? 4 : 64,
            }
          : { x, y, width, height };
      latestRef.current.onAddNode(makeNodeInputForTool(finished.tool, bounds, finished.parentId));
    };

    const onPointerCancel = (event: PointerEvent) => {
      if (drawDraftRef.current?.pointerId === event.pointerId) {
        drawDraftRef.current = null;
        setDrawDraft(null);
      }
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    };
  }, []);

  const handleDrawPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !isDrawTool(tool)) return;
    event.preventDefault();
    const rect = hostRef.current?.getBoundingClientRect();
    const app = appRef.current;
    if (!rect || app === null) return;
    const vp = readTreeViewport(app);
    const worldX = (event.clientX - rect.left - vp.x) / vp.zoom;
    const worldY = (event.clientY - rect.top - vp.y) / vp.zoom;
    const primarySelectedId = selectedIds.length === 1 ? selectedIds[0]! : null;
    const selectedNode = primarySelectedId === null ? undefined : doc.nodes[primarySelectedId];
    const targetParentId =
      tool !== "frame" && selectedNode?.type === "frame" ? selectedNode.id : null;
    const parentFrame = targetParentId !== null ? doc.nodes[targetParentId] : undefined;
    const localX = parentFrame !== undefined ? worldX - parentFrame.x : worldX;
    const localY = parentFrame !== undefined ? worldY - parentFrame.y : worldY;

    const next: DrawDraft = {
      pointerId: event.pointerId,
      tool,
      parentId: targetParentId,
      startWorldX: localX,
      startWorldY: localY,
      currentWorldX: localX,
      currentWorldY: localY,
    };
    drawDraftRef.current = next;
    setDrawDraft(next);
  };

  const commitInlineRename = () => {
    if (renameCommittedRef.current) return;
    renameCommittedRef.current = true;
    const active = inlineRename;
    setInlineRename(null);
    if (active === null) return;
    const original = doc.nodes[active.nodeId];
    const trimmed = active.draft.trim();
    if (original !== undefined && trimmed.length > 0 && trimmed !== original.name) {
      onCommitOps(
        [{ op: "update", id: active.nodeId, patch: { name: trimmed } }],
        `Renamed ${original.name} to ${trimmed}`,
      );
    }
  };

  const cancelInlineRename = () => {
    renameCommittedRef.current = true;
    setInlineRename(null);
  };

  const handleContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (isEditableTarget(event.target)) return;
    if (onContextMenu === undefined) return;
    const rect = hostRef.current?.getBoundingClientRect();
    const app = appRef.current;
    const contentLayer = contentLayerRef.current;
    if (!rect || app === null || contentLayer === null) return;

    event.preventDefault();
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    const vp = readTreeViewport(app);
    const worldX = (localX - vp.x) / vp.zoom;
    const worldY = (localY - vp.y) / vp.zoom;

    const picked =
      event.metaKey || event.ctrlKey
        ? app.tree.pick({ x: localX, y: localY }, { ignoreHittable: true })
        : app.tree.pick({ x: localX, y: localY });
    const nodeId =
      event.metaKey || event.ctrlKey
        ? (findDeepUnlockedNodeId(picked, doc) ?? findDocumentNodeId(picked.target, doc))
        : findDocumentNodeId(picked.target, doc);
    if (nodeId !== null) {
      const alreadyInSelection = selectedIds.includes(nodeId);
      const nextIds = alreadyInSelection ? selectedIds : [nodeId];
      if (!alreadyInSelection && !pickActive) {
        syncingSelectionRef.current = true;
        applySelectionToEditor(app, contentLayer, nextIds);
        syncingSelectionRef.current = false;
        onSelectIds(nextIds);
      }
      onContextMenu({
        kind: "node",
        nodeId,
        nodeIds: nextIds,
        clientX: event.clientX,
        clientY: event.clientY,
        worldX,
        worldY,
      });
      return;
    }

    onContextMenu({
      kind: "canvas",
      clientX: event.clientX,
      clientY: event.clientY,
      worldX,
      worldY,
    });
  };

  const panMode = spacePressed || (!pickActive && tool === "hand");
  const drawMode = !pickActive && !spacePressed && isDrawTool(tool);

  const inlineRenamePosition =
    inlineRename !== null && inlineRename.nodeId in doc.nodes
      ? (() => {
          const rawLeft = inlineRename.worldX * viewport.zoom + viewport.x;
          const rawTop = inlineRename.worldY * viewport.zoom + viewport.y - 3;
          const maxLeft = Math.max(8, viewportSize.width - 188);
          const maxTop = Math.max(8, viewportSize.height - 32);
          return {
            left: Math.round(Math.min(maxLeft, Math.max(8, rawLeft))),
            top: Math.round(Math.min(maxTop, Math.max(8, rawTop))),
          };
        })()
      : null;

  const drawPreviewStyle: CSSProperties | null =
    drawDraft !== null
      ? (() => {
          const parentFrame =
            drawDraft.parentId !== null ? doc.nodes[drawDraft.parentId] : undefined;
          const offsetX = parentFrame?.x ?? 0;
          const offsetY = parentFrame?.y ?? 0;
          const worldLeft = Math.min(drawDraft.startWorldX, drawDraft.currentWorldX) + offsetX;
          const worldTop = Math.min(drawDraft.startWorldY, drawDraft.currentWorldY) + offsetY;
          const worldW = Math.max(2, Math.abs(drawDraft.currentWorldX - drawDraft.startWorldX));
          const worldH = Math.max(2, Math.abs(drawDraft.currentWorldY - drawDraft.startWorldY));
          return {
            position: "absolute",
            left: worldLeft * viewport.zoom + viewport.x,
            top: worldTop * viewport.zoom + viewport.y,
            width: worldW * viewport.zoom,
            height: worldH * viewport.zoom,
          };
        })()
      : null;

  const bubblePosition =
    selectionOverlay !== null && selectionAnchorWorld !== null
      ? clampBubblePosition(
          {
            x: selectionAnchorWorld.x * viewport.zoom + viewport.x,
            y: selectionAnchorWorld.y * viewport.zoom + viewport.y,
          },
          viewportSize,
          {
            width: Math.min(BUBBLE_WIDTH_PX, Math.max(200, viewportSize.width - 24)),
            height: BUBBLE_HEIGHT_PX,
          },
        )
      : null;

  return (
    <div
      ref={hostRef}
      data-design-canvas-viewport="true"
      className={cn(
        "relative min-h-0 min-w-0 flex-1 touch-none overflow-hidden bg-background select-none",
        panMode
          ? "cursor-grab active:cursor-grabbing"
          : pickActive
            ? "cursor-crosshair"
            : undefined,
      )}
      style={doc.background !== undefined ? { backgroundColor: doc.background } : undefined}
      onContextMenu={handleContextMenu}
    >
      <div ref={canvasMountRef} className="absolute inset-0 size-full" />

      {drawMode ? (
        <div
          className="absolute inset-0 z-20 cursor-crosshair"
          onPointerDown={handleDrawPointerDown}
        />
      ) : null}

      {drawPreviewStyle !== null ? (
        <div
          style={drawPreviewStyle}
          className="pointer-events-none z-25 rounded-xs border border-dashed border-primary bg-primary/15"
        />
      ) : null}

      {inlineRename !== null && inlineRenamePosition !== null ? (
        <input
          ref={renameInputRef}
          type="text"
          aria-label={gt("Rename layer")}
          value={inlineRename.draft}
          className="pointer-events-auto absolute z-45 h-6 w-44 rounded-md border border-primary bg-background/95 px-1.5 text-xs font-medium text-foreground shadow-lg outline-none ring-2 ring-primary/25 select-text"
          style={{
            left: inlineRenamePosition.left,
            top: inlineRenamePosition.top,
          }}
          onChange={(event) => {
            const nextDraft = event.target.value;
            setInlineRename((prev) => (prev !== null ? { ...prev, draft: nextDraft } : null));
          }}
          onBlur={commitInlineRename}
          onPointerDown={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") {
              event.preventDefault();
              commitInlineRename();
            } else if (event.key === "Escape") {
              event.preventDefault();
              cancelInlineRename();
            }
          }}
        />
      ) : null}

      {selectionOverlay !== null && bubblePosition !== null ? (
        <div
          className="pointer-events-auto absolute z-40"
          style={{
            left: bubblePosition.left,
            top: bubblePosition.top,
            width: BUBBLE_WIDTH_PX,
            maxWidth: "calc(100% - 24px)",
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
        >
          {selectionOverlay}
        </div>
      ) : null}

      {bottomOverlay ?? null}
    </div>
  );
}
