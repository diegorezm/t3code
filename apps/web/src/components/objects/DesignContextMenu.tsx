import type {
  DesignDocument,
  DesignMutationOp,
  DesignNode,
  DesignNodeId,
  DesignNodeInput,
} from "@t3tools/contracts";
import { T, useGT, Var } from "gt-react";
import {
  ArrowDownIcon,
  ArrowDownToLineIcon,
  ArrowUpIcon,
  ArrowUpToLineIcon,
  CircleIcon,
  ClipboardPasteIcon,
  CopyIcon,
  CopyPlusIcon,
  DownloadIcon,
  EyeIcon,
  EyeOffIcon,
  FileCodeIcon,
  FrameIcon,
  ImageIcon,
  LayersIcon,
  LockIcon,
  Maximize2Icon,
  MessageSquarePlusIcon,
  MousePointer2Icon,
  PencilIcon,
  Redo2Icon,
  ScissorsIcon,
  ShapesIcon,
  SquareIcon,
  Trash2Icon,
  TypeIcon,
  Undo2Icon,
  Unlink2Icon,
  UnlockIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";

import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuShortcut,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
} from "~/components/ui/menu";
import { isMacPlatform } from "~/lib/utils";
import type { DesignExportFormat } from "./DesignInspectorPanel";
import {
  getLayerOrderAvailability,
  getSelectAllNodeIds,
  makeNodeInputForTool,
  normalizeSelectedNodeIds,
  type LayerOrderDirection,
  type Point2D,
} from "./designEditorTypes";

export type DesignContextMenuState =
  | {
      readonly kind: "node";
      readonly nodeId: DesignNodeId;
      readonly nodeIds: ReadonlyArray<DesignNodeId>;
      readonly x: number;
      readonly y: number;
      readonly renameTarget: "canvas" | "layers";
    }
  | {
      readonly kind: "canvas";
      readonly x: number;
      readonly y: number;
      readonly worldX: number;
      readonly worldY: number;
    };

