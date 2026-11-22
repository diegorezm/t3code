import type {
  DesignDocument,
  DesignNode,
  DesignNodeId,
  DesignNodeInput,
  DesignNodePatch,
} from "@t3tools/contracts";
import {
  formatDesignPadding,
  formatDesignShadow,
  sanitizeDesignSvg,
} from "@t3tools/shared/designRender";
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
  clampZoom,
  computeResizedBounds,
  makeNodeInputForTool,
  type DesignDrawTool,
  type DesignTool,
  type NodeBounds,
  type Point2D,
  type ResizeHandle,
  type ViewportSize,
  type ViewportTransform,
} from "./designEditorTypes";

interface MoveInteraction {
  readonly kind: "move";
  readonly pointerId: number;
  readonly nodeId: DesignNodeId;
  readonly inAutoLayoutParent: boolean;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly startBounds: NodeBounds;
  readonly currentBounds: NodeBounds;
  readonly dragOffsetX: number;
  readonly dragOffsetY: number;
  readonly startRectLeft: number;
  readonly startRectTop: number;
}

interface ResizeInteraction {
  readonly kind: "resize";
  readonly pointerId: number;
  readonly nodeId: DesignNodeId;
  readonly handle: ResizeHandle;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly startBounds: NodeBounds;
  readonly currentBounds: NodeBounds;
}

interface DrawInteraction {
  readonly kind: "draw";
  readonly pointerId: number;
  readonly tool: DesignDrawTool;
  readonly parentId: DesignNodeId | null;
  readonly startWorldX: number;
  readonly startWorldY: number;
  readonly currentWorldX: number;
  readonly currentWorldY: number;
}

interface PanInteraction {
  readonly kind: "pan";
  readonly pointerId: number;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly startViewportX: number;
  readonly startViewportY: number;
  readonly deselectOnClick: boolean;
  readonly moved: boolean;
}

interface PickInteraction {
  readonly kind: "pick";
  readonly pointerId: number;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly startViewportX: number;
  readonly startViewportY: number;
  readonly candidateNodeId: DesignNodeId | null;
  readonly panning: boolean;
}

type ActiveInteraction =
  | MoveInteraction
  | ResizeInteraction
  | DrawInteraction
  | PanInteraction
  | PickInteraction;

const PAN_DRAG_THRESHOLD_PX = 4;
const BUBBLE_WIDTH_PX = 360;
const BUBBLE_HEIGHT_PX = 52;

const RESIZE_HANDLES: ReadonlyArray<{
  readonly handle: ResizeHandle;
  readonly className: string;
}> = [
  { handle: "nw", className: "-top-1 -left-1 cursor-nwse-resize" },
  { handle: "n", className: "-top-1 left-1/2 -translate-x-1/2 cursor-ns-resize" },
  { handle: "ne", className: "-top-1 -right-1 cursor-nesw-resize" },
  { handle: "e", className: "top-1/2 -right-1 -translate-y-1/2 cursor-ew-resize" },
  { handle: "se", className: "-bottom-1 -right-1 cursor-nwse-resize" },
  { handle: "s", className: "-bottom-1 left-1/2 -translate-x-1/2 cursor-ns-resize" },
  { handle: "sw", className: "-bottom-1 -left-1 cursor-nesw-resize" },
  { handle: "w", className: "top-1/2 -left-1 -translate-y-1/2 cursor-ew-resize" },
];

function flexAlign(value: string | undefined): CSSProperties["alignItems"] {
  switch (value) {
    case "center":
      return "center";
    case "end":
      return "flex-end";
    case "stretch":
      return "stretch";
    default:
      return "flex-start";
  }
}

function flexJustify(value: string | undefined): CSSProperties["justifyContent"] {
  switch (value) {
    case "center":
      return "center";
    case "end":
      return "flex-end";
    case "space-between":
      return "space-between";
    case "space-around":
      return "space-around";
    default:
      return "flex-start";
  }
}

