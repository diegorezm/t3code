import type {
  DesignAutoLayout,
  DesignDocument,
  DesignNode,
  DesignNodeId,
  DesignNodePatch,
  DesignShadow,
} from "@t3tools/contracts";
import { sanitizeDesignSvg } from "@t3tools/shared/designRender";
import type {
  IAlign,
  IFill,
  IFontWeight,
  ILineInputData,
  IShadowEffect,
  IUI,
  IUIInputData,
} from "leafer-ui";

import { normalizePadding } from "./designEditorTypes";

export function parseCssLinearGradient(css: string): IFill {
  const trimmed = css.trim();
  const match = /^linear-gradient\((.*)\)$/i.exec(trimmed);
  if (match === null) return trimmed;

  const inner = match[1] ?? "";
  // Split top-level commas (ignoring commas inside rgb()/rgba()/hsl()).
  const parts: Array<string> = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === "," && depth === 0) {
      parts.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(inner.slice(start).trim());

  let angleDeg = 180;
  let stopStartIndex = 0;
  const first = parts[0] ?? "";
  const degMatch = /^(-?\d+(?:\.\d+)?)deg$/i.exec(first);
  if (degMatch !== null) {
    angleDeg = Number(degMatch[1]);
    stopStartIndex = 1;
  } else if (/^to\s+/i.test(first)) {
    const dir = first.toLowerCase();
    if (dir.includes("right") && dir.includes("bottom")) angleDeg = 135;
    else if (dir.includes("right") && dir.includes("top")) angleDeg = 45;
    else if (dir.includes("left") && dir.includes("bottom")) angleDeg = 225;
    else if (dir.includes("left") && dir.includes("top")) angleDeg = 315;
    else if (dir.includes("right")) angleDeg = 90;
    else if (dir.includes("left")) angleDeg = 270;
    else if (dir.includes("top")) angleDeg = 0;
    else angleDeg = 180;
    stopStartIndex = 1;
  }

  const rawStops = parts.slice(stopStartIndex).filter((s) => s.length > 0);
  if (rawStops.length < 2) {
    return rawStops[0] ?? "#18181b";
  }

  const stops = rawStops.map((raw, index) => {
    const pctMatch = /\s+(\d+(?:\.\d+)?)%$/.exec(raw);
    const color = pctMatch !== null ? raw.slice(0, pctMatch.index).trim() : raw;
    const offset =
      pctMatch !== null
        ? Math.min(1, Math.max(0, Number(pctMatch[1]) / 100))
        : index / Math.max(1, rawStops.length - 1);
    return { offset, color };
  });

  // CSS 0deg points upward (bottom -> top), 90deg points right (left -> right).
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  const dx = Math.cos(rad) * 0.5;
  const dy = Math.sin(rad) * 0.5;

  return {
    type: "linear",
    from: { type: "percent", x: 0.5 - dx, y: 0.5 - dy },
    to: { type: "percent", x: 0.5 + dx, y: 0.5 + dy },
    stops,
  };
}

function mapFill(fill: string | undefined): IFill | undefined {
  if (fill === undefined || fill.length === 0) return undefined;
  if (fill.includes("linear-gradient(")) {
    return parseCssLinearGradient(fill);
  }
  return fill;
}

function mapShadow(shadow: DesignShadow): IShadowEffect {
  return {
    x: shadow.x,
    y: shadow.y,
    blur: shadow.blur,
    spread: shadow.spread ?? 0,
    color: shadow.color,
  };
}

export function mapFlowAlign(layout: DesignAutoLayout): IAlign {
  const isHorizontal = layout.direction === "horizontal";
  const main = layout.justifyContent ?? "start";
  const cross = layout.alignItems ?? "start";

  const xAlign: "left" | "center" | "right" = isHorizontal
    ? main === "center"
      ? "center"
      : main === "end"
        ? "right"
        : "left"
    : cross === "center"
      ? "center"
      : cross === "end"
        ? "right"
        : "left";

  const yAlign: "top" | "center" | "bottom" = isHorizontal
    ? cross === "center"
      ? "center"
      : cross === "end"
        ? "bottom"
        : "top"
    : main === "center"
      ? "center"
      : main === "end"
        ? "bottom"
        : "top";

  if (xAlign === "center" && yAlign === "center") return "center";
  if (yAlign === "top") {
    return xAlign === "center" ? "top" : xAlign === "right" ? "top-right" : "top-left";
  }
  if (yAlign === "bottom") {
    return xAlign === "center" ? "bottom" : xAlign === "right" ? "bottom-right" : "bottom-left";
  }
  return xAlign === "right" ? "right" : "left";
}

