import type {
  DesignMutationOp,
  DesignNode,
  DesignNodeId,
  DesignNodeInput,
  DesignNodePatch,
  EnvironmentId,
  PreviewAnnotationPayload,
  ScopedThreadRef,
  T3Object,
  T3ObjectId,
} from "@t3tools/contracts";
import { renderDesignToHtml, renderDesignToSvg } from "@t3tools/shared/designRender";
import { T, useGT } from "gt-react";
import {
  CircleIcon,
  DownloadIcon,
  FileCodeIcon,
  FrameIcon,
  HandIcon,
  ImageIcon,
  LayersIcon,
  Maximize2Icon,
  MinusIcon,
  MousePointer2Icon,
  MousePointerClickIcon,
  PanelRightIcon,
  Redo2Icon,
  ShapesIcon,
  SquareIcon,
  TypeIcon,
  Undo2Icon,
} from "lucide-react";
import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import { FILE_SURFACE_SUBHEADER_CLASS } from "~/components/files/fileSurfaceChrome";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import { Spinner } from "~/components/ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
  WorkspaceBreadcrumbText,
} from "~/components/WorkspaceBreadcrumb";
import { WorkspacePageHeader } from "~/components/WorkspacePageHeader";
import { type ComposerImageAttachment, useComposerDraftStore } from "~/composerDraftStore";
import { cn } from "~/lib/utils";
import {
  DesignCanvasViewport,
  type DesignCanvasContextMenuRequest,
  type DesignCanvasHandle,
} from "./DesignCanvasViewport";
import { DesignContextMenu, type DesignContextMenuState } from "./DesignContextMenu";
import { DesignInspectorPanel, type DesignExportFormat } from "./DesignInspectorPanel";
import { DesignLayersPanel } from "./DesignLayersPanel";
import {
  buildDuplicateNodesOps,
  buildPasteNodesOps,
  buildReorderNodeOp,
  getSelectAllNodeIds,
  isEditableTarget,
  normalizeSelectedNodeIds,
  parseDesignClipboard,
  serializeDesignClipboard,
  type DesignClipboardPayload,
  type DesignTool,
  type LayerOrderDirection,
  type Point2D,
} from "./designEditorTypes";
import { slugifyFilename, triggerBlobDownload, triggerFileDownload } from "./designExport";
import { useDesignObjectSession } from "./useDesignObjectSession";

const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 440;

// In-memory clipboard fallback so Copy/Cut/Paste works reliably even without browser
// clipboard permissions and persists when switching between Design Objects.
const sharedDesignClipboardState: {
  payload: DesignClipboardPayload | null;
  pasteCount: number;
} = {
  payload: null,
  pasteCount: 0,
};

function readSharedDesignClipboard(): DesignClipboardPayload | null {
  return sharedDesignClipboardState.payload;
}

function writeSharedDesignClipboard(payload: DesignClipboardPayload, resetPasteCount = true): void {
  sharedDesignClipboardState.payload = payload;
  if (resetPasteCount) {
    sharedDesignClipboardState.pasteCount = 0;
  }
}

function nextSharedDesignPasteCount(): number {
  return sharedDesignClipboardState.pasteCount + 1;
}

function recordSharedDesignPasteCount(count: number): void {
  sharedDesignClipboardState.pasteCount = count;
}

function clampSidebarWidth(width: number): number {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)));
}

function buildDesignElementsAnnotation(input: {
  readonly object: T3Object;
  readonly nodes: ReadonlyArray<DesignNode>;
  readonly comment: string;
}): PreviewAnnotationPayload {
  const { object, nodes, comment } = input;
  const pageUrl = `t3-object://${object.id}`;
  const pageTitle = `T3 Design Object: ${object.title} (id=${object.id}, rev=${object.revision})`;
  const now = new Date().toISOString();
  const firstId = nodes[0]?.id ?? "selection";

  return {
    id: `t3-object-annotation-${object.id}-${firstId}-${nodes.length}-${Date.now()}`,
    pageUrl,
    pageTitle,
    comment,
    elements: nodes.map((node) => {
      const stylesSummary = [
        `type=${node.type}`,
        `x=${Math.round(node.x)}`,
        `y=${Math.round(node.y)}`,
        `w=${Math.round(node.width)}`,
        `h=${Math.round(node.height)}`,
        ...(node.fill ? [`fill=${node.fill}`] : []),
        ...(node.stroke ? [`stroke=${node.stroke}`] : []),
        ...(node.radius ? [`radius=${node.radius}`] : []),
        ...(node.type === "text" && node.color ? [`color=${node.color}`] : []),
        ...(node.type === "text" && node.fontSize ? [`fontSize=${node.fontSize}`] : []),
      ].join("; ");

      return {
        id: node.id,
        rect: {
          x: Math.round(node.x),
          y: Math.round(node.y),
          width: Math.round(node.width),
          height: Math.round(node.height),
        },
        element: {
          pageUrl,
          pageTitle,
          tagName: `design-${node.type}`,
          selector: `t3_object[id="${object.id}"] node[id="${node.id}"]`,
          htmlPreview: JSON.stringify(node),
          componentName: node.name,
          source: null,
          stack: [],
          styles: stylesSummary,
          pickedAt: now,
        },
      };
    }),
    regions: [],
    strokes: [],
    styleChanges: [],
    screenshot: null,
    createdAt: now,
  };
}

