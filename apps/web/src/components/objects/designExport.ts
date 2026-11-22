import type { DesignDocument, DesignNodeId } from "@t3tools/contracts";
import { Leafer, type Group, type IUI, type IUIInputData } from "leafer-ui";

import { normalizeSelectedNodeIds } from "./designEditorTypes";
import { designNodeToLeaferInput } from "./leaferSceneAdapter";

export function slugifyFilename(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "design";
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function triggerFileDownload(content: string, mimeType: string, filename: string): void {
  triggerBlobDownload(new Blob([content], { type: mimeType }), filename);
}

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

export async function exportLeaferNodesToPng(input: {
  readonly doc: DesignDocument;
  readonly contentLayer: Group;
  readonly mountEl: HTMLElement;
  readonly nodeIds: ReadonlyArray<DesignNodeId> | null;
  readonly options?: { readonly transparent?: boolean; readonly scale?: number } | undefined;
}): Promise<Blob | null> {
  const { doc, contentLayer, mountEl, nodeIds, options } = input;
  const isFullCanvas = nodeIds === null;
  const targetIds = isFullCanvas
    ? doc.rootIds.filter((id) => doc.nodes[id]?.visible !== false)
    : normalizeSelectedNodeIds(doc, nodeIds);
  if (targetIds.length === 0) return null;

  const specs: Array<ExportItemSpec> = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const id of targetIds) {
    const node = doc.nodes[id];
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
    const leaferInput = designNodeToLeaferInput(doc, spec.id, false);
    if (leaferInput === null) continue;
    builtItems.push({
      ...leaferInput,
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
    : (doc.background ??
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
}
