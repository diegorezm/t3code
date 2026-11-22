import type {
  DesignDocument,
  DesignNode,
  DesignNodeId,
  T3ObjectRevisionSummary,
} from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import {
  BotIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleIcon,
  EyeIcon,
  EyeOffIcon,
  FrameIcon,
  HistoryIcon,
  ImageIcon,
  LayersIcon,
  LockIcon,
  MinusIcon,
  RotateCcwIcon,
  ShapesIcon,
  SquareIcon,
  Trash2Icon,
  TypeIcon,
  UnlockIcon,
  UserIcon,
} from "lucide-react";
import { type MouseEvent as ReactMouseEvent, useEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import { cn } from "~/lib/utils";
import { normalizeSelectedNodeIds } from "./designEditorTypes";

function collectVisibleLayerIds(
  doc: DesignDocument,
  collapsedIds: ReadonlySet<string>,
): ReadonlyArray<DesignNodeId> {
  const ordered: Array<DesignNodeId> = [];
  const visit = (id: DesignNodeId) => {
    const node = doc.nodes[id];
    if (node === undefined) return;
    ordered.push(id);
    if (node.type === "frame" && !collapsedIds.has(id)) {
      for (const childId of node.childIds) {
        visit(childId);
      }
    }
  };
  for (const rootId of doc.rootIds) {
    visit(rootId);
  }
  return ordered;
}

function NodeTypeIcon({ type }: { readonly type: DesignNode["type"] }) {
  const cls = "size-3.5 shrink-0 text-muted-foreground/80";
  switch (type) {
    case "frame":
      return <FrameIcon className={cls} />;
    case "rect":
      return <SquareIcon className={cls} />;
    case "ellipse":
      return <CircleIcon className={cls} />;
    case "text":
      return <TypeIcon className={cls} />;
    case "line":
      return <MinusIcon className={cls} />;
    case "svg":
      return <ShapesIcon className={cls} />;
    case "image":
      return <ImageIcon className={cls} />;
  }
}

function LayerRenameInput({
  initialName,
  ariaLabel,
  onCommit,
  onCancel,
}: {
  readonly initialName: string;
  readonly ariaLabel: string;
  readonly onCommit: (nextName: string) => void;
  readonly onCancel: () => void;
}) {
  const [nameDraft, setNameDraft] = useState(initialName);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const committedRef = useRef(false);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- focuses and selects inline layer rename input when mounted
  useEffect(() => {
    const rafId = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(rafId);
  }, []);

  const finish = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    const trimmed = nameDraft.trim();
    if (trimmed.length > 0 && trimmed !== initialName) {
      onCommit(trimmed);
    } else {
      onCancel();
    }
  };

  return (
    <input
      ref={inputRef}
      type="text"
      aria-label={ariaLabel}
      value={nameDraft}
      className="h-5 min-w-0 flex-1 rounded border border-primary bg-background px-1 text-xs text-foreground outline-none select-text"
      onChange={(event) => setNameDraft(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onBlur={finish}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          finish();
        } else if (event.key === "Escape") {
          event.preventDefault();
          committedRef.current = true;
          onCancel();
        }
      }}
    />
  );
}