function mapFontWeight(weight: number | string | undefined): IFontWeight {
  if (weight === "bold") return 700;
  if (weight === "semibold") return 600;
  if (weight === "medium") return 500;
  const numeric = typeof weight === "number" ? weight : Number(weight);
  if (!Number.isFinite(numeric) || numeric <= 0) return 400;
  const bucket = Math.min(900, Math.max(100, Math.round(numeric / 100) * 100));
  return bucket as IFontWeight;
}

function designNodeToLeaferInput(
  doc: DesignDocument,
  nodeId: DesignNodeId,
  inAutoLayoutParent: boolean,
): IUIInputData | null {
  const node = doc.nodes[nodeId];
  if (node === undefined) return null;

  const base: IUIInputData = {
    id: node.id,
    name: node.name,
    editable: true,
    locked: node.locked === true,
    visible: node.visible !== false,
    opacity: node.opacity ?? 1,
    ...(node.rotation ? { rotation: node.rotation } : {}),
    ...(node.shadow ? { shadow: mapShadow(node.shadow) } : {}),
  };

  if (inAutoLayoutParent) {
    if (node.widthMode === "fill") {
      base.autoWidth = 1;
    } else if (node.widthMode !== "hug") {
      base.width = node.width;
    }
    if (node.heightMode === "fill") {
      base.autoHeight = 1;
    } else if (node.heightMode !== "hug") {
      base.height = node.height;
    }
  } else {
    base.x = node.x;
    base.y = node.y;
    base.width = node.width;
    base.height = node.height;
  }

  if (node.type !== "line") {
    const mappedFill = mapFill(node.fill);
    if (mappedFill !== undefined) {
      base.fill = mappedFill;
    }
    if (node.stroke !== undefined) {
      base.stroke = node.stroke;
      base.strokeWidth = node.strokeWidth ?? 1;
      base.strokeAlign = "inside";
    }
    if (node.radius !== undefined && node.radius > 0) {
      base.cornerRadius = node.radius;
    }
  }

  switch (node.type) {
    case "frame": {
      const hasFlow = node.layout !== undefined;
      const children = node.childIds
        .map((childId) => designNodeToLeaferInput(doc, childId, hasFlow))
        .filter((child): child is IUIInputData => child !== null);

      const frameInput: IUIInputData = {
        ...base,
        tag: "Box",
        overflow: node.clip === false ? "show" : "hide",
        hitChildren: true,
        children,
      };

      if (node.layout !== undefined) {
        const pad = normalizePadding(node.layout.padding);
        frameInput.flow = node.layout.direction === "horizontal" ? "x" : "y";
        frameInput.gap =
          node.layout.justifyContent === "space-between"
            ? "auto"
            : node.layout.justifyContent === "space-around"
              ? "fit"
              : (node.layout.gap ?? 0);
        frameInput.padding = [pad.top, pad.right, pad.bottom, pad.left];
        frameInput.flowWrap = node.layout.wrap === true;
        frameInput.flowAlign = mapFlowAlign(node.layout);
      }

      return frameInput;
    }

    case "rect":
      return {
        ...base,
        tag: "Rect",
      };

    case "ellipse":
      return {
        ...base,
        tag: "Ellipse",
      };

    case "text": {
      const fontSize = node.fontSize ?? 16;
      const lineHeight = node.lineHeight ?? 1.4;
      return {
        ...base,
        tag: "Text",
        text: node.text,
        fill: node.color ?? "#f8fafc",
        fontSize,
        fontWeight: mapFontWeight(node.fontWeight),
        fontFamily:
          node.fontFamily ??
          'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        textAlign: node.textAlign ?? "left",
        lineHeight: { type: "percent", value: lineHeight },
        ...(node.letterSpacing !== undefined ? { letterSpacing: node.letterSpacing } : {}),
        textWrap: "normal",
      };
    }

    case "line": {
      const lineInput: ILineInputData = {
        ...base,
        tag: "Line",
        points: [0, node.height / 2, node.width, node.height / 2],
        stroke: node.stroke ?? node.fill ?? "#94a3b8",
        strokeWidth: node.strokeWidth ?? 2,
      };
      if (node.strokeDasharray !== undefined) {
        const dash = node.strokeDasharray
          .split(/[\s,]+/)
          .map(Number)
          .filter((n) => Number.isFinite(n) && n >= 0);
        if (dash.length > 0) {
          lineInput.dashPattern = dash;
        }
      }
      return lineInput;
    }

    case "svg": {
      const safeSvg = sanitizeDesignSvg(node.svg);
      const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(safeSvg)}`;
      return {
        ...base,
        tag: "Image",
        url: dataUrl,
      };
    }

    case "image":
      return {
        ...base,
        tag: "Image",
        url: node.src,
        fill: {
          type: "image",
          url: node.src,
          mode:
            node.objectFit === "contain" ? "fit" : node.objectFit === "fill" ? "stretch" : "cover",
        },
      };
  }
}

const FRAME_LABEL_NAME_PREFIX = "label:";
export const FRAME_LABEL_OFFSET_Y = 20;

export function getFrameLabelName(nodeId: DesignNodeId): string {
  return `${FRAME_LABEL_NAME_PREFIX}${nodeId}`;
}

export function parseFrameLabelNodeId(name: unknown): DesignNodeId | null {
  if (typeof name !== "string" || !name.startsWith(FRAME_LABEL_NAME_PREFIX)) {
    return null;
  }
  const rawId = name.slice(FRAME_LABEL_NAME_PREFIX.length);
  return rawId.length > 0 ? (rawId as DesignNodeId) : null;
}

export function extractTransformTargets(
  editorList: ReadonlyArray<IUI>,
  eventTarget?: unknown,
  eventList?: ReadonlyArray<IUI>,
): ReadonlyArray<IUI> {
  if (editorList.length > 0) return editorList;
  if (eventList !== undefined && eventList.length > 0) return eventList;
  if (eventTarget !== undefined && eventTarget !== null) {
    return [eventTarget as IUI];
  }
  return [];
}

export function designDocumentToLeaferTree(doc: DesignDocument): ReadonlyArray<IUIInputData> {
  const items: Array<IUIInputData> = [];
  for (const rootId of doc.rootIds) {
    const node = doc.nodes[rootId];
    if (node === undefined) continue;
    if (node.type === "frame" && node.visible !== false) {
      items.push({
        tag: "Text",
        name: getFrameLabelName(node.id),
        text: node.name,
        x: node.x,
        y: node.y - FRAME_LABEL_OFFSET_Y,
        fontSize: 11,
        fontWeight: 500,
        fill: "#71717a",
        editable: false,
        hittable: true,
        cursor: "pointer",
      });
    }
    const built = designNodeToLeaferInput(doc, rootId, false);
    if (built !== null) {
      items.push(built);
    }
  }
  return items;
}

export function readLeaferNodePatch(
  target: IUI,
  original: DesignNode,
  inAutoLayoutParent: boolean,
): DesignNodePatch | null {
  const nextX = Math.round(target.x ?? original.x);
  const nextY = Math.round(target.y ?? original.y);
  const nextW = Math.max(
    1,
    Math.round((target.width ?? original.width) * Math.abs(target.scaleX ?? 1)),
  );
  const nextH = Math.max(
    1,
    Math.round((target.height ?? original.height) * Math.abs(target.scaleY ?? 1)),
  );
  const nextRotation = Math.round(target.rotation ?? 0);

  const patch: Record<string, unknown> = {};
  if (!inAutoLayoutParent) {
    if (nextX !== Math.round(original.x)) patch.x = nextX;
    if (nextY !== Math.round(original.y)) patch.y = nextY;
  }
  if (nextW !== Math.round(original.width)) patch.width = nextW;
  if (nextH !== Math.round(original.height)) patch.height = nextH;
  if (nextRotation !== Math.round(original.rotation ?? 0)) patch.rotation = nextRotation;

  return Object.keys(patch).length > 0 ? (patch as DesignNodePatch) : null;
}
