import type {
  DesignAutoLayout,
  DesignDocument,
  DesignNode,
  DesignNodeId,
  DesignNodePatch,
} from "@t3tools/contracts";
import { T, useGT, Var } from "gt-react";
import {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  DownloadIcon,
  MessageSquarePlusIcon,
  Unlink2Icon,
  XIcon,
} from "lucide-react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { ScrollArea } from "~/components/ui/scroll-area";
import { normalizePadding } from "./designEditorTypes";

function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  onCommit,
}: {
  readonly label: string;
  readonly value: number;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly onCommit: (next: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-2xs text-muted-foreground">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        defaultValue={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0}
        key={`${label}:${value}`}
        className="h-7 w-full rounded-md border border-border/70 bg-transparent px-2 text-xs tabular-nums text-foreground outline-none transition-colors hover:border-border focus:border-ring"
        onBlur={(event) => {
          const parsed = Number(event.currentTarget.value);
          if (Number.isFinite(parsed) && parsed !== value) {
            onCommit(parsed);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

function ColorField({
  label,
  value,
  placeholder,
  allowClear = true,
  onCommit,
}: {
  readonly label: string;
  readonly value: string | undefined;
  readonly placeholder: string;
  readonly allowClear?: boolean;
  readonly onCommit: (next: string | null) => void;
}) {
  const gt = useGT();
  const isHex = value !== undefined && /^#[0-9a-fA-F]{6}$/.test(value);

  return (
    <div className="flex flex-col gap-1">
      <span className="text-2xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        <input
          type="color"
          aria-label={label}
          value={isHex ? value : "#18181b"}
          className="size-7 shrink-0 cursor-pointer rounded-md border border-border/70 bg-transparent p-0.5"
          onChange={(event) => onCommit(event.target.value)}
        />
        <Input
          size="sm"
          key={`${label}:${value ?? ""}`}
          defaultValue={value ?? ""}
          placeholder={placeholder}
          onBlur={(event) => {
            const trimmed = event.currentTarget.value.trim();
            if (trimmed === (value ?? "")) return;
            onCommit(trimmed.length === 0 ? null : trimmed);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
        {allowClear && value !== undefined ? (
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={gt("Clear color")}
            onClick={() => onCommit(null)}
          >
            <XIcon className="size-3" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export type DesignExportFormat = "png" | "svg" | "html";

function ExportSection({ onExport }: { readonly onExport: (format: DesignExportFormat) => void }) {
  return (
    <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
      <div className="flex items-center gap-1.5 text-2xs text-muted-foreground">
        <DownloadIcon className="size-3" />
        <span>
          <T>Export</T>
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <Button size="xs" variant="outline" onClick={() => onExport("png")}>
          PNG
        </Button>
        <Button size="xs" variant="outline" onClick={() => onExport("svg")}>
          SVG
        </Button>
        <Button size="xs" variant="outline" onClick={() => onExport("html")}>
          HTML
        </Button>
      </div>
    </div>
  );
}

export function DesignInspectorPanel({
  doc,
  width,
  selectedIds,
  onPatchNode,
  onSetBackground,
  onDetachFromParent,
  onExportNodes,
  onAnnotateNodes,
}: {
  readonly doc: DesignDocument;
  readonly width: number;
  readonly selectedIds: ReadonlyArray<DesignNodeId>;
  readonly onPatchNode: (id: DesignNodeId, patch: DesignNodePatch, summary: string) => void;
  readonly onSetBackground: (background: string | null) => void;
  readonly onDetachFromParent: (node: DesignNode) => void;
  readonly onExportNodes?:
    | ((nodeIds: ReadonlyArray<DesignNodeId>, format: DesignExportFormat) => void)
    | undefined;
  readonly onAnnotateNodes?: ((nodeIds: ReadonlyArray<DesignNodeId>) => void) | undefined;
}) {
  const gt = useGT();
  const selectedNodes = selectedIds
    .map((id) => doc.nodes[id])
    .filter((item): item is DesignNode => item !== undefined);

  if (selectedNodes.length === 0) {
    return (
      <div
        className="flex h-full shrink-0 flex-col border-l border-border/60 bg-background"
        style={{ width }}
      >
        <div className="flex h-9 shrink-0 items-center border-b border-border/60 px-3 text-xs font-medium text-foreground">
          <T>Canvas</T>
        </div>
        <div className="flex flex-col gap-3 p-3">
          <ColorField
            label={gt("Background")}
            value={doc.background}
            placeholder={gt("Theme")}
            allowClear
            onCommit={onSetBackground}
          />
          <p className="text-2xs leading-relaxed text-muted-foreground">
            <T>Select a layer to edit its properties.</T>
          </p>
        </div>
      </div>
    );
  }

  if (selectedNodes.length > 1) {
    const validIds = selectedNodes.map((item) => item.id);
    return (
      <div
        className="flex h-full shrink-0 flex-col border-l border-border/60 bg-background"
        style={{ width }}
      >
        <div className="flex h-9 shrink-0 items-center border-b border-border/60 px-3 text-xs font-medium text-foreground">
          <T>
            <Var>{selectedNodes.length}</Var> layers selected
          </T>
        </div>
        <div className="flex flex-col gap-3 p-3">
          <p className="text-2xs leading-relaxed text-muted-foreground">
            <T>Use arrow keys to nudge, copy/paste, duplicate, or export the selection.</T>
          </p>
          {onAnnotateNodes !== undefined ? (
            <Button
              size="xs"
              variant="secondary"
              className="w-full"
              onClick={() => onAnnotateNodes(validIds)}
            >
              <MessageSquarePlusIcon className="size-3.5" />
              <span>
                <T>Annotate for chat</T>
              </span>
            </Button>
          ) : null}
          {onExportNodes !== undefined ? (
            <ExportSection onExport={(format) => onExportNodes(validIds, format)} />
          ) : null}
        </div>
      </div>
    );
  }

  const node = selectedNodes[0]!;

  const parent = node.parentId === null ? undefined : doc.nodes[node.parentId];
  const inAutoLayoutParent = parent?.type === "frame" && parent.layout !== undefined;
  const padding = node.type === "frame" ? normalizePadding(node.layout?.padding) : null;

  const updateLayout = (patch: Partial<DesignAutoLayout>) => {
    if (node.type !== "frame") return;
    const base: DesignAutoLayout = node.layout ?? {
      direction: "vertical",
      gap: 12,
      padding: 16,
      alignItems: "start",
      justifyContent: "start",
    };
    onPatchNode(node.id, { layout: { ...base, ...patch } }, `Updated layout of ${node.name}`);
  };

  return (
    <div
      className="flex h-full shrink-0 flex-col border-l border-border/60 bg-background"
      style={{ width }}
    >
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border/60 px-2.5">
        <Input
          size="sm"
          key={`name:${node.id}:${node.name}`}
          defaultValue={node.name}
          aria-label={gt("Layer name")}
          onBlur={(event) => {
            const nextName = event.currentTarget.value.trim();
            if (nextName.length > 0 && nextName !== node.name) {
              onPatchNode(node.id, { name: nextName }, `Renamed ${node.name} to ${nextName}`);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
        <span className="shrink-0 text-2xs capitalize text-muted-foreground">{node.type}</span>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3.5 p-3">
          {inAutoLayoutParent ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-2 py-1.5">
              <span className="text-2xs text-muted-foreground">
                <T>Auto Layout item</T>
              </span>
              <Button size="micro" variant="ghost" onClick={() => onDetachFromParent(node)}>
                <Unlink2Icon className="size-3" />
                <span>
                  <T>Detach</T>
                </span>
              </Button>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            {!inAutoLayoutParent ? (
              <>
                <NumberField
                  label="X"
                  value={node.x}
                  onCommit={(x) => onPatchNode(node.id, { x }, `Moved ${node.name}`)}
                />
                <NumberField
                  label="Y"
                  value={node.y}
                  onCommit={(y) => onPatchNode(node.id, { y }, `Moved ${node.name}`)}
                />
              </>
            ) : null}
            <NumberField
              label="W"
              value={node.width}
              min={1}
              onCommit={(widthNext) =>
                onPatchNode(node.id, { width: Math.max(1, widthNext) }, `Resized ${node.name}`)
              }
            />
            <NumberField
              label="H"
              value={node.height}
              min={1}
              onCommit={(heightNext) =>
                onPatchNode(node.id, { height: Math.max(1, heightNext) }, `Resized ${node.name}`)
              }
            />
            <NumberField
              label={gt("Radius")}
              value={node.radius ?? 0}
              min={0}
              onCommit={(radius) =>
                onPatchNode(
                  node.id,
                  { radius: Math.max(0, radius) },
                  `Updated radius of ${node.name}`,
                )
              }
            />
            <NumberField
              label={gt("Opacity")}
              value={Math.round((node.opacity ?? 1) * 100)}
              min={0}
              max={100}
              onCommit={(pct) =>
                onPatchNode(
                  node.id,
                  { opacity: Math.min(1, Math.max(0, pct / 100)) },
                  `Updated opacity of ${node.name}`,
                )
              }
            />
          </div>

          <div className="flex flex-col gap-2.5 border-t border-border/60 pt-3">
            {node.type !== "line" ? (
              <ColorField
                label={gt("Fill")}
                value={node.fill}
                placeholder={gt("None")}
                onCommit={(fill) => onPatchNode(node.id, { fill }, `Updated fill of ${node.name}`)}
              />
            ) : null}
            <ColorField
              label={gt("Stroke")}
              value={node.stroke}
              placeholder={gt("None")}
              onCommit={(stroke) =>
                onPatchNode(node.id, { stroke }, `Updated stroke of ${node.name}`)
              }
            />
            {node.stroke !== undefined ? (
              <NumberField
                label={gt("Stroke width")}
                value={node.strokeWidth ?? 1}
                min={0}
                onCommit={(strokeWidth) =>
                  onPatchNode(
                    node.id,
                    { strokeWidth: Math.max(0, strokeWidth) },
                    `Updated stroke of ${node.name}`,
                  )
                }
              />
            ) : null}
          </div>

          {node.type === "frame" ? (
            <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
              <div className="flex items-center justify-between">
                <span className="text-2xs text-muted-foreground">
                  <T>Auto Layout</T>
                </span>
                <div className="flex items-center gap-0.5">
                  <Button
                    size="micro"
                    variant={node.layout === undefined ? "secondary" : "ghost"}
                    onClick={() =>
                      onPatchNode(node.id, { layout: null }, `Disabled Auto Layout on ${node.name}`)
                    }
                  >
                    <T>Off</T>
                  </Button>
                  <Button
                    size="micro"
                    variant={node.layout?.direction === "horizontal" ? "secondary" : "ghost"}
                    onClick={() => updateLayout({ direction: "horizontal" })}
                  >
                    <T>Row</T>
                  </Button>
                  <Button
                    size="micro"
                    variant={node.layout?.direction === "vertical" ? "secondary" : "ghost"}
                    onClick={() => updateLayout({ direction: "vertical" })}
                  >
                    <T>Col</T>
                  </Button>
                </div>
              </div>

              {node.layout !== undefined && padding !== null ? (
                <div className="grid grid-cols-2 gap-2">
                  <NumberField
                    label={gt("Gap")}
                    value={node.layout.gap ?? 0}
                    min={0}
                    onCommit={(gap) => updateLayout({ gap: Math.max(0, gap) })}
                  />
                  <NumberField
                    label={gt("Padding")}
                    value={padding.top}
                    min={0}
                    onCommit={(pad) => updateLayout({ padding: Math.max(0, pad) })}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {node.type === "text" ? (
            <div className="flex flex-col gap-2.5 border-t border-border/60 pt-3">
              <label className="flex flex-col gap-1">
                <span className="text-2xs text-muted-foreground">
                  <T>Text</T>
                </span>
                <textarea
                  key={`text:${node.id}:${node.text}`}
                  defaultValue={node.text}
                  rows={3}
                  className="w-full resize-y rounded-md border border-border/70 bg-transparent p-2 text-xs text-foreground outline-none transition-colors hover:border-border focus:border-ring"
                  onBlur={(event) => {
                    if (event.currentTarget.value !== node.text) {
                      onPatchNode(
                        node.id,
                        { text: event.currentTarget.value },
                        `Edited text in ${node.name}`,
                      );
                    }
                  }}
                />
              </label>

              <ColorField
                label={gt("Text color")}
                value={node.color ?? "#f8fafc"}
                placeholder="#f8fafc"
                allowClear={false}
                onCommit={(color) => {
                  if (color !== null) {
                    onPatchNode(node.id, { color }, `Updated text color of ${node.name}`);
                  }
                }}
              />

              <div className="grid grid-cols-2 gap-2">
                <NumberField
                  label={gt("Size")}
                  value={node.fontSize ?? 16}
                  min={8}
                  max={256}
                  onCommit={(fontSize) =>
                    onPatchNode(
                      node.id,
                      { fontSize: Math.max(8, fontSize) },
                      `Updated font size of ${node.name}`,
                    )
                  }
                />
                <NumberField
                  label={gt("Weight")}
                  value={typeof node.fontWeight === "number" ? node.fontWeight : 400}
                  min={100}
                  max={900}
                  step={100}
                  onCommit={(fontWeight) =>
                    onPatchNode(
                      node.id,
                      { fontWeight: Math.min(900, Math.max(100, fontWeight)) },
                      `Updated font weight of ${node.name}`,
                    )
                  }
                />
              </div>

              <div className="flex items-center justify-between">
                <span className="text-2xs text-muted-foreground">
                  <T>Align</T>
                </span>
                <div className="flex items-center gap-0.5">
                  {(
                    [
                      { id: "left", icon: <AlignLeftIcon className="size-3.5" /> },
                      { id: "center", icon: <AlignCenterIcon className="size-3.5" /> },
                      { id: "right", icon: <AlignRightIcon className="size-3.5" /> },
                    ] as const
                  ).map((item) => (
                    <Button
                      key={item.id}
                      size="icon-xs"
                      variant={(node.textAlign ?? "left") === item.id ? "secondary" : "ghost"}
                      aria-label={item.id}
                      onClick={() =>
                        onPatchNode(
                          node.id,
                          { textAlign: item.id },
                          `Updated alignment of ${node.name}`,
                        )
                      }
                    >
                      {item.icon}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {onExportNodes !== undefined ? (
            <ExportSection onExport={(format) => onExportNodes([node.id], format)} />
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}
