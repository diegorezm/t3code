import {
  emptyDesignDocument,
  type DesignDocument,
  type DesignMutationOp,
  type DesignNode,
  type DesignNodeId,
  type DesignNodeInput,
  type DesignNodePatch,
  type EnvironmentId,
  type PreviewAnnotationPayload,
  type ScopedThreadRef,
  type T3Object,
  type T3ObjectId,
  type T3ObjectRevisionSummary,
} from "@t3tools/contracts";
import { applyDesignMutations } from "@t3tools/shared/designDocument";
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
  SquareIcon,
  TypeIcon,
  Undo2Icon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";

import { FILE_SURFACE_SUBHEADER_CLASS } from "~/components/files/fileSurfaceChrome";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
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
  listT3ObjectRevisions,
  mutateDesignObject,
  readT3Object,
  renameT3Object,
  restoreT3ObjectRevision,
  useObjectsEnvironmentState,
} from "~/state/objects";
import { DesignCanvasViewport } from "./DesignCanvasViewport";
import { DesignInspectorPanel } from "./DesignInspectorPanel";
import { DesignLayersPanel } from "./DesignLayersPanel";
import {
  clampZoom,
  computeDocumentBounds,
  findPreviousRevision,
  isEditableTarget,
  type DesignTool,
  type Point2D,
  type ViewportSize,
  type ViewportTransform,
} from "./designEditorTypes";

const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 440;

function clampSidebarWidth(width: number): number {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)));
}

function slugifyFilename(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "design";
}

function triggerFileDownload(content: string, mimeType: string, filename: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function buildDesignElementAnnotation(input: {
  readonly object: T3Object;
  readonly node: DesignNode;
  readonly comment: string;
}): PreviewAnnotationPayload {
  const { object, node, comment } = input;
  const pageUrl = `t3-object://${object.id}`;
  const pageTitle = `T3 Design Object: ${object.title} (id=${object.id}, rev=${object.revision})`;
  const now = new Date().toISOString();
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
    id: `t3-object-annotation-${object.id}-${node.id}-${Date.now()}`,
    pageUrl,
    pageTitle,
    comment,
    elements: [
      {
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
      },
    ],
    regions: [],
    strokes: [],
    styleChanges: [],
    screenshot: null,
    createdAt: now,
  };
}

interface HistoryNavState {
  readonly trackedRevision: number;
  readonly logicalRevision: number;
  readonly redoStack: ReadonlyArray<number>;
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
  const pointerInsideRef = useRef(false);
  const { state: envState } = useObjectsEnvironmentState(environmentId);
  const streamedObject = envState.objectsById[objectId] ?? null;
  const streamedSummary = envState.summariesById[objectId] ?? null;

  const [fetchedObject, setFetchedObject] = useState<T3Object | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [optimisticDoc, setOptimisticDoc] = useState<DesignDocument | null>(null);
  const [revisions, setRevisions] = useState<ReadonlyArray<T3ObjectRevisionSummary>>([]);
  const [loadedRevisionsKey, setLoadedRevisionsKey] = useState<string | null>(null);

  const [tool, setTool] = useState<DesignTool>("select");
  const [selectedId, setSelectedId] = useState<DesignNodeId | null>(null);
  const [selectionAnchorWorld, setSelectionAnchorWorld] = useState<Point2D | null>(null);
  const [pickActive, setPickActive] = useState(false);
  const [askChatNote, setAskChatNote] = useState("");

  const [viewport, setViewport] = useState<ViewportTransform>({ x: 80, y: 64, zoom: 1 });
  const [viewportSize, setViewportSize] = useState<ViewportSize>({ width: 800, height: 600 });
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
  const [historyNav, setHistoryNav] = useState<HistoryNavState | null>(null);

  const activeObject: T3Object | null =
    streamedObject !== null &&
    (fetchedObject === null || streamedObject.revision >= fetchedObject.revision)
      ? streamedObject
      : fetchedObject;