function CanvasNodeView({
  doc,
  nodeId,
  inAutoLayoutParent,
  selectedId,
  editingTextId,
  draftBounds,
  autoLayoutDragOffset,
  tool,
  pickActive,
  panMode,
  onSelect,
  onStartMove,
  onStartResize,
  onStartEditText,
  onCommitText,
}: {
  readonly doc: DesignDocument;
  readonly nodeId: DesignNodeId;
  readonly inAutoLayoutParent: boolean;
  readonly selectedId: DesignNodeId | null;
  readonly editingTextId: DesignNodeId | null;
  readonly draftBounds: { readonly id: DesignNodeId; readonly bounds: NodeBounds } | null;
  readonly autoLayoutDragOffset: {
    readonly id: DesignNodeId;
    readonly dx: number;
    readonly dy: number;
  } | null;
  readonly tool: DesignTool;
  readonly pickActive: boolean;
  readonly panMode: boolean;
  readonly onSelect: (id: DesignNodeId) => void;
  readonly onStartMove: (
    event: ReactPointerEvent,
    node: DesignNode,
    inAutoLayoutParent: boolean,
  ) => void;
  readonly onStartResize: (
    event: ReactPointerEvent,
    node: DesignNode,
    handle: ResizeHandle,
  ) => void;
  readonly onStartEditText: (id: DesignNodeId) => void;
  readonly onCommitText: (node: DesignNode, text: string) => void;
}) {
  const node = doc.nodes[nodeId];
  if (node === undefined || node.visible === false) return null;

  const isSelected = selectedId === node.id;
  const isEditingText = editingTextId === node.id && node.type === "text";
  const effectiveBounds =
    draftBounds !== null && draftBounds.id === node.id
      ? draftBounds.bounds
      : { x: node.x, y: node.y, width: node.width, height: node.height };
  const isAutoLayoutDragging = autoLayoutDragOffset !== null && autoLayoutDragOffset.id === node.id;

  const transforms: Array<string> = [];
  if (isAutoLayoutDragging) {
    transforms.push(`translate(${autoLayoutDragOffset.dx}px, ${autoLayoutDragOffset.dy}px)`);
  }
  if (node.rotation) {
    transforms.push(`rotate(${node.rotation}deg)`);
  }

  const style: CSSProperties = {
    boxSizing: "border-box",
    opacity: isAutoLayoutDragging ? Math.min(node.opacity ?? 1, 0.85) : (node.opacity ?? 1),
    transform: transforms.length > 0 ? transforms.join(" ") : undefined,
    zIndex: isAutoLayoutDragging ? 40 : undefined,
    borderRadius:
      node.type === "ellipse"
        ? 9999
        : node.radius !== undefined && node.radius > 0
          ? node.radius
          : undefined,
    boxShadow: formatDesignShadow(node.shadow) ?? undefined,
  };

  if (inAutoLayoutParent) {
    style.position = "relative";
    style.flexShrink = 0;
    if (node.widthMode === "fill") {
      style.width = "100%";
      style.flex = "1 1 auto";
      style.minWidth = 0;
    } else if (node.widthMode === "hug") {
      style.width = "fit-content";
    } else {
      style.width = effectiveBounds.width;
    }
    if (node.heightMode === "fill") {
      style.height = "100%";
      style.alignSelf = "stretch";
    } else if (node.heightMode === "hug") {
      style.height = "fit-content";
    } else {
      style.height = effectiveBounds.height;
    }
  } else {
    style.position = "absolute";
    style.left = effectiveBounds.x;
    style.top = effectiveBounds.y;
    style.width = effectiveBounds.width;
    style.height = effectiveBounds.height;
  }

  if (node.fill !== undefined && node.type !== "line") {
    if (node.fill.includes("gradient(")) {
      style.background = node.fill;
    } else {
      style.backgroundColor = node.fill;
    }
  }
  if (node.stroke !== undefined && node.type !== "line") {
    style.border = `${node.strokeWidth ?? 1}px solid ${node.stroke}`;
  }

  if (node.type === "frame") {
    if (node.clip !== false) {
      style.overflow = "hidden";
    }
    if (node.layout !== undefined) {
      style.display = "flex";
      style.flexDirection = node.layout.direction === "horizontal" ? "row" : "column";
      style.alignItems = flexAlign(node.layout.alignItems);
      style.justifyContent = flexJustify(node.layout.justifyContent);
      style.gap = node.layout.gap;
      style.padding = formatDesignPadding(node.layout.padding) ?? undefined;
      style.flexWrap = node.layout.wrap ? "wrap" : undefined;
    }
  } else if (node.type === "text") {
    style.color = node.color ?? "#f8fafc";
    style.fontSize = node.fontSize ?? 16;
    style.fontWeight = node.fontWeight ?? 400;
    style.lineHeight = node.lineHeight ?? 1.4;
    style.textAlign = node.textAlign ?? "left";
    style.fontFamily = node.fontFamily;
    style.letterSpacing = node.letterSpacing;
    style.whiteSpace = "pre-wrap";
    style.wordBreak = "break-word";
  } else if (node.type === "svg") {
    style.display = "flex";
    style.alignItems = "center";
    style.justifyContent = "center";
  } else if (node.type === "image") {
    style.overflow = "hidden";
  }

  const handlePointerDown = (event: ReactPointerEvent) => {
    if (panMode || pickActive || tool !== "select" || event.button !== 0 || isEditingText) return;
    event.stopPropagation();
    onSelect(node.id);
    if (node.locked !== true) {
      onStartMove(event, node, inAutoLayoutParent);
    }
  };

  const handleDoubleClick = (event: ReactMouseEvent) => {
    if (panMode || pickActive || node.type !== "text" || node.locked === true) return;
    event.stopPropagation();
    onStartEditText(node.id);
  };

  const canHoverOutline = !isSelected && !panMode && (pickActive || tool === "select");

  return (
    <div
      data-design-node-id={node.id}
      style={style}
      className={cn(
        "select-none",
        !panMode && !pickActive && tool === "select" && !node.locked && "cursor-move",
        isSelected && "ring-2 ring-inset ring-primary",
        canHoverOutline && "hover:ring-1 hover:ring-inset hover:ring-primary/50",
      )}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
    >
      {node.type === "frame" && node.parentId === null ? (
        <div className="pointer-events-none absolute -top-5 left-0 max-w-full truncate text-2xs font-medium text-muted-foreground">
          {node.name}
        </div>
      ) : null}

      {node.type === "frame"
        ? node.childIds.map((childId) => (
            <CanvasNodeView
              key={childId}
              doc={doc}
              nodeId={childId}
              inAutoLayoutParent={node.layout !== undefined}
              selectedId={selectedId}
              editingTextId={editingTextId}
              draftBounds={draftBounds}
              autoLayoutDragOffset={autoLayoutDragOffset}
              tool={tool}
              pickActive={pickActive}
              panMode={panMode}
              onSelect={onSelect}
              onStartMove={onStartMove}
              onStartResize={onStartResize}
              onStartEditText={onStartEditText}
              onCommitText={onCommitText}
            />
          ))
        : null}

      {node.type === "text" ? (
        isEditingText ? (
          <textarea
            autoFocus
            defaultValue={node.text}
            className="size-full resize-none bg-transparent outline-none"
            style={{
              color: "inherit",
              fontSize: "inherit",
              fontWeight: "inherit",
              lineHeight: "inherit",
              textAlign: "inherit",
              fontFamily: "inherit",
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onBlur={(event) => onCommitText(node, event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Escape" ||
                (event.key === "Enter" && (event.metaKey || event.ctrlKey))
              ) {
                event.preventDefault();
                onCommitText(node, event.currentTarget.value);
              }
            }}
          />
        ) : (
          node.text
        )
      ) : null}

      {node.type === "line" ? (
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${Math.max(1, effectiveBounds.width)} ${Math.max(1, effectiveBounds.height)}`}
          preserveAspectRatio="none"
        >
          <line
            x1="0"
            y1={effectiveBounds.height / 2}
            x2={effectiveBounds.width}
            y2={effectiveBounds.height / 2}
            stroke={node.stroke ?? node.fill ?? "#94a3b8"}
            strokeWidth={node.strokeWidth ?? 2}
            strokeDasharray={node.strokeDasharray}
          />
        </svg>
      ) : null}

      {node.type === "svg" ? (
        <div
          className="pointer-events-none flex size-full items-center justify-center"
          dangerouslySetInnerHTML={{ __html: sanitizeDesignSvg(node.svg) }}
        />
      ) : null}

      {node.type === "image" ? (
        <img
          src={node.src}
          alt={node.name}
          draggable={false}
          className="pointer-events-none block size-full"
          style={{ objectFit: node.objectFit ?? "cover" }}
        />
      ) : null}

      {isSelected && !pickActive && !panMode && node.locked !== true && !isEditingText ? (
        <>
          {RESIZE_HANDLES.map(({ handle, className }) => (
            <div
              key={handle}
              className={cn(
                "absolute z-30 size-2.5 rounded-xs border border-primary bg-background shadow-xs",
                className,
              )}
              onPointerDown={(event) => {
                event.stopPropagation();
                onStartResize(event, node, handle);
              }}
            />
          ))}
        </>
      ) : null}
    </div>
  );
}

export function DesignCanvasViewport({
  doc,
  viewport,
  tool,
  selectedId,
  pickActive,
  selectionAnchorWorld,
  selectionOverlay,
  bottomOverlay,
  spacePressed,
  onViewportChange,
  onViewportSizeChange,
  onSelect,
  onPickNode,
  onAddNode,
  onCommitPatch,
  onReorderToIndex,
  onDetachAndMove,
}: {
  readonly doc: DesignDocument;
  readonly viewport: ViewportTransform;
  readonly tool: DesignTool;
  readonly selectedId: DesignNodeId | null;
  readonly pickActive: boolean;
  readonly selectionAnchorWorld: Point2D | null;
  readonly selectionOverlay: ReactNode;
  readonly bottomOverlay?: ReactNode;
  readonly spacePressed: boolean;
  readonly onViewportChange: (next: ViewportTransform) => void;
  readonly onViewportSizeChange: (size: ViewportSize) => void;
  readonly onSelect: (id: DesignNodeId | null) => void;
  readonly onPickNode: (id: DesignNodeId | null, anchorWorld: Point2D | null) => void;
  readonly onAddNode: (input: DesignNodeInput) => void;
  readonly onCommitPatch: (id: DesignNodeId, patch: DesignNodePatch, summary: string) => void;
  readonly onReorderToIndex: (node: DesignNode, index: number) => void;
  readonly onDetachAndMove: (node: DesignNode, x: number, y: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const interactionRef = useRef<ActiveInteraction | null>(null);
  const [interaction, setInteraction] = useState<ActiveInteraction | null>(null);
  const [editingTextId, setEditingTextId] = useState<DesignNodeId | null>(null);
  const [viewportSize, setViewportSize] = useState<ViewportSize>({ width: 800, height: 600 });

  const latestRef = useRef({
    doc,
    viewport,
    onViewportChange,
    onViewportSizeChange,
    onSelect,
    onPickNode,
    onAddNode,
    onCommitPatch,
    onReorderToIndex,
    onDetachAndMove,
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps latest props synced for window pointer, wheel, and resize listeners without tearing them down mid-drag
  useEffect(() => {
    latestRef.current = {
      doc,
      viewport,
      onViewportChange,
      onViewportSizeChange,
      onSelect,
      onPickNode,
      onAddNode,
      onCommitPatch,
      onReorderToIndex,
      onDetachAndMove,
    };
  });

  const setActiveInteraction = (next: ActiveInteraction | null) => {
    interactionRef.current = next;
    setInteraction(next);
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tracks canvas container size for fit-to-canvas and clamping the floating annotation bubble
  useEffect(() => {
    const element = containerRef.current;
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

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers a non-passive wheel listener so Ctrl/Cmd+Wheel zooms the canvas instead of the Electron/browser window
  useEffect(() => {
    const element = containerRef.current;
    if (element === null) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const { viewport: current, onViewportChange: updateViewport } = latestRef.current;
      if (event.ctrlKey || event.metaKey) {
        const rect = element.getBoundingClientRect();
        const pointerX = event.clientX - rect.left;
        const pointerY = event.clientY - rect.top;
        const factor = event.deltaY < 0 ? 1.1 : 0.9;
        const nextZoom = clampZoom(current.zoom * factor);
        const ratio = nextZoom / current.zoom;
        updateViewport({
          zoom: nextZoom,
          x: pointerX - (pointerX - current.x) * ratio,
          y: pointerY - (pointerY - current.y) * ratio,
        });
      } else {
        updateViewport({
          ...current,
          x: current.x - event.deltaX,
          y: current.y - event.deltaY,
        });
      }
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      element.removeEventListener("wheel", onWheel);
    };
  }, []);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tracks active pan, move, resize, draw, and pick drags on window so drags never stall when focus shifts or pointer leaves the canvas
  useEffect(() => {
    const toWorld = (clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      const vp = latestRef.current.viewport;
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left - vp.x) / vp.zoom,
        y: (clientY - rect.top - vp.y) / vp.zoom,
      };
    };

    const onPointerMove = (event: PointerEvent) => {
      const current = interactionRef.current;
      if (current === null || current.pointerId !== event.pointerId) return;
      const { doc: activeDoc, viewport: vp, onViewportChange: updateViewport } = latestRef.current;

      if (current.kind === "pan") {
        const dx = event.clientX - current.startClientX;
        const dy = event.clientY - current.startClientY;
        const moved = current.moved || Math.hypot(dx, dy) >= PAN_DRAG_THRESHOLD_PX;
        if (moved && !current.moved) {
          const next: PanInteraction = { ...current, moved: true };
          interactionRef.current = next;
          setInteraction(next);
        }
        if (moved || !current.deselectOnClick) {
          updateViewport({
            ...vp,
            x: current.startViewportX + dx,
            y: current.startViewportY + dy,
          });
        }
        return;
      }

      if (current.kind === "pick") {
        const dx = event.clientX - current.startClientX;
        const dy = event.clientY - current.startClientY;
        if (!current.panning) {
          if (Math.hypot(dx, dy) < PAN_DRAG_THRESHOLD_PX) return;
          const next: PickInteraction = { ...current, panning: true };
          interactionRef.current = next;
          setInteraction(next);
        }
        updateViewport({
          ...vp,
          x: current.startViewportX + dx,
          y: current.startViewportY + dy,
        });
        return;
      }

      if (current.kind === "move") {
        const dx = (event.clientX - current.startClientX) / vp.zoom;
        const dy = (event.clientY - current.startClientY) / vp.zoom;
        const next: MoveInteraction = {
          ...current,
          dragOffsetX: Math.round(dx),
          dragOffsetY: Math.round(dy),
          currentBounds: {
            ...current.startBounds,
            x: Math.round(current.startBounds.x + dx),
            y: Math.round(current.startBounds.y + dy),
          },
        };
        interactionRef.current = next;
        setInteraction(next);
        return;
      }

      if (current.kind === "resize") {
        const dx = (event.clientX - current.startClientX) / vp.zoom;
        const dy = (event.clientY - current.startClientY) / vp.zoom;
        const next: ResizeInteraction = {
          ...current,
          currentBounds: computeResizedBounds(current.startBounds, current.handle, dx, dy),
        };
        interactionRef.current = next;
        setInteraction(next);
        return;
      }

      if (current.kind === "draw") {
        const world = toWorld(event.clientX, event.clientY);
        const parentFrame =
          current.parentId !== null ? activeDoc.nodes[current.parentId] : undefined;
        const next: DrawInteraction = {
          ...current,
          currentWorldX: parentFrame !== undefined ? world.x - parentFrame.x : world.x,
          currentWorldY: parentFrame !== undefined ? world.y - parentFrame.y : world.y,
        };
        interactionRef.current = next;
        setInteraction(next);
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      const finished = interactionRef.current;
      if (finished === null || finished.pointerId !== event.pointerId) return;
      interactionRef.current = null;
      setInteraction(null);

      const {
        doc: activeDoc,
        viewport: vp,
        onSelect: selectNode,
        onPickNode: pickNode,
        onAddNode: addNode,
        onCommitPatch: commitPatch,
        onReorderToIndex: reorderToIndex,
        onDetachAndMove: detachAndMove,
      } = latestRef.current;

      if (finished.kind === "pan") {
        if (finished.deselectOnClick && !finished.moved) {
          selectNode(null);
        }
        return;
      }

      if (finished.kind === "pick") {
        if (finished.panning) return;
        if (finished.candidateNodeId === null) {
          pickNode(null, null);
          return;
        }
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect === undefined) {
          pickNode(finished.candidateNodeId, null);
          return;
        }
        const nodeEl = containerRef.current?.querySelector<HTMLElement>(
          `[data-design-node-id="${CSS.escape(finished.candidateNodeId)}"]`,
        );
        const nodeRect = nodeEl?.getBoundingClientRect();
        const screenX =
          nodeRect !== undefined
            ? nodeRect.left + nodeRect.width / 2 - rect.left
            : event.clientX - rect.left;
        const screenY =
          nodeRect !== undefined ? nodeRect.bottom - rect.top : event.clientY - rect.top;
        pickNode(finished.candidateNodeId, {
          x: (screenX - vp.x) / vp.zoom,
          y: (screenY - vp.y) / vp.zoom,
        });
        return;
      }

      if (finished.kind === "move") {
        const node = activeDoc.nodes[finished.nodeId];
        if (node === undefined) return;
        const movedDistance = Math.hypot(finished.dragOffsetX, finished.dragOffsetY);
        if (movedDistance < 3) return;

        if (!finished.inAutoLayoutParent) {
          commitPatch(
            finished.nodeId,
            { x: finished.currentBounds.x, y: finished.currentBounds.y },
            `Moved ${node.name}`,
          );
          return;
        }

        const parent = node.parentId === null ? undefined : activeDoc.nodes[node.parentId];
        const container = containerRef.current;
        if (parent === undefined || parent.type !== "frame" || container === null) return;

        const parentEl = container.querySelector<HTMLElement>(
          `[data-design-node-id="${CSS.escape(parent.id)}"]`,
        );
        const parentRect = parentEl?.getBoundingClientRect();
        const outsideParent =
          parentRect !== undefined &&
          (event.clientX < parentRect.left - 16 ||
            event.clientX > parentRect.right + 16 ||
            event.clientY < parentRect.top - 16 ||
            event.clientY > parentRect.bottom + 16);

        if (outsideParent) {
          const dropLeft = finished.startRectLeft + (event.clientX - finished.startClientX);
          const dropTop = finished.startRectTop + (event.clientY - finished.startClientY);
          const worldDrop = toWorld(dropLeft, dropTop);
          detachAndMove(node, Math.round(worldDrop.x), Math.round(worldDrop.y));
          return;
        }

        const isHorizontal = parent.layout?.direction === "horizontal";
        const pointerPos = isHorizontal ? event.clientX : event.clientY;
        const otherSiblings = parent.childIds.filter((id) => id !== node.id);
        let targetIndex = otherSiblings.length;
        for (const [index, siblingId] of otherSiblings.entries()) {
          const siblingEl = container.querySelector<HTMLElement>(
            `[data-design-node-id="${CSS.escape(siblingId)}"]`,
          );
          const siblingRect = siblingEl?.getBoundingClientRect();
          if (siblingRect === undefined) continue;
          const center = isHorizontal
            ? siblingRect.left + siblingRect.width / 2
            : siblingRect.top + siblingRect.height / 2;
          if (pointerPos < center) {
            targetIndex = index;
            break;
          }
        }
        const currentIndex = parent.childIds.indexOf(node.id);
        if (targetIndex !== currentIndex) {
          reorderToIndex(node, targetIndex);
        }
        return;
      }

      if (finished.kind === "resize") {
        const changed =
          finished.currentBounds.x !== finished.startBounds.x ||
          finished.currentBounds.y !== finished.startBounds.y ||
          finished.currentBounds.width !== finished.startBounds.width ||
          finished.currentBounds.height !== finished.startBounds.height;
        if (changed) {
          const node = activeDoc.nodes[finished.nodeId];
          commitPatch(
            finished.nodeId,
            {
              x: finished.currentBounds.x,
              y: finished.currentBounds.y,
              width: finished.currentBounds.width,
              height: finished.currentBounds.height,
            },
            `Resized ${node?.name ?? "layer"}`,
          );
        }
        return;
      }

      if (finished.kind === "draw") {
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
        addNode(makeNodeInputForTool(finished.tool, bounds, finished.parentId));
      }
    };

    const onPointerCancel = (event: PointerEvent) => {
      if (interactionRef.current?.pointerId === event.pointerId) {
        interactionRef.current = null;
        setInteraction(null);
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

  const clientToWorld = (clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - viewport.x) / viewport.zoom,
      y: (clientY - rect.top - viewport.y) / viewport.zoom,
    };
  };

  const handleBackgroundPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    setEditingTextId(null);
    if (event.button !== 0 && event.button !== 1) return;

    const forcePan = event.button === 1 || spacePressed || (!pickActive && tool === "hand");
    if (forcePan) {
      event.preventDefault();
      setActiveInteraction({
        kind: "pan",
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startViewportX: viewport.x,
        startViewportY: viewport.y,
        deselectOnClick: false,
        moved: true,
      });
      return;
    }

    if (pickActive) {
      const targetNodeEl =
        event.target instanceof HTMLElement
          ? event.target.closest<HTMLElement>("[data-design-node-id]")
          : null;
      const rawId = targetNodeEl?.dataset.designNodeId;
      const candidateNodeId =
        rawId !== undefined && rawId in doc.nodes ? (rawId as DesignNodeId) : null;
      setActiveInteraction({
        kind: "pick",
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startViewportX: viewport.x,
        startViewportY: viewport.y,
        candidateNodeId,
        panning: false,
      });
      return;
    }

    if (tool === "select") {
      // Dragging on empty canvas background pans smoothly; a short click deselects.
      setActiveInteraction({
        kind: "pan",
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startViewportX: viewport.x,
        startViewportY: viewport.y,
        deselectOnClick: true,
        moved: false,
      });
      return;
    }

    if (tool === "hand") return;
    const drawTool: DesignDrawTool = tool;
    const world = clientToWorld(event.clientX, event.clientY);
    const selectedNode = selectedId === null ? undefined : doc.nodes[selectedId];
    const targetParentId =
      drawTool !== "frame" && selectedNode?.type === "frame" ? selectedNode.id : null;
    const parentFrame = targetParentId !== null ? doc.nodes[targetParentId] : undefined;
    const localX = parentFrame !== undefined ? world.x - parentFrame.x : world.x;
    const localY = parentFrame !== undefined ? world.y - parentFrame.y : world.y;

    setActiveInteraction({
      kind: "draw",
      pointerId: event.pointerId,
      tool: drawTool,
      parentId: targetParentId,
      startWorldX: localX,
      startWorldY: localY,
      currentWorldX: localX,
      currentWorldY: localY,
    });
  };

  const handleStartMove = (
    event: ReactPointerEvent,
    node: DesignNode,
    inAutoLayoutParent: boolean,
  ) => {
    const nodeEl = containerRef.current?.querySelector<HTMLElement>(
      `[data-design-node-id="${CSS.escape(node.id)}"]`,
    );
    const rect = nodeEl?.getBoundingClientRect();
    const startBounds = { x: node.x, y: node.y, width: node.width, height: node.height };
    setActiveInteraction({
      kind: "move",
      pointerId: event.pointerId,
      nodeId: node.id,
      inAutoLayoutParent,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startBounds,
      currentBounds: startBounds,
      dragOffsetX: 0,
      dragOffsetY: 0,
      startRectLeft: rect?.left ?? event.clientX,
      startRectTop: rect?.top ?? event.clientY,
    });
  };

  const handleStartResize = (event: ReactPointerEvent, node: DesignNode, handle: ResizeHandle) => {
    const startBounds = { x: node.x, y: node.y, width: node.width, height: node.height };
    setActiveInteraction({
      kind: "resize",
      pointerId: event.pointerId,
      nodeId: node.id,
      handle,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startBounds,
      currentBounds: startBounds,
    });
  };

  const draftBounds =
    interaction !== null &&
    ((interaction.kind === "move" && !interaction.inAutoLayoutParent) ||
      interaction.kind === "resize")
      ? { id: interaction.nodeId, bounds: interaction.currentBounds }
      : null;

  const autoLayoutDragOffset =
    interaction !== null && interaction.kind === "move" && interaction.inAutoLayoutParent
      ? { id: interaction.nodeId, dx: interaction.dragOffsetX, dy: interaction.dragOffsetY }
      : null;

  const drawPreviewStyle: CSSProperties | null =
    interaction?.kind === "draw"
      ? (() => {
          const parentFrame =
            interaction.parentId !== null ? doc.nodes[interaction.parentId] : undefined;
          const offsetX = parentFrame?.x ?? 0;
          const offsetY = parentFrame?.y ?? 0;
          return {
            position: "absolute",
            left: Math.min(interaction.startWorldX, interaction.currentWorldX) + offsetX,
            top: Math.min(interaction.startWorldY, interaction.currentWorldY) + offsetY,
            width: Math.max(2, Math.abs(interaction.currentWorldX - interaction.startWorldX)),
            height: Math.max(2, Math.abs(interaction.currentWorldY - interaction.startWorldY)),
          };
        })()
      : null;

  const isPanning =
    (interaction?.kind === "pan" && (interaction.moved || !interaction.deselectOnClick)) ||
    (interaction?.kind === "pick" && interaction.panning);
  const panMode = spacePressed || (!pickActive && tool === "hand");

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
      ref={containerRef}
      data-design-canvas-viewport="true"
      className={cn(
        "relative min-h-0 min-w-0 flex-1 touch-none overflow-hidden select-none",
        isPanning
          ? "cursor-grabbing"
          : panMode
            ? "cursor-grab"
            : pickActive || tool !== "select"
              ? "cursor-crosshair"
              : "cursor-default",
      )}
      style={{
        backgroundColor: doc.background ?? "#0f1117",
        backgroundImage: "radial-gradient(circle, rgba(148, 163, 184, 0.18) 1px, transparent 1px)",
        backgroundSize: `${Math.max(12, 24 * viewport.zoom)}px ${Math.max(12, 24 * viewport.zoom)}px`,
        backgroundPosition: `${viewport.x}px ${viewport.y}px`,
      }}
      onPointerDown={handleBackgroundPointerDown}
    >
      <div
        className="pointer-events-auto absolute top-0 left-0 origin-top-left"
        style={{
          transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.zoom})`,
        }}
      >
        {doc.rootIds.map((rootId) => (
          <CanvasNodeView
            key={rootId}
            doc={doc}
            nodeId={rootId}
            inAutoLayoutParent={false}
            selectedId={selectedId}
            editingTextId={editingTextId}
            draftBounds={draftBounds}
            autoLayoutDragOffset={autoLayoutDragOffset}
            tool={tool}
            pickActive={pickActive}
            panMode={panMode}
            onSelect={(id) => onSelect(id)}
            onStartMove={handleStartMove}
            onStartResize={handleStartResize}
            onStartEditText={(id) => setEditingTextId(id)}
            onCommitText={(node, text) => {
              setEditingTextId(null);
              if (node.type === "text" && text !== node.text) {
                onCommitPatch(node.id, { text }, `Edited text in ${node.name}`);
              }
            }}
          />
        ))}

        {drawPreviewStyle !== null ? (
          <div
            style={drawPreviewStyle}
            className="pointer-events-none rounded-xs border border-dashed border-primary bg-primary/15"
          />
        ) : null}
      </div>

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