export function DesignObjectWorkspace({
  environmentId,
  objectId,
  compact = false,
  reserveWindowControls = false,
  threadRef,
  onSendAnnotation,
  onBack,
  onOpenFullPage,
}: {
  readonly environmentId: EnvironmentId;
  readonly objectId: T3ObjectId;
  readonly compact?: boolean;
  readonly reserveWindowControls?: boolean;
  readonly threadRef?: ScopedThreadRef | undefined;
  readonly onSendAnnotation?:
    | ((annotation: PreviewAnnotationPayload, image: ComposerImageAttachment | null) => void)
    | undefined;
  readonly onBack?: () => void;
  readonly onOpenFullPage?: () => void;
}) {
  const gt = useGT();
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const canvasHandleRef = useRef<DesignCanvasHandle | null>(null);
  const pointerInsideRef = useRef(false);

  const [tool, setTool] = useState<DesignTool>("select");
  const [selectedIds, setSelectedIds] = useState<ReadonlyArray<DesignNodeId>>([]);
  const [renamingLayerId, setRenamingLayerId] = useState<DesignNodeId | null>(null);
  const [contextMenu, setContextMenu] = useState<DesignContextMenuState | null>(null);
  const [selectionAnchorWorld, setSelectionAnchorWorld] = useState<Point2D | null>(null);
  const [pickActive, setPickActive] = useState(false);
  const [askChatNote, setAskChatNote] = useState("");

  const [spacePressed, setSpacePressed] = useState(false);
  const [showLeftPanel, setShowLeftPanel] = useState(!compact);
  const [leftTab, setLeftTab] = useState<"layers" | "history">("layers");
  const [leftWidth, setLeftWidth] = useState(232);
  const [showInspector, setShowInspector] = useState(!compact);
  const [rightWidth, setRightWidth] = useState(248);
  const [resizingPanel, setResizingPanel] = useState<{
    readonly side: "left" | "right";
    readonly startX: number;
    readonly startWidth: number;
  } | null>(null);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");

  const {
    activeObject,
    currentDoc,
    canMutate,
    loadError,
    actionError,
    setActionError,
    revisions,
    revisionsLoading,
    canUndo,
    canRedo,
    commitOps,
    restoreRevision,
    handleUndo,
    handleRedo,
    renameTitle,
  } = useDesignObjectSession({
    environmentId,
    objectId,
    historyVisible: showLeftPanel && leftTab === "history",
    onAutoSelectIds: setSelectedIds,
  });

  const normalizedSelectedIds = normalizeSelectedNodeIds(currentDoc, selectedIds);
  const selectedNodes: ReadonlyArray<DesignNode> = normalizedSelectedIds
    .map((id) => currentDoc.nodes[id])
    .filter((node): node is DesignNode => node !== undefined);
  const primarySelectedId: DesignNodeId | null =
    normalizedSelectedIds.length === 1 ? normalizedSelectedIds[0]! : null;

  const handleAddNode = (node: DesignNodeInput) => {
    commitOps([{ op: "add", node }], `Added ${node.name}`);
    setTool("select");
  };

  const handlePatchNode = (id: DesignNodeId, patch: DesignNodePatch, summary: string) => {
    commitOps([{ op: "update", id, patch }], summary);
  };

  const handleRenameNode = (node: DesignNode, nextName: string) => {
    const trimmed = nextName.trim();
    if (trimmed.length === 0 || trimmed === node.name) return;
    handlePatchNode(node.id, { name: trimmed }, `Renamed ${node.name} to ${trimmed}`);
  };

  const handleDuplicateNodes = (ids: ReadonlyArray<DesignNodeId>) => {
    const duplicated = buildDuplicateNodesOps(currentDoc, ids);
    if (duplicated === null) return;
    const summary =
      duplicated.rootCloneIds.length === 1
        ? `Duplicated ${currentDoc.nodes[ids[0]!]?.name ?? "layer"}`
        : `Duplicated ${duplicated.rootCloneIds.length} layers`;
    commitOps(duplicated.ops, summary, {
      selectIds: duplicated.rootCloneIds,
    });
  };

  const handleReorderNode = (id: DesignNodeId, direction: LayerOrderDirection) => {
    const target = currentDoc.nodes[id];
    const op = buildReorderNodeOp(currentDoc, id, direction);
    if (target === undefined || op === null) return;
    commitOps([op], `Reordered ${target.name}`);
  };

  const handleDeleteNodes = (ids: ReadonlyArray<DesignNodeId>) => {
    const normalized = normalizeSelectedNodeIds(currentDoc, ids);
    if (normalized.length === 0) return;
    const deleteSet = new Set<string>(normalized);
    setSelectedIds((prev) => prev.filter((id) => !deleteSet.has(id)));
    if (renamingLayerId !== null && deleteSet.has(renamingLayerId)) {
      setRenamingLayerId(null);
    }
    setSelectionAnchorWorld(null);
    const ops: Array<DesignMutationOp> = normalized.map((id) => ({ op: "delete", id }));
    const summary =
      normalized.length === 1
        ? `Deleted ${currentDoc.nodes[normalized[0]!]?.name ?? "layer"}`
        : `Deleted ${normalized.length} layers`;
    commitOps(ops, summary, { selectIds: [] });
  };

  const handleCopyNodes = (ids: ReadonlyArray<DesignNodeId>): string | null => {
    const payload = serializeDesignClipboard(currentDoc, ids);
    if (payload === null) return null;
    writeSharedDesignClipboard(payload);
    const serialized = JSON.stringify(payload);
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText !== undefined) {
      void navigator.clipboard.writeText(serialized).catch(() => undefined);
    }
    return serialized;
  };

  const handleCutNodes = (ids: ReadonlyArray<DesignNodeId>): string | null => {
    const serialized = handleCopyNodes(ids);
    if (serialized === null) return null;
    handleDeleteNodes(ids);
    return serialized;
  };

  const pastePayload = (
    payload: DesignClipboardPayload,
    pasteAt: Point2D | null = null,
  ): boolean => {
    const nextPasteCount = pasteAt === null ? nextSharedDesignPasteCount() : 1;
    const viewportCenter = canvasHandleRef.current?.getViewportCenterWorld();
    const pasted = buildPasteNodesOps(currentDoc, payload, {
      selectedIds: normalizedSelectedIds,
      pasteAt,
      pasteCount: nextPasteCount,
      ...(viewportCenter !== undefined ? { viewportCenter } : {}),
    });
    if (pasted === null) return false;
    if (pasteAt === null) {
      recordSharedDesignPasteCount(nextPasteCount);
    }
    const summary =
      pasted.pastedRootIds.length === 1
        ? `Pasted ${payload.entries[0]?.tree.input.name ?? "layer"}`
        : `Pasted ${pasted.pastedRootIds.length} layers`;
    commitOps(pasted.ops, summary, { selectIds: pasted.pastedRootIds });
    return true;
  };

  const handlePaste = (options?: {
    readonly pasteAt?: Point2D | null;
    readonly clipboardText?: string | null;
  }) => {
    const pasteAt = options?.pasteAt ?? null;
    if (options?.clipboardText !== undefined && options.clipboardText !== null) {
      const fromText = parseDesignClipboard(options.clipboardText);
      if (fromText !== null) {
        writeSharedDesignClipboard(fromText, false);
        pastePayload(fromText, pasteAt);
        return;
      }
    }
    const cachedClipboard = readSharedDesignClipboard();
    if (cachedClipboard !== null) {
      pastePayload(cachedClipboard, pasteAt);
      return;
    }
    if (typeof navigator !== "undefined" && navigator.clipboard?.readText !== undefined) {
      void navigator.clipboard
        .readText()
        .then((text) => {
          const parsed = parseDesignClipboard(text);
          if (parsed !== null) {
            writeSharedDesignClipboard(parsed);
            pastePayload(parsed, pasteAt);
          }
        })
        .catch(() => undefined);
    }
  };

  const handleNudgeNodes = (dx: number, dy: number) => {
    const ops: Array<DesignMutationOp> = [];
    let lastName = "layer";
    for (const id of normalizedSelectedIds) {
      const node = currentDoc.nodes[id];
      if (node === undefined || node.locked === true) continue;
      const parent = node.parentId === null ? undefined : currentDoc.nodes[node.parentId];
      if (parent?.type === "frame" && parent.layout !== undefined) continue;
      ops.push({ op: "update", id, patch: { x: node.x + dx, y: node.y + dy } });
      lastName = node.name;
    }
    if (ops.length === 0) return;
    commitOps(ops, ops.length === 1 ? `Nudged ${lastName}` : `Nudged ${ops.length} layers`);
  };

  const resolveSelectionAnchorWorld = (ids: ReadonlyArray<DesignNodeId>): Point2D | null => {
    const anchor = canvasHandleRef.current?.getSelectionAnchorWorld(ids) ?? null;
    if (anchor !== null) return anchor;
    let minX = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const id of ids) {
      const node = currentDoc.nodes[id];
      if (node === undefined) continue;
      minX = Math.min(minX, node.x);
      maxX = Math.max(maxX, node.x + node.width);
      maxY = Math.max(maxY, node.y + node.height);
    }
    return Number.isFinite(minX) && Number.isFinite(maxX) && Number.isFinite(maxY)
      ? { x: (minX + maxX) / 2, y: maxY }
      : null;
  };

  const handleAnnotateNodes = (ids: ReadonlyArray<DesignNodeId>) => {
    if (threadRef === undefined) return;
    const validIds = normalizeSelectedNodeIds(currentDoc, ids);
    if (validIds.length === 0) return;
    setPickActive(true);
    setSelectedIds(validIds);
    setAskChatNote("");
    setSelectionAnchorWorld(resolveSelectionAnchorWorld(validIds));
  };

  const handleCanvasContextMenu = (request: DesignCanvasContextMenuRequest) => {
    if (request.kind === "node") {
      if (!(request.nodeId in currentDoc.nodes)) return;
      const validIds = normalizeSelectedNodeIds(currentDoc, request.nodeIds);
      setContextMenu({
        kind: "node",
        nodeId: request.nodeId,
        nodeIds: validIds.length > 0 ? validIds : [request.nodeId],
        x: request.clientX,
        y: request.clientY,
        renameTarget: "canvas",
      });
      return;
    }
    setContextMenu({
      kind: "canvas",
      x: request.clientX,
      y: request.clientY,
      worldX: request.worldX,
      worldY: request.worldY,
    });
  };

  const handleLayerContextMenu = (event: ReactMouseEvent<HTMLDivElement>, node: DesignNode) => {
    const alreadySelected = normalizedSelectedIds.includes(node.id);
    const targetIds = alreadySelected ? normalizedSelectedIds : [node.id];
    if (!alreadySelected) {
      setSelectedIds(targetIds);
    }
    setContextMenu({
      kind: "node",
      nodeId: node.id,
      nodeIds: targetIds,
      x: event.clientX,
      y: event.clientY,
      renameTarget: "layers",
    });
  };

  const handleDetachAndMove = (node: DesignNode, x: number, y: number) => {
    commitOps(
      [
        { op: "reparent", id: node.id, parentId: null },
        { op: "update", id: node.id, patch: { x, y, widthMode: null, heightMode: null } },
      ],
      `Detached ${node.name} from Auto Layout`,
    );
  };

  const handleDetachFromInspector = (node: DesignNode) => {
    const parent = node.parentId === null ? undefined : currentDoc.nodes[node.parentId];
    const targetX = (parent?.x ?? 0) + Math.max(24, node.x);
    const targetY = (parent?.y ?? 0) + Math.max(24, node.y);
    handleDetachAndMove(node, targetX, targetY);
  };

  const handleFitView = () => {
    canvasHandleRef.current?.fitView();
  };

  const handleExportNodes = (
    nodeIds: ReadonlyArray<DesignNodeId> | null,
    format: DesignExportFormat,
  ) => {
    const targets = nodeIds === null ? null : normalizeSelectedNodeIds(currentDoc, nodeIds);
    if (targets !== null && targets.length === 0) return;

    const baseName =
      targets === null
        ? slugifyFilename(activeObject?.title ?? "design")
        : targets.length === 1
          ? slugifyFilename(currentDoc.nodes[targets[0]!]?.name ?? "component")
          : `${slugifyFilename(activeObject?.title ?? "design")}-selection`;

    if (format === "png") {
      const handle = canvasHandleRef.current;
      if (handle === null) return;
      void handle
        .exportNodesToPng(targets, { transparent: targets !== null, scale: 2 })
        .then((blob) => {
          if (blob !== null) {
            triggerBlobDownload(blob, `${baseName}.png`);
          }
        })
        .catch((error: unknown) => {
          setActionError(error instanceof Error ? error.message : String(error));
        });
      return;
    }

    if (format === "svg") {
      const rendered =
        targets === null
          ? renderDesignToSvg(currentDoc)
          : renderDesignToSvg(currentDoc, { nodeIds: targets, transparent: true });
      triggerFileDownload(rendered.svg, "image/svg+xml;charset=utf-8", `${baseName}.svg`);
      return;
    }

    const rendered =
      targets === null
        ? renderDesignToHtml(currentDoc)
        : renderDesignToHtml(currentDoc, { nodeIds: targets, transparent: true });
    triggerFileDownload(rendered.html, "text/html;charset=utf-8", `${baseName}.html`);
  };

  const cancelPickMode = () => {
    setPickActive(false);
    setSelectionAnchorWorld(null);
    setAskChatNote("");
    workspaceRef.current?.focus({ preventScroll: true });
  };

  const togglePickMode = () => {
    if (pickActive) {
      cancelPickMode();
    } else if (normalizedSelectedIds.length > 0) {
      handleAnnotateNodes(normalizedSelectedIds);
    } else {
      setPickActive(true);
      setSelectedIds([]);
      setSelectionAnchorWorld(null);
      setAskChatNote("");
      workspaceRef.current?.focus({ preventScroll: true });
    }
  };

  const handlePickNode = (id: DesignNodeId | null, anchorWorld: Point2D | null) => {
    if (!pickActive) return;
    setSelectedIds(id === null ? [] : [id]);
    setSelectionAnchorWorld(anchorWorld);
    setAskChatNote("");
  };

  const handleSelectFromLayers = (ids: ReadonlyArray<DesignNodeId>) => {
    const nextIds = normalizeSelectedNodeIds(currentDoc, ids);
    setSelectedIds(nextIds);
    setAskChatNote("");
    if (nextIds.length === 0 || !pickActive) {
      setSelectionAnchorWorld(null);
      return;
    }
    setSelectionAnchorWorld(resolveSelectionAnchorWorld(nextIds));
  };

  const submitElementsToChat = (mode: "attach" | "send") => {
    if (threadRef === undefined || activeObject === null || selectedNodes.length === 0) return;
    const note = askChatNote.trim();
    const comment =
      note.length > 0
        ? note
        : selectedNodes.length === 1
          ? gt("Adjust this design element in the T3 Object using design_mutate.")
          : gt("Adjust these selected design elements in the T3 Object using design_mutate.");
    const annotation = buildDesignElementsAnnotation({
      object: activeObject,
      nodes: selectedNodes,
      comment,
    });
    useComposerDraftStore.getState().addPreviewAnnotation(threadRef, annotation);
    if (mode === "send") {
      onSendAnnotation?.(annotation, null);
    }
    setSelectedIds([]);
    cancelPickMode();
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tracks pointer drags for resizing the left (Layers/History) and right (Inspector) panels
  useEffect(() => {
    if (resizingPanel === null) return;
    const onPointerMove = (event: PointerEvent) => {
      const dx = event.clientX - resizingPanel.startX;
      if (resizingPanel.side === "left") {
        setLeftWidth(clampSidebarWidth(resizingPanel.startWidth + dx));
      } else {
        setRightWidth(clampSidebarWidth(resizingPanel.startWidth - dx));
      }
    };
    const onPointerUp = () => {
      setResizingPanel(null);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [resizingPanel]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- handles canvas shortcuts (Space pan, tools, copy/cut/paste, select all, nudge, delete, undo/redo) when focused or hovered without interfering with ChatComposer or inline text editing
  useEffect(() => {
    const canHandleCanvasKeys = () => {
      if (canvasHandleRef.current?.isEditingText() === true) return false;
      const root = workspaceRef.current;
      if (root === null) return false;
      const active = document.activeElement;
      if (isEditableTarget(active)) return false;
      if (active !== null && root.contains(active)) return true;
      if (pointerInsideRef.current) return true;
      return !compact;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target) || !canHandleCanvasKeys()) return;
      if (event.code === "Space") {
        event.preventDefault();
        const root = workspaceRef.current;
        if (
          root !== null &&
          document.activeElement instanceof HTMLButtonElement &&
          root.contains(document.activeElement)
        ) {
          root.focus({ preventScroll: true });
        }
        setSpacePressed(true);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        if (!canMutate) return;
        event.preventDefault();
        if (event.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
        if (canMutate && normalizedSelectedIds.length > 0 && !pickActive) {
          event.preventDefault();
          handleDuplicateNodes(normalizedSelectedIds);
        }
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
        if (!pickActive) {
          event.preventDefault();
          setSelectedIds(getSelectAllNodeIds(currentDoc, normalizedSelectedIds));
        }
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "F2") {
        if (canMutate && primarySelectedId !== null && !pickActive) {
          event.preventDefault();
          canvasHandleRef.current?.startRename(primarySelectedId);
        }
        return;
      }
      if (event.key === "Escape") {
        if (pickActive) {
          setPickActive(false);
          setSelectedIds([]);
          setSelectionAnchorWorld(null);
          setAskChatNote("");
        } else if (tool !== "select") {
          setTool("select");
        } else {
          setSelectedIds([]);
        }
        return;
      }
      if (event.key === "0") {
        handleFitView();
        return;
      }
      if (pickActive) return;

      const step = event.shiftKey ? 10 : 1;
      switch (event.key.toLowerCase()) {
        case "v":
          setTool("select");
          break;
        case "h":
          setTool("hand");
          break;
        case "f":
          if (canMutate) setTool("frame");
          break;
        case "r":
          if (canMutate) setTool("rect");
          break;
        case "o":
          if (canMutate) setTool("ellipse");
          break;
        case "t":
          if (canMutate) setTool("text");
          break;
        case "l":
          if (canMutate) setTool("line");
          break;
        case "arrowup":
          if (canMutate && normalizedSelectedIds.length > 0) {
            event.preventDefault();
            handleNudgeNodes(0, -step);
          }
          break;
        case "arrowdown":
          if (canMutate && normalizedSelectedIds.length > 0) {
            event.preventDefault();
            handleNudgeNodes(0, step);
          }
          break;
        case "arrowleft":
          if (canMutate && normalizedSelectedIds.length > 0) {
            event.preventDefault();
            handleNudgeNodes(-step, 0);
          }
          break;
        case "arrowright":
          if (canMutate && normalizedSelectedIds.length > 0) {
            event.preventDefault();
            handleNudgeNodes(step, 0);
          }
          break;
        case "backspace":
        case "delete":
          if (canMutate && normalizedSelectedIds.length > 0) {
            event.preventDefault();
            handleDeleteNodes(normalizedSelectedIds);
          }
          break;
      }
    };
    const onCopy = (event: ClipboardEvent) => {
      if (isEditableTarget(event.target) || !canHandleCanvasKeys() || pickActive) return;
      if (normalizedSelectedIds.length === 0) return;
      const serialized = handleCopyNodes(normalizedSelectedIds);
      if (serialized !== null) {
        event.preventDefault();
        event.clipboardData?.setData("text/plain", serialized);
      }
    };
    const onCut = (event: ClipboardEvent) => {
      if (!canMutate || isEditableTarget(event.target) || !canHandleCanvasKeys() || pickActive) {
        return;
      }
      if (normalizedSelectedIds.length === 0) return;
      const serialized = handleCutNodes(normalizedSelectedIds);
      if (serialized !== null) {
        event.preventDefault();
        event.clipboardData?.setData("text/plain", serialized);
      }
    };
    const onPaste = (event: ClipboardEvent) => {
      if (!canMutate || isEditableTarget(event.target) || !canHandleCanvasKeys() || pickActive) {
        return;
      }
      const clipboardText = event.clipboardData?.getData("text/plain") ?? "";
      const parsed = parseDesignClipboard(clipboardText);
      if (parsed !== null || readSharedDesignClipboard() !== null) {
        event.preventDefault();
        handlePaste({ clipboardText });
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        setSpacePressed(false);
      }
    };
    const onWindowBlur = () => {
      setSpacePressed(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("copy", onCopy);
    window.addEventListener("cut", onCut);
    window.addEventListener("paste", onPaste);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("copy", onCopy);
      window.removeEventListener("cut", onCut);
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onWindowBlur);
    };
  });

  const handleWorkspacePointerDownCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isEditableTarget(event.target)) {
      workspaceRef.current?.focus({ preventScroll: true });
    }
  };

  if (loadError !== null && activeObject === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm font-medium text-destructive">
          <T>Failed to load object</T>
        </p>
        <p className="text-xs text-muted-foreground">{loadError}</p>
        {onBack !== undefined ? (
          <Button size="sm" variant="outline" onClick={onBack}>
            <T>Back to Objects</T>
          </Button>
        ) : null}
      </div>
    );
  }

  if (activeObject === null) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Spinner size="md" />
      </div>
    );
  }

  const tools: ReadonlyArray<{
    readonly id: DesignTool;
    readonly label: string;
    readonly icon: React.ReactNode;
  }> = [
    { id: "select", label: gt("Select (V)"), icon: <MousePointer2Icon className="size-3.5" /> },
    { id: "hand", label: gt("Hand (H)"), icon: <HandIcon className="size-3.5" /> },
    { id: "frame", label: gt("Frame (F)"), icon: <FrameIcon className="size-3.5" /> },
    { id: "rect", label: gt("Rectangle (R)"), icon: <SquareIcon className="size-3.5" /> },
    { id: "ellipse", label: gt("Ellipse (O)"), icon: <CircleIcon className="size-3.5" /> },
    { id: "text", label: gt("Text (T)"), icon: <TypeIcon className="size-3.5" /> },
    { id: "line", label: gt("Line (L)"), icon: <MinusIcon className="size-3.5" /> },
  ];

  const commitTitle = () => {
    setEditingTitle(false);
    renameTitle(titleDraft);
  };

  const titleControl =
    editingTitle && canMutate ? (
      <Input
        autoFocus
        size="sm"
        className="w-44"
        value={titleDraft}
        onChange={(event) => setTitleDraft(event.target.value)}
        onBlur={commitTitle}
        onKeyDown={(event) => {
          if (event.key === "Enter") commitTitle();
          if (event.key === "Escape") setEditingTitle(false);
        }}
      />
    ) : (
      <button
        type="button"
        disabled={!canMutate}
        className="min-w-0 truncate rounded px-1 py-0.5 text-sm font-medium text-foreground hover:bg-accent/60 disabled:cursor-default disabled:hover:bg-transparent"
        onClick={() => {
          if (!canMutate) return;
          setTitleDraft(activeObject.title);
          setEditingTitle(true);
        }}
      >
        {activeObject.title}
      </button>
    );

  const headerActions = (
    <div className="flex shrink-0 items-center gap-0.5 [-webkit-app-region:no-drag]">
      {threadRef !== undefined ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-xs"
                variant={pickActive ? "secondary" : "ghost"}
                aria-label={pickActive ? gt("Cancel annotation") : gt("Annotate element")}
                aria-pressed={pickActive ? "true" : "false"}
                onClick={togglePickMode}
              />
            }
          >
            <MousePointerClickIcon className={cn("size-3.5", pickActive && "text-primary")} />
          </TooltipTrigger>
          <TooltipPopup>
            {pickActive ? gt("Cancel annotation (Esc)") : gt("Annotate element")}
          </TooltipPopup>
        </Tooltip>
      ) : null}

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={gt("Undo")}
              disabled={!canUndo}
              onClick={handleUndo}
            />
          }
        >
          <Undo2Icon className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup>
          <T>Undo</T>
        </TooltipPopup>
      </Tooltip>

      {canRedo ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button size="icon-xs" variant="ghost" aria-label={gt("Redo")} onClick={handleRedo} />
            }
          >
            <Redo2Icon className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup>
            <T>Redo</T>
          </TooltipPopup>
        </Tooltip>
      ) : null}

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon-xs"
              variant={showLeftPanel ? "secondary" : "ghost"}
              aria-label={gt("Layers & history")}
              aria-pressed={showLeftPanel ? "true" : "false"}
              onClick={() => setShowLeftPanel(!showLeftPanel)}
            />
          }
        >
          <LayersIcon className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup>
          <T>Layers & history</T>
        </TooltipPopup>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon-xs"
              variant={showInspector ? "secondary" : "ghost"}
              aria-label={gt("Inspector")}
              aria-pressed={showInspector ? "true" : "false"}
              onClick={() => setShowInspector(!showInspector)}
            />
          }
        >
          <PanelRightIcon className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup>
          <T>Inspector</T>
        </TooltipPopup>
      </Tooltip>

      <Menu>
        <Tooltip>
          <TooltipTrigger
            render={
              <MenuTrigger
                render={<Button size="icon-xs" variant="ghost" aria-label={gt("Export design")} />}
              >
                <DownloadIcon className="size-3.5" />
              </MenuTrigger>
            }
          />
          <TooltipPopup>
            <T>Export</T>
          </TooltipPopup>
        </Tooltip>
        <MenuPopup align="end" width="content">
          <MenuItem onClick={() => handleExportNodes(null, "png")}>
            <ImageIcon />
            <span>
              <T>Export PNG (2x)</T>
            </span>
          </MenuItem>
          <MenuItem onClick={() => handleExportNodes(null, "svg")}>
            <ShapesIcon />
            <span>
              <T>Export SVG (Figma)</T>
            </span>
          </MenuItem>
          <MenuItem onClick={() => handleExportNodes(null, "html")}>
            <FileCodeIcon />
            <span>
              <T>Export HTML</T>
            </span>
          </MenuItem>
          {normalizedSelectedIds.length > 0 ? (
            <>
              <MenuSeparator />
              <MenuItem onClick={() => handleExportNodes(normalizedSelectedIds, "png")}>
                <ImageIcon />
                <span>
                  <T>Export selection as PNG</T>
                </span>
              </MenuItem>
              <MenuItem onClick={() => handleExportNodes(normalizedSelectedIds, "svg")}>
                <ShapesIcon />
                <span>
                  <T>Export selection as SVG</T>
                </span>
              </MenuItem>
              <MenuItem onClick={() => handleExportNodes(normalizedSelectedIds, "html")}>
                <FileCodeIcon />
                <span>
                  <T>Export selection as HTML</T>
                </span>
              </MenuItem>
            </>
          ) : null}
        </MenuPopup>
      </Menu>

      {onOpenFullPage !== undefined ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={gt("Open full workspace")}
                onClick={onOpenFullPage}
              />
            }
          >
            <Maximize2Icon className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup>
            <T>Open full workspace</T>
          </TooltipPopup>
        </Tooltip>
      ) : null}
    </div>
  );

  const selectionOverlay =
    threadRef !== undefined && pickActive && selectedNodes.length > 0 ? (
      <div className="dropdown-glass flex items-center gap-2 rounded-xl border border-border p-2 text-popover-foreground shadow-2xl">
        <span className="max-w-28 shrink-0 truncate rounded-md bg-muted px-1.5 py-1 text-2xs font-medium text-muted-foreground">
          {selectedNodes.length === 1
            ? selectedNodes[0]!.name
            : gt("{count, plural, one {{count} layer} other {{count} layers}}", {
                count: selectedNodes.length,
              })}
        </span>

        <input
          autoFocus
          type="text"
          className="h-8 min-w-0 flex-1 border-0 border-b border-transparent bg-transparent px-0.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
          placeholder={gt("Describe the change...")}
          value={askChatNote}
          onChange={(event) => setAskChatNote(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              const shouldSend = (event.metaKey || event.ctrlKey) && onSendAnnotation !== undefined;
              submitElementsToChat(shouldSend ? "send" : "attach");
            }
            if (event.key === "Escape") {
              event.preventDefault();
              cancelPickMode();
            }
          }}
        />

        <Tooltip>
          <TooltipTrigger
            render={
              <Button size="sm" onClick={() => submitElementsToChat("attach")}>
                <T>Attach</T>
              </Button>
            }
          />
          <TooltipPopup>
            {onSendAnnotation !== undefined
              ? gt("Attach annotation (Enter) · Cmd/Ctrl+Enter to send")
              : gt("Attach annotation (Enter)")}
          </TooltipPopup>
        </Tooltip>
      </div>
    ) : null;

  const bottomOverlay = (
    <div
      className="dropdown-glass pointer-events-auto absolute bottom-3 left-1/2 z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-xl border border-border/70 p-1 shadow-lg"
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
    >
      {tools.map((item) => {
        const isDraw = item.id !== "select" && item.id !== "hand";
        return (
          <Tooltip key={item.id}>
            <TooltipTrigger
              render={
                <Button
                  size="icon-xs"
                  variant={!pickActive && tool === item.id ? "secondary" : "ghost"}
                  disabled={isDraw && !canMutate}
                  aria-label={item.label}
                  onClick={() => {
                    if (pickActive) cancelPickMode();
                    setTool(item.id);
                  }}
                />
              }
            >
              {item.icon}
            </TooltipTrigger>
            <TooltipPopup>{item.label}</TooltipPopup>
          </Tooltip>
        );
      })}
    </div>
  );

  return (
    <div
      ref={workspaceRef}
      role="application"
      aria-label={gt("Design canvas")}
      tabIndex={-1}
      className="flex h-full min-h-0 flex-col bg-background outline-none"
      onPointerDownCapture={handleWorkspacePointerDownCapture}
      onPointerEnter={() => {
        pointerInsideRef.current = true;
      }}
      onPointerLeave={() => {
        pointerInsideRef.current = false;
      }}
    >
      {onBack !== undefined ? (
        <WorkspacePageHeader
          electron={reserveWindowControls}
          reserveNativeControls={reserveWindowControls}
          className="border-b border-border/60"
        >
          <WorkspaceBreadcrumb ariaLabel={gt("Design canvas")} className="min-w-0 flex-1">
            <WorkspaceBreadcrumbItem>
              <button
                type="button"
                className="cursor-pointer rounded px-1 py-0.5 text-muted-foreground transition-colors hover:text-foreground [-webkit-app-region:no-drag]"
                onClick={onBack}
              >
                <WorkspaceBreadcrumbText>
                  <T>Objects</T>
                </WorkspaceBreadcrumbText>
              </button>
            </WorkspaceBreadcrumbItem>
            <WorkspaceBreadcrumbSeparator />
            <WorkspaceBreadcrumbItem current className="min-w-0 gap-2 [-webkit-app-region:no-drag]">
              {titleControl}
              <span className="shrink-0 text-xs font-normal tabular-nums text-muted-foreground">
                v{activeObject.revision}
              </span>
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
          {headerActions}
        </WorkspacePageHeader>
      ) : (
        <div className={FILE_SURFACE_SUBHEADER_CLASS} data-surface-subheader>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {titleControl}
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              v{activeObject.revision}
            </span>
          </div>
          {headerActions}
        </div>
      )}

      {actionError !== null ? (
        <div className="flex items-center justify-between border-b border-destructive/30 bg-destructive/10 px-3 py-1 text-xs text-destructive">
          <span className="truncate">{actionError}</span>
          <button type="button" className="ml-2 underline" onClick={() => setActionError(null)}>
            <T>Dismiss</T>
          </button>
        </div>
      ) : null}

      {/* Main Editor Area */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {showLeftPanel ? (
          <>
            <DesignLayersPanel
              doc={currentDoc}
              width={leftWidth}
              selectedIds={normalizedSelectedIds}
              renamingId={renamingLayerId}
              currentRevision={activeObject.revision}
              revisions={revisions}
              revisionsLoading={revisionsLoading}
              activeTab={leftTab}
              onTabChange={setLeftTab}
              onSelectIds={handleSelectFromLayers}
              onStartRename={setRenamingLayerId}
              onRename={handleRenameNode}
              onCancelRename={() => setRenamingLayerId(null)}
              onNodeContextMenu={handleLayerContextMenu}
              onToggleVisible={(node) =>
                handlePatchNode(
                  node.id,
                  { visible: node.visible === false },
                  `${node.visible === false ? "Shown" : "Hidden"} ${node.name}`,
                )
              }
              onToggleLocked={(node) =>
                handlePatchNode(
                  node.id,
                  { locked: node.locked !== true },
                  `${node.locked === true ? "Unlocked" : "Locked"} ${node.name}`,
                )
              }
              onDelete={(id) => handleDeleteNodes([id])}
              onRestoreRevision={(rev) => restoreRevision(rev, null)}
            />
            <div
              role="separator"
              aria-orientation="vertical"
              className="w-1 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-primary/40"
              onPointerDown={(event) => {
                event.preventDefault();
                setResizingPanel({ side: "left", startX: event.clientX, startWidth: leftWidth });
              }}
            />
          </>
        ) : null}

        <DesignCanvasViewport
          doc={currentDoc}
          tool={tool}
          selectedIds={normalizedSelectedIds}
          pickActive={pickActive}
          readOnly={!canMutate}
          selectionAnchorWorld={selectionAnchorWorld}
          selectionOverlay={selectionOverlay}
          bottomOverlay={bottomOverlay}
          spacePressed={spacePressed}
          handleRef={canvasHandleRef}
          onSelectIds={setSelectedIds}
          onPickNode={handlePickNode}
          onAddNode={handleAddNode}
          onCommitOps={commitOps}
          onContextMenu={handleCanvasContextMenu}
        />

        {showInspector ? (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              className="w-1 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-primary/40"
              onPointerDown={(event) => {
                event.preventDefault();
                setResizingPanel({
                  side: "right",
                  startX: event.clientX,
                  startWidth: rightWidth,
                });
              }}
            />
            <DesignInspectorPanel
              doc={currentDoc}
              width={rightWidth}
              selectedIds={normalizedSelectedIds}
              onPatchNode={handlePatchNode}
              onSetBackground={(background) =>
                commitOps(
                  [{ op: "setBackground", background }],
                  background === null
                    ? "Reset canvas background to theme"
                    : "Updated canvas background",
                )
              }
              onDetachFromParent={handleDetachFromInspector}
              onExportNodes={handleExportNodes}
              onAnnotateNodes={threadRef !== undefined ? handleAnnotateNodes : undefined}
            />
          </>
        ) : null}
      </div>

      <DesignContextMenu
        contextMenu={contextMenu}
        doc={currentDoc}
        selectedIds={normalizedSelectedIds}
        canMutate={canMutate}
        canUndo={canUndo}
        canRedo={canRedo}
        canAnnotate={threadRef !== undefined}
        onClose={() => setContextMenu(null)}
        onCopyNodes={handleCopyNodes}
        onCutNodes={handleCutNodes}
        onPaste={handlePaste}
        onDuplicateNodes={handleDuplicateNodes}
        onStartRename={(id, target) => {
          if (target === "layers") {
            setRenamingLayerId(id);
          } else {
            canvasHandleRef.current?.startRename(id);
          }
        }}
        onExportNodes={handleExportNodes}
        onReorderNode={handleReorderNode}
        onDetachNode={handleDetachFromInspector}
        onCommitOps={commitOps}
        onAnnotateNodes={handleAnnotateNodes}
        onDeleteNodes={handleDeleteNodes}
        onSelectIds={setSelectedIds}
        onAddNode={handleAddNode}
        onFitView={handleFitView}
        onZoomIn={() => canvasHandleRef.current?.zoomIn()}
        onZoomOut={() => canvasHandleRef.current?.zoomOut()}
        onUndo={handleUndo}
        onRedo={handleRedo}
      />
    </div>
  );
}