function LayerRow({
  doc,
  nodeId,
  depth,
  selectedIdSet,
  renamingId,
  collapsedIds,
  onToggleCollapse,
  onRowClick,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onNodeContextMenu,
  onToggleVisible,
  onToggleLocked,
  onDelete,
}: {
  readonly doc: DesignDocument;
  readonly nodeId: DesignNodeId;
  readonly depth: number;
  readonly selectedIdSet: ReadonlySet<string>;
  readonly renamingId: DesignNodeId | null;
  readonly collapsedIds: ReadonlySet<string>;
  readonly onToggleCollapse: (id: DesignNodeId) => void;
  readonly onRowClick: (event: ReactMouseEvent<HTMLDivElement>, id: DesignNodeId) => void;
  readonly onStartRename: (id: DesignNodeId) => void;
  readonly onCommitRename: (node: DesignNode, nextName: string) => void;
  readonly onCancelRename: () => void;
  readonly onNodeContextMenu?:
    | ((event: ReactMouseEvent<HTMLDivElement>, node: DesignNode) => void)
    | undefined;
  readonly onToggleVisible: (node: DesignNode) => void;
  readonly onToggleLocked: (node: DesignNode) => void;
  readonly onDelete: (id: DesignNodeId) => void;
}) {
  const gt = useGT();
  const node = doc.nodes[nodeId];
  if (node === undefined) return null;

  const isRenaming = renamingId === node.id;
  const isSelected = selectedIdSet.has(node.id);
  const isFrame = node.type === "frame";
  const hasChildren = isFrame && node.childIds.length > 0;
  const isCollapsed = collapsedIds.has(node.id);
  const isHidden = node.visible === false;
  const isLocked = node.locked === true;

  return (
    <>
      <div
        className={cn(
          "group flex h-7 cursor-pointer items-center gap-1 rounded-md pr-1 text-xs select-none",
          isSelected ? "bg-accent text-accent-foreground" : "text-foreground/85 hover:bg-accent/40",
          isHidden && "opacity-45",
        )}
        style={{ paddingLeft: `${depth * 12 + 6}px` }}
        onClick={(event) => onRowClick(event, node.id)}
        onDoubleClick={(event) => {
          event.stopPropagation();
          onStartRename(node.id);
        }}
        onContextMenu={(event) => {
          if (onNodeContextMenu === undefined) return;
          event.preventDefault();
          onNodeContextMenu(event, node);
        }}
      >
        <button
          type="button"
          className={cn(
            "flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground",
            !hasChildren && "invisible",
          )}
          aria-label={isCollapsed ? gt("Expand layer") : gt("Collapse layer")}
          onClick={(event) => {
            event.stopPropagation();
            onToggleCollapse(node.id);
          }}
        >
          {isCollapsed ? (
            <ChevronRightIcon className="size-3" />
          ) : (
            <ChevronDownIcon className="size-3" />
          )}
        </button>

        <NodeTypeIcon type={node.type} />
        {isRenaming ? (
          <LayerRenameInput
            initialName={node.name}
            ariaLabel={gt("Rename layer")}
            onCommit={(nextName) => onCommitRename(node, nextName)}
            onCancel={onCancelRename}
          />
        ) : (
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
        )}

        {!isRenaming ? (
          <div className="hidden items-center gap-0.5 text-muted-foreground group-hover:flex">
            <button
              type="button"
              className="flex size-5 items-center justify-center rounded hover:bg-background/70 hover:text-foreground"
              aria-label={isHidden ? gt("Show layer") : gt("Hide layer")}
              onClick={(event) => {
                event.stopPropagation();
                onToggleVisible(node);
              }}
            >
              {isHidden ? <EyeOffIcon className="size-3" /> : <EyeIcon className="size-3" />}
            </button>
            <button
              type="button"
              className="flex size-5 items-center justify-center rounded hover:bg-background/70 hover:text-foreground"
              aria-label={isLocked ? gt("Unlock layer") : gt("Lock layer")}
              onClick={(event) => {
                event.stopPropagation();
                onToggleLocked(node);
              }}
            >
              {isLocked ? <LockIcon className="size-3" /> : <UnlockIcon className="size-3" />}
            </button>
            <button
              type="button"
              className="flex size-5 items-center justify-center rounded hover:bg-background/70 hover:text-destructive"
              aria-label={gt("Delete layer")}
              onClick={(event) => {
                event.stopPropagation();
                onDelete(node.id);
              }}
            >
              <Trash2Icon className="size-3" />
            </button>
          </div>
        ) : null}
      </div>

      {hasChildren && !isCollapsed
        ? node.childIds.map((childId) => (
            <LayerRow
              key={childId}
              doc={doc}
              nodeId={childId}
              depth={depth + 1}
              selectedIdSet={selectedIdSet}
              renamingId={renamingId}
              collapsedIds={collapsedIds}
              onToggleCollapse={onToggleCollapse}
              onRowClick={onRowClick}
              onStartRename={onStartRename}
              onCommitRename={onCommitRename}
              onCancelRename={onCancelRename}
              onNodeContextMenu={onNodeContextMenu}
              onToggleVisible={onToggleVisible}
              onToggleLocked={onToggleLocked}
              onDelete={onDelete}
            />
          ))
        : null}
    </>
  );
}