  const currentDoc: DesignDocument =
    optimisticDoc ?? activeObject?.content.document ?? emptyDesignDocument();

  const selectedNode: DesignNode | undefined =
    selectedId === null ? undefined : currentDoc.nodes[selectedId];

  const streamedRevision = streamedSummary?.revision ?? streamedObject?.revision ?? null;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads the full object payload when opening an object or when its summary revision advances beyond the cached full document
  useEffect(() => {
    let cancelled = false;
    if (
      streamedObject !== null &&
      (streamedRevision === null || streamedObject.revision >= streamedRevision)
    ) {
      return;
    }
    void readT3Object(environmentId, objectId).then(
      (object) => {
        if (cancelled) return;
        setFetchedObject(object);
        setLoadError(null);
      },
      (error: unknown) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : String(error));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [environmentId, objectId, streamedObject, streamedRevision]);

  const activeRevision = activeObject?.revision ?? null;
  const targetRevisionsKey =
    activeRevision === null ? null : `${environmentId}:${objectId}:${activeRevision}`;
  const revisionsLoading = targetRevisionsKey !== null && loadedRevisionsKey !== targetRevisionsKey;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- refreshes the revision timeline whenever the object's revision changes
  useEffect(() => {
    if (targetRevisionsKey === null) return;
    let cancelled = false;
    void listT3ObjectRevisions(environmentId, objectId, 60).then(
      (list) => {
        if (cancelled) return;
        setRevisions(list);
        setLoadedRevisionsKey(targetRevisionsKey);
      },
      () => {
        if (cancelled) return;
        setLoadedRevisionsKey(targetRevisionsKey);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [environmentId, objectId, targetRevisionsKey]);

  const hasMatchingHistoryNav =
    historyNav !== null &&
    activeObject !== null &&
    historyNav.trackedRevision === activeObject.revision;
  const logicalRevision = hasMatchingHistoryNav
    ? historyNav.logicalRevision
    : (activeObject?.revision ?? null);
  const redoStack = hasMatchingHistoryNav ? historyNav.redoStack : [];
  const undoTarget =
    logicalRevision !== null ? findPreviousRevision(revisions, logicalRevision) : null;
  const redoTarget = redoStack[redoStack.length - 1] ?? null;

  const commitOps = (ops: ReadonlyArray<DesignMutationOp>, summary: string) => {
    if (activeObject === null) return;
    const baseRevision = activeObject.revision;
    const preview = applyDesignMutations(currentDoc, ops);
    if (preview.ok) {
      setOptimisticDoc(preview.document);
      if (preview.createdIds.length > 0) {
        setSelectedId(preview.createdIds[preview.createdIds.length - 1] ?? null);
      }
    }
    setActionError(null);
    void mutateDesignObject(environmentId, {
      id: objectId,
      ops,
      summary,
      expectedRevision: baseRevision,
    }).then(
      (result) => {
        setFetchedObject(result.object);
        setOptimisticDoc(null);
        setHistoryNav(null);
      },
      (error: unknown) => {
        setOptimisticDoc(null);
        setActionError(error instanceof Error ? error.message : String(error));
        void readT3Object(environmentId, objectId).then(
          (latest) => setFetchedObject(latest),
          () => undefined,
        );
      },
    );
  };

  const restoreRevision = (
    targetRevision: number,
    nextNav: ((newRevision: number) => HistoryNavState | null) | null,
  ) => {
    if (activeObject === null) return;
    setActionError(null);
    void restoreT3ObjectRevision(environmentId, {
      id: objectId,
      revision: targetRevision,
      expectedRevision: activeObject.revision,
    }).then(
      (result) => {
        setFetchedObject(result.object);
        setOptimisticDoc(null);
        setHistoryNav(nextNav ? nextNav(result.object.revision) : null);
      },
      (error: unknown) => {
        setActionError(error instanceof Error ? error.message : String(error));
      },
    );
  };

  const handleUndo = () => {
    if (undoTarget === null || logicalRevision === null) return;
    const nextRedo = [...redoStack.slice(-29), logicalRevision];
    restoreRevision(undoTarget, (newRevision) => ({
      trackedRevision: newRevision,
      logicalRevision: undoTarget,
      redoStack: nextRedo,
    }));
  };

  const handleRedo = () => {
    if (redoTarget === null) return;
    const nextRedo = redoStack.slice(0, -1);
    restoreRevision(redoTarget, (newRevision) => ({
      trackedRevision: newRevision,
      logicalRevision: redoTarget,
      redoStack: nextRedo,
    }));
  };

  const handleAddNode = (node: DesignNodeInput) => {
    commitOps([{ op: "add", node }], `Added ${node.name}`);
    setTool("select");
  };

  const handlePatchNode = (id: DesignNodeId, patch: DesignNodePatch, summary: string) => {
    commitOps([{ op: "update", id, patch }], summary);
  };

  const handleDeleteNode = (id: DesignNodeId) => {
    const target = currentDoc.nodes[id];
    if (selectedId === id) {
      setSelectedId(null);
      setSelectionAnchorWorld(null);
    }
    commitOps([{ op: "delete", id }], `Deleted ${target?.name ?? "layer"}`);
  };

  const handleReorderToIndex = (node: DesignNode, index: number) => {
    commitOps([{ op: "reorder", id: node.id, index }], `Reordered ${node.name}`);
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
    const bounds = computeDocumentBounds(currentDoc);
    if (bounds === null) {
      setViewport({ x: 80, y: 64, zoom: 1 });
      return;
    }
    const padding = 48;
    const availWidth = Math.max(120, viewportSize.width - padding * 2);
    const availHeight = Math.max(120, viewportSize.height - padding * 2);
    const targetZoom = clampZoom(
      Math.min(availWidth / bounds.width, availHeight / bounds.height, 1.25),
    );
    const centeredX = (viewportSize.width - bounds.width * targetZoom) / 2 - bounds.x * targetZoom;
    const centeredY =
      (viewportSize.height - bounds.height * targetZoom) / 2 - bounds.y * targetZoom;
    setViewport({
      zoom: targetZoom,
      x: Math.round(centeredX),
      y: Math.round(centeredY),
    });
  };

  const handleExportSvg = () => {
    const rendered = renderDesignToSvg(currentDoc);
    triggerFileDownload(
      rendered.svg,
      "image/svg+xml;charset=utf-8",
      `${slugifyFilename(activeObject?.title ?? "design")}.svg`,
    );
  };

  const handleExportHtml = () => {
    const rendered = renderDesignToHtml(currentDoc);
    triggerFileDownload(
      rendered.html,
      "text/html;charset=utf-8",
      `${slugifyFilename(activeObject?.title ?? "design")}.html`,
    );
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
    } else {
      setPickActive(true);
      setSelectedId(null);
      setSelectionAnchorWorld(null);
      setAskChatNote("");
      workspaceRef.current?.focus({ preventScroll: true });
    }
  };

  const handlePickNode = (id: DesignNodeId | null, anchorWorld: Point2D | null) => {
    if (!pickActive) return;
    setSelectedId(id);
    setSelectionAnchorWorld(anchorWorld);
    setAskChatNote("");
  };

  const handleSelectFromLayers = (id: DesignNodeId | null) => {
    setSelectedId(id);
    setAskChatNote("");
    if (id === null || !pickActive) {
      setSelectionAnchorWorld(null);
      return;
    }
    const root = workspaceRef.current;
    const viewportEl = root?.querySelector<HTMLElement>('[data-design-canvas-viewport="true"]');
    const nodeEl = root?.querySelector<HTMLElement>(`[data-design-node-id="${CSS.escape(id)}"]`);
    if (
      viewportEl !== null &&
      viewportEl !== undefined &&
      nodeEl !== null &&
      nodeEl !== undefined
    ) {
      const vpRect = viewportEl.getBoundingClientRect();
      const nodeRect = nodeEl.getBoundingClientRect();
      const screenX = nodeRect.left + nodeRect.width / 2 - vpRect.left;
      const screenY = nodeRect.bottom - vpRect.top;
      setSelectionAnchorWorld({
        x: (screenX - viewport.x) / viewport.zoom,
        y: (screenY - viewport.y) / viewport.zoom,
      });
    } else {
      const node = currentDoc.nodes[id];
      setSelectionAnchorWorld(
        node !== undefined ? { x: node.x + node.width / 2, y: node.y + node.height } : null,
      );
    }
  };

  const submitElementToChat = (mode: "attach" | "send") => {
    if (threadRef === undefined || activeObject === null || selectedNode === undefined) return;
    const note = askChatNote.trim();
    const comment =
      note.length > 0
        ? note
        : gt("Adjust this design element in the T3 Object using design_mutate.");
    const annotation = buildDesignElementAnnotation({
      object: activeObject,
      node: selectedNode,
      comment,
    });
    useComposerDraftStore.getState().addPreviewAnnotation(threadRef, annotation);
    if (mode === "send") {
      onSendAnnotation?.(annotation, null);
    }
    setSelectedId(null);
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

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- handles canvas shortcuts (Space pan, tools, nudge, delete, undo/redo) when focused or hovered without interfering with ChatComposer typing
  useEffect(() => {
    const canHandleCanvasKeys = () => {
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
        event.preventDefault();
        if (event.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Escape") {
        if (pickActive) {
          setPickActive(false);
          setSelectedId(null);
          setSelectionAnchorWorld(null);
          setAskChatNote("");
        } else if (tool !== "select") {
          setTool("select");
        } else {
          setSelectedId(null);
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
          setTool("frame");
          break;
        case "r":
          setTool("rect");
          break;
        case "o":
          setTool("ellipse");
          break;
        case "t":
          setTool("text");
          break;
        case "l":
          setTool("line");
          break;
        case "arrowup":
          if (selectedNode !== undefined && selectedNode.locked !== true) {
            event.preventDefault();
            handlePatchNode(
              selectedNode.id,
              { y: selectedNode.y - step },
              `Nudged ${selectedNode.name}`,
            );
          }
          break;
        case "arrowdown":
          if (selectedNode !== undefined && selectedNode.locked !== true) {
            event.preventDefault();
            handlePatchNode(
              selectedNode.id,
              { y: selectedNode.y + step },
              `Nudged ${selectedNode.name}`,
            );
          }
          break;
        case "arrowleft":
          if (selectedNode !== undefined && selectedNode.locked !== true) {
            event.preventDefault();
            handlePatchNode(
              selectedNode.id,
              { x: selectedNode.x - step },
              `Nudged ${selectedNode.name}`,
            );
          }
          break;
        case "arrowright":
          if (selectedNode !== undefined && selectedNode.locked !== true) {
            event.preventDefault();
            handlePatchNode(
              selectedNode.id,
              { x: selectedNode.x + step },
              `Nudged ${selectedNode.name}`,
            );
          }
          break;
        case "backspace":
        case "delete":
          if (selectedId !== null) {
            event.preventDefault();
            handleDeleteNode(selectedId);
          }
          break;
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
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
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
    const trimmed = titleDraft.trim();
    if (trimmed.length > 0 && trimmed !== activeObject.title) {
      void renameT3Object(environmentId, objectId, trimmed).then(
        (result) => setFetchedObject(result.object),
        () => undefined,
      );
    }
  };

  const titleControl = editingTitle ? (
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
      className="min-w-0 truncate rounded px-1 py-0.5 text-sm font-medium text-foreground hover:bg-accent/60"
      onClick={() => {
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
              disabled={undoTarget === null}
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

      {redoTarget !== null ? (
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
          <MenuItem onClick={handleExportSvg}>
            <ImageIcon />
            <span>
              <T>Export SVG (Figma)</T>
            </span>
          </MenuItem>
          <MenuItem onClick={handleExportHtml}>
            <FileCodeIcon />
            <span>
              <T>Export HTML</T>
            </span>
          </MenuItem>
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
    threadRef !== undefined && pickActive && selectedNode !== undefined ? (
      <div className="dropdown-glass flex items-center gap-2 rounded-xl border border-border p-2 text-popover-foreground shadow-2xl">
        <span className="max-w-24 shrink-0 truncate rounded-md bg-muted px-1.5 py-1 text-2xs font-medium text-muted-foreground">
          {selectedNode.name}
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
              submitElementToChat(shouldSend ? "send" : "attach");
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
              <Button size="sm" onClick={() => submitElementToChat("attach")}>
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
    <>
      <div
        className="dropdown-glass pointer-events-auto absolute bottom-3 left-1/2 z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-xl border border-border/70 p-1 shadow-lg"
        onPointerDown={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
      >
        {tools.map((item) => (
          <Tooltip key={item.id}>
            <TooltipTrigger
              render={
                <Button
                  size="icon-xs"
                  variant={!pickActive && tool === item.id ? "secondary" : "ghost"}
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
        ))}
      </div>

      {viewportSize.width >= 460 ? (
        <div
          className="dropdown-glass pointer-events-auto absolute right-3 bottom-3 z-30 flex items-center gap-0.5 rounded-lg border border-border/70 p-0.5 shadow-md"
          onPointerDown={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
        >
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={gt("Zoom out")}
                  onClick={() =>
                    setViewport({ ...viewport, zoom: clampZoom(viewport.zoom * 0.85) })
                  }
                />
              }
            >
              <ZoomOutIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup>
              <T>Zoom out</T>
            </TooltipPopup>
          </Tooltip>
          <button
            type="button"
            className="min-w-10 rounded px-1 py-0.5 text-2xs tabular-nums text-muted-foreground hover:bg-accent/60 hover:text-foreground"
            aria-label={gt("Fit to canvas (0)")}
            onClick={handleFitView}
          >
            {Math.round(viewport.zoom * 100)}%
          </button>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={gt("Zoom in")}
                  onClick={() =>
                    setViewport({ ...viewport, zoom: clampZoom(viewport.zoom * 1.15) })
                  }
                />
              }
            >
              <ZoomInIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup>
              <T>Zoom in</T>
            </TooltipPopup>
          </Tooltip>
        </div>
      ) : null}
    </>
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
              selectedId={selectedId}
              currentRevision={activeObject.revision}
              revisions={revisions}
              revisionsLoading={revisionsLoading}
              activeTab={leftTab}
              onTabChange={setLeftTab}
              onSelect={handleSelectFromLayers}
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
              onDelete={handleDeleteNode}
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
          viewport={viewport}
          tool={tool}
          selectedId={selectedId}
          pickActive={pickActive}
          selectionAnchorWorld={selectionAnchorWorld}
          selectionOverlay={selectionOverlay}
          bottomOverlay={bottomOverlay}
          spacePressed={spacePressed}
          onViewportChange={setViewport}
          onViewportSizeChange={setViewportSize}
          onSelect={setSelectedId}
          onPickNode={handlePickNode}
          onAddNode={handleAddNode}
          onCommitPatch={handlePatchNode}
          onReorderToIndex={handleReorderToIndex}
          onDetachAndMove={handleDetachAndMove}
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
              selectedId={selectedId}
              onPatchNode={handlePatchNode}
              onSetBackground={(background) =>
                commitOps([{ op: "setBackground", background }], "Updated canvas background")
              }
              onDetachFromParent={handleDetachFromInspector}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