export function DesignContextMenu({
  contextMenu,
  doc,
  selectedIds,
  canMutate,
  canUndo,
  canRedo,
  canAnnotate,
  onClose,
  onCopyNodes,
  onCutNodes,
  onPaste,
  onDuplicateNodes,
  onStartRename,
  onExportNodes,
  onReorderNode,
  onDetachNode,
  onCommitOps,
  onAnnotateNodes,
  onDeleteNodes,
  onSelectIds,
  onAddNode,
  onFitView,
  onZoomIn,
  onZoomOut,
  onUndo,
  onRedo,
}: {
  readonly contextMenu: DesignContextMenuState | null;
  readonly doc: DesignDocument;
  readonly selectedIds: ReadonlyArray<DesignNodeId>;
  readonly canMutate: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly canAnnotate: boolean;
  readonly onClose: () => void;
  readonly onCopyNodes: (ids: ReadonlyArray<DesignNodeId>) => void;
  readonly onCutNodes: (ids: ReadonlyArray<DesignNodeId>) => void;
  readonly onPaste: (options?: { readonly pasteAt?: Point2D | null }) => void;
  readonly onDuplicateNodes: (ids: ReadonlyArray<DesignNodeId>) => void;
  readonly onStartRename: (id: DesignNodeId, target: "canvas" | "layers") => void;
  readonly onExportNodes: (
    nodeIds: ReadonlyArray<DesignNodeId> | null,
    format: DesignExportFormat,
  ) => void;
  readonly onReorderNode: (id: DesignNodeId, direction: LayerOrderDirection) => void;
  readonly onDetachNode: (node: DesignNode) => void;
  readonly onCommitOps: (ops: ReadonlyArray<DesignMutationOp>, summary: string) => void;
  readonly onAnnotateNodes: (ids: ReadonlyArray<DesignNodeId>) => void;
  readonly onDeleteNodes: (ids: ReadonlyArray<DesignNodeId>) => void;
  readonly onSelectIds: (ids: ReadonlyArray<DesignNodeId>) => void;
  readonly onAddNode: (input: DesignNodeInput) => void;
  readonly onFitView: () => void;
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
}) {
  const gt = useGT();
  if (contextMenu === null) return null;

  const anchor = {
    getBoundingClientRect: () => new DOMRect(contextMenu.x, contextMenu.y, 0, 0),
  };
  const isMac = typeof navigator !== "undefined" && isMacPlatform(navigator.platform);

  if (contextMenu.kind === "node") {
    const menuNode = doc.nodes[contextMenu.nodeId];
    if (menuNode === undefined) return null;
    const menuNodeIds = normalizeSelectedNodeIds(doc, contextMenu.nodeIds);
    const targetIds = menuNodeIds.length > 0 ? menuNodeIds : [menuNode.id];
    const isSingleTarget = targetIds.length === 1;
    const parent = menuNode.parentId === null ? undefined : doc.nodes[menuNode.parentId];
    const inAutoLayoutParent = parent?.type === "frame" && parent.layout !== undefined;
    const order = getLayerOrderAvailability(doc, menuNode.id);
    const targetNodes = targetIds
      .map((id) => doc.nodes[id])
      .filter((item): item is DesignNode => item !== undefined);
    const allHidden = targetNodes.every((item) => item.visible === false);
    const allLocked = targetNodes.every((item) => item.locked === true);

    return (
      <Menu
        key={`${contextMenu.kind}:${contextMenu.x}:${contextMenu.y}`}
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <MenuPopup
          anchor={anchor}
          align="start"
          side="bottom"
          sideOffset={0}
          finalFocus={false}
          onContextMenu={(event) => event.preventDefault()}
        >
          <MenuItem
            onClick={() => {
              onClose();
              onCopyNodes(targetIds);
            }}
          >
            <CopyIcon className="size-3.5" />
            <span>
              <T>Copy</T>
            </span>
            <MenuShortcut>{isMac ? "⌘C" : "Ctrl+C"}</MenuShortcut>
          </MenuItem>
          <MenuItem
            disabled={!canMutate}
            onClick={() => {
              onClose();
              onCutNodes(targetIds);
            }}
          >
            <ScissorsIcon className="size-3.5" />
            <span>
              <T>Cut</T>
            </span>
            <MenuShortcut>{isMac ? "⌘X" : "Ctrl+X"}</MenuShortcut>
          </MenuItem>
          <MenuItem
            disabled={!canMutate}
            onClick={() => {
              onClose();
              onPaste();
            }}
          >
            <ClipboardPasteIcon className="size-3.5" />
            <span>
              <T>Paste</T>
            </span>
            <MenuShortcut>{isMac ? "⌘V" : "Ctrl+V"}</MenuShortcut>
          </MenuItem>
          <MenuItem
            disabled={!canMutate}
            onClick={() => {
              onClose();
              onDuplicateNodes(targetIds);
            }}
          >
            <CopyPlusIcon className="size-3.5" />
            <span>
              <T>Duplicate</T>
            </span>
            <MenuShortcut>{isMac ? "⌘D" : "Ctrl+D"}</MenuShortcut>
          </MenuItem>
          {isSingleTarget ? (
            <MenuItem
              disabled={!canMutate}
              onClick={() => {
                const target = contextMenu.renameTarget;
                onClose();
                onStartRename(menuNode.id, target);
              }}
            >
              <PencilIcon className="size-3.5" />
              <span>
                <T>Rename</T>
              </span>
              <MenuShortcut>F2</MenuShortcut>
            </MenuItem>
          ) : null}

          <MenuSeparator />

          <MenuSub>
            <MenuSubTrigger>
              <DownloadIcon className="size-3.5" />
              <span>
                {isSingleTarget ? (
                  <T>Download</T>
                ) : (
                  <T>
                    Download (<Var>{targetIds.length}</Var>)
                  </T>
                )}
              </span>
            </MenuSubTrigger>
            <MenuSubPopup>
              <MenuItem
                onClick={() => {
                  onClose();
                  onExportNodes(targetIds, "png");
                }}
              >
                <ImageIcon className="size-3.5" />
                <span>
                  <T>Download PNG (2x)</T>
                </span>
              </MenuItem>
              <MenuItem
                onClick={() => {
                  onClose();
                  onExportNodes(targetIds, "svg");
                }}
              >
                <ShapesIcon className="size-3.5" />
                <span>
                  <T>Download SVG (Figma)</T>
                </span>
              </MenuItem>
              <MenuItem
                onClick={() => {
                  onClose();
                  onExportNodes(targetIds, "html");
                }}
              >
                <FileCodeIcon className="size-3.5" />
                <span>
                  <T>Download HTML</T>
                </span>
              </MenuItem>
            </MenuSubPopup>
          </MenuSub>

          {isSingleTarget ? (
            <>
              <MenuSeparator />

              <MenuSub>
                <MenuSubTrigger
                  disabled={!canMutate || (!order.canBringForward && !order.canSendBackward)}
                >
                  <LayersIcon className="size-3.5" />
                  <span>
                    <T>Arrange</T>
                  </span>
                </MenuSubTrigger>
                <MenuSubPopup>
                  <MenuItem
                    disabled={!canMutate || !order.canBringForward}
                    onClick={() => {
                      onClose();
                      onReorderNode(menuNode.id, "front");
                    }}
                  >
                    <ArrowUpToLineIcon className="size-3.5" />
                    <span>
                      <T>Bring to front</T>
                    </span>
                  </MenuItem>
                  <MenuItem
                    disabled={!canMutate || !order.canBringForward}
                    onClick={() => {
                      onClose();
                      onReorderNode(menuNode.id, "forward");
                    }}
                  >
                    <ArrowUpIcon className="size-3.5" />
                    <span>
                      <T>Bring forward</T>
                    </span>
                  </MenuItem>
                  <MenuItem
                    disabled={!canMutate || !order.canSendBackward}
                    onClick={() => {
                      onClose();
                      onReorderNode(menuNode.id, "backward");
                    }}
                  >
                    <ArrowDownIcon className="size-3.5" />
                    <span>
                      <T>Send backward</T>
                    </span>
                  </MenuItem>
                  <MenuItem
                    disabled={!canMutate || !order.canSendBackward}
                    onClick={() => {
                      onClose();
                      onReorderNode(menuNode.id, "back");
                    }}
                  >
                    <ArrowDownToLineIcon className="size-3.5" />
                    <span>
                      <T>Send to back</T>
                    </span>
                  </MenuItem>
                </MenuSubPopup>
              </MenuSub>

              {inAutoLayoutParent ? (
                <MenuItem
                  disabled={!canMutate}
                  onClick={() => {
                    onClose();
                    onDetachNode(menuNode);
                  }}
                >
                  <Unlink2Icon className="size-3.5" />
                  <span>
                    <T>Detach from Auto Layout</T>
                  </span>
                </MenuItem>
              ) : null}
            </>
          ) : null}

          <MenuSeparator />

          <MenuItem
            disabled={!canMutate}
            onClick={() => {
              onClose();
              const nextVisible = allHidden;
              onCommitOps(
                targetIds.map((id) => ({
                  op: "update",
                  id,
                  patch: { visible: nextVisible },
                })),
                isSingleTarget
                  ? `${nextVisible ? "Shown" : "Hidden"} ${menuNode.name}`
                  : `${nextVisible ? "Shown" : "Hidden"} ${targetIds.length} layers`,
              );
            }}
          >
            {allHidden ? <EyeIcon className="size-3.5" /> : <EyeOffIcon className="size-3.5" />}
            <span>{allHidden ? <T>Show</T> : <T>Hide</T>}</span>
          </MenuItem>
          <MenuItem
            disabled={!canMutate}
            onClick={() => {
              onClose();
              const nextLocked = !allLocked;
              onCommitOps(
                targetIds.map((id) => ({
                  op: "update",
                  id,
                  patch: { locked: nextLocked },
                })),
                isSingleTarget
                  ? `${nextLocked ? "Locked" : "Unlocked"} ${menuNode.name}`
                  : `${nextLocked ? "Locked" : "Unlocked"} ${targetIds.length} layers`,
              );
            }}
          >
            {allLocked ? <UnlockIcon className="size-3.5" /> : <LockIcon className="size-3.5" />}
            <span>{allLocked ? <T>Unlock</T> : <T>Lock</T>}</span>
          </MenuItem>

          {canAnnotate ? (
            <>
              <MenuSeparator />
              <MenuItem
                onClick={() => {
                  onClose();
                  onAnnotateNodes(targetIds);
                }}
              >
                <MessageSquarePlusIcon className="size-3.5" />
                <span>
                  {isSingleTarget ? (
                    <T>Annotate for chat</T>
                  ) : (
                    <T>
                      Annotate for chat (<Var>{targetIds.length}</Var>)
                    </T>
                  )}
                </span>
              </MenuItem>
            </>
          ) : null}

          <MenuSeparator />

          <MenuItem
            variant="destructive"
            disabled={!canMutate}
            onClick={() => {
              onClose();
              onDeleteNodes(targetIds);
            }}
          >
            <Trash2Icon className="size-3.5" />
            <span>
              {isSingleTarget ? (
                <T>Delete</T>
              ) : (
                <T>
                  Delete (<Var>{targetIds.length}</Var>)
                </T>
              )}
            </span>
            <MenuShortcut>{isMac ? "⌫" : gt("Del")}</MenuShortcut>
          </MenuItem>
        </MenuPopup>
      </Menu>
    );
  }

  const originX = Math.round(contextMenu.worldX);
  const originY = Math.round(contextMenu.worldY);

  return (
    <Menu
      key={`${contextMenu.kind}:${contextMenu.x}:${contextMenu.y}`}
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <MenuPopup
        anchor={anchor}
        align="start"
        side="bottom"
        sideOffset={0}
        finalFocus={false}
        onContextMenu={(event) => event.preventDefault()}
      >
        <MenuItem
          disabled={!canMutate}
          onClick={() => {
            onClose();
            onPaste({ pasteAt: { x: originX, y: originY } });
          }}
        >
          <ClipboardPasteIcon className="size-3.5" />
          <span>
            <T>Paste here</T>
          </span>
          <MenuShortcut>{isMac ? "⌘V" : "Ctrl+V"}</MenuShortcut>
        </MenuItem>
        <MenuItem
          disabled={doc.rootIds.length === 0}
          onClick={() => {
            onClose();
            onSelectIds(getSelectAllNodeIds(doc, selectedIds));
          }}
        >
          <MousePointer2Icon className="size-3.5" />
          <span>
            <T>Select all</T>
          </span>
          <MenuShortcut>{isMac ? "⌘A" : "Ctrl+A"}</MenuShortcut>
        </MenuItem>

        <MenuSeparator />
        <MenuItem
          disabled={!canMutate}
          onClick={() => {
            onClose();
            onAddNode(
              makeNodeInputForTool(
                "frame",
                { x: originX, y: originY, width: 360, height: 240 },
                null,
              ),
            );
          }}
        >
          <FrameIcon className="size-3.5" />
          <span>
            <T>Add Frame</T>
          </span>
        </MenuItem>
        <MenuItem
          disabled={!canMutate}
          onClick={() => {
            onClose();
            onAddNode(
              makeNodeInputForTool(
                "rect",
                { x: originX, y: originY, width: 140, height: 96 },
                null,
              ),
            );
          }}
        >
          <SquareIcon className="size-3.5" />
          <span>
            <T>Add Rectangle</T>
          </span>
        </MenuItem>
        <MenuItem
          disabled={!canMutate}
          onClick={() => {
            onClose();
            onAddNode(
              makeNodeInputForTool(
                "ellipse",
                { x: originX, y: originY, width: 120, height: 120 },
                null,
              ),
            );
          }}
        >
          <CircleIcon className="size-3.5" />
          <span>
            <T>Add Ellipse</T>
          </span>
        </MenuItem>
        <MenuItem
          disabled={!canMutate}
          onClick={() => {
            onClose();
            onAddNode(
              makeNodeInputForTool(
                "text",
                { x: originX, y: originY, width: 200, height: 40 },
                null,
              ),
            );
          }}
        >
          <TypeIcon className="size-3.5" />
          <span>
            <T>Add Text</T>
          </span>
        </MenuItem>

        <MenuSeparator />

        <MenuItem
          onClick={() => {
            onClose();
            onFitView();
          }}
        >
          <Maximize2Icon className="size-3.5" />
          <span>
            <T>Zoom to fit</T>
          </span>
          <MenuShortcut>0</MenuShortcut>
        </MenuItem>
        <MenuItem
          onClick={() => {
            onClose();
            onZoomIn();
          }}
        >
          <ZoomInIcon className="size-3.5" />
          <span>
            <T>Zoom in</T>
          </span>
        </MenuItem>
        <MenuItem
          onClick={() => {
            onClose();
            onZoomOut();
          }}
        >
          <ZoomOutIcon className="size-3.5" />
          <span>
            <T>Zoom out</T>
          </span>
        </MenuItem>

        <MenuSeparator />

        <MenuItem
          disabled={!canMutate || !canUndo}
          onClick={() => {
            onClose();
            onUndo();
          }}
        >
          <Undo2Icon className="size-3.5" />
          <span>
            <T>Undo</T>
          </span>
          <MenuShortcut>{isMac ? "⌘Z" : "Ctrl+Z"}</MenuShortcut>
        </MenuItem>
        {canRedo ? (
          <MenuItem
            disabled={!canMutate}
            onClick={() => {
              onClose();
              onRedo();
            }}
          >
            <Redo2Icon className="size-3.5" />
            <span>
              <T>Redo</T>
            </span>
            <MenuShortcut>{isMac ? "⇧⌘Z" : "Ctrl+Shift+Z"}</MenuShortcut>
          </MenuItem>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}