export function DesignLayersPanel({
  doc,
  width,
  selectedIds,
  renamingId,
  currentRevision,
  revisions,
  revisionsLoading,
  activeTab,
  onTabChange,
  onSelectIds,
  onStartRename,
  onRename,
  onCancelRename,
  onNodeContextMenu,
  onToggleVisible,
  onToggleLocked,
  onDelete,
  onRestoreRevision,
}: {
  readonly doc: DesignDocument;
  readonly width: number;
  readonly selectedIds: ReadonlyArray<DesignNodeId>;
  readonly renamingId: DesignNodeId | null;
  readonly currentRevision: number;
  readonly revisions: ReadonlyArray<T3ObjectRevisionSummary>;
  readonly revisionsLoading: boolean;
  readonly activeTab: "layers" | "history";
  readonly onTabChange: (tab: "layers" | "history") => void;
  readonly onSelectIds: (ids: ReadonlyArray<DesignNodeId>) => void;
  readonly onStartRename: (id: DesignNodeId) => void;
  readonly onRename: (node: DesignNode, nextName: string) => void;
  readonly onCancelRename: () => void;
  readonly onNodeContextMenu?:
    | ((event: ReactMouseEvent<HTMLDivElement>, node: DesignNode) => void)
    | undefined;
  readonly onToggleVisible: (node: DesignNode) => void;
  readonly onToggleLocked: (node: DesignNode) => void;
  readonly onDelete: (id: DesignNodeId) => void;
  readonly onRestoreRevision: (revision: number) => void;
}) {
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(() => new Set());
  const selectedIdSet = new Set<string>(selectedIds);

  const handleRowClick = (event: ReactMouseEvent<HTMLDivElement>, id: DesignNodeId) => {
    if (event.shiftKey && selectedIds.length > 0) {
      const flat = collectVisibleLayerIds(doc, collapsedIds);
      const anchorId = selectedIds[selectedIds.length - 1]!;
      const startIndex = flat.indexOf(anchorId);
      const endIndex = flat.indexOf(id);
      if (startIndex >= 0 && endIndex >= 0) {
        const [from, to] = startIndex <= endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
        onSelectIds(normalizeSelectedNodeIds(doc, flat.slice(from, to + 1)));
        return;
      }
    }
    if (event.metaKey || event.ctrlKey) {
      const next = selectedIds.includes(id)
        ? selectedIds.filter((item) => item !== id)
        : normalizeSelectedNodeIds(doc, [...selectedIds, id]);
      onSelectIds(next);
      return;
    }
    onSelectIds([id]);
  };

  const toggleCollapse = (id: DesignNodeId) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div
      className="flex h-full shrink-0 flex-col border-r border-border/60 bg-background"
      style={{ width }}
    >
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border/60 px-2">
        <Button
          size="xs"
          variant={activeTab === "layers" ? "secondary" : "ghost"}
          className="flex-1"
          onClick={() => onTabChange("layers")}
        >
          <LayersIcon className="size-3.5" />
          <span>
            <T>Layers</T>
          </span>
        </Button>
        <Button
          size="xs"
          variant={activeTab === "history" ? "secondary" : "ghost"}
          className="flex-1"
          onClick={() => onTabChange("history")}
        >
          <HistoryIcon className="size-3.5" />
          <span>
            <T>History</T>
          </span>
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {activeTab === "layers" ? (
          <div className="flex flex-col gap-0.5 p-1.5">
            {doc.rootIds.length === 0 ? (
              <p className="px-2 py-8 text-center text-xs text-muted-foreground">
                <T>No layers yet</T>
              </p>
            ) : (
              doc.rootIds.map((rootId) => (
                <LayerRow
                  key={rootId}
                  doc={doc}
                  nodeId={rootId}
                  depth={0}
                  selectedIdSet={selectedIdSet}
                  renamingId={renamingId}
                  collapsedIds={collapsedIds}
                  onToggleCollapse={toggleCollapse}
                  onRowClick={handleRowClick}
                  onStartRename={onStartRename}
                  onCommitRename={(node, nextName) => {
                    onRename(node, nextName);
                    onCancelRename();
                  }}
                  onCancelRename={onCancelRename}
                  onNodeContextMenu={onNodeContextMenu}
                  onToggleVisible={onToggleVisible}
                  onToggleLocked={onToggleLocked}
                  onDelete={onDelete}
                />
              ))
            )}
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-border/50">
            {revisionsLoading && revisions.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">
                <T>Loading history...</T>
              </p>
            ) : revisions.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">
                <T>No revisions yet</T>
              </p>
            ) : (
              revisions.map((rev) => {
                const isCurrent = rev.revision === currentRevision;
                return (
                  <div
                    key={rev.revision}
                    className={cn(
                      "group flex flex-col gap-1 px-3 py-2 text-xs",
                      isCurrent && "bg-accent/30",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                        {rev.actor === "agent" ? (
                          <BotIcon className="size-3 text-muted-foreground" />
                        ) : (
                          <UserIcon className="size-3 text-muted-foreground" />
                        )}
                        <span className="tabular-nums">v{rev.revision}</span>
                        <span className="text-2xs font-normal text-muted-foreground">
                          {new Date(rev.createdAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </span>
                      {!isCurrent ? (
                        <span className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                          <Button
                            size="micro"
                            variant="ghost"
                            onClick={() => onRestoreRevision(rev.revision)}
                          >
                            <RotateCcwIcon className="size-3" />
                            <span>
                              <T>Restore</T>
                            </span>
                          </Button>
                        </span>
                      ) : (
                        <span className="text-2xs text-muted-foreground">
                          <T>Current</T>
                        </span>
                      )}
                    </div>
                    <p className="line-clamp-2 text-2xs text-muted-foreground">{rev.summary}</p>
                  </div>
                );
              })
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
