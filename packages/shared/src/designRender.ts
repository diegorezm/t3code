import type {
  DesignAutoLayout,
  DesignDocument,
  DesignNode,
  DesignNodeId,
  DesignPadding,
  DesignShadow,
} from "@t3tools/contracts";

export interface DesignRenderOptions {
  readonly frameId?: DesignNodeId | undefined;
  readonly padding?: number | undefined;
  readonly maxWidth?: number | undefined;
}

export interface DesignRenderResult {
  readonly html: string;
  readonly width: number;
  readonly height: number;
  readonly frameId: string | null;
}

export interface DesignSvgExportResult {
  readonly svg: string;
  readonly width: number;
  readonly height: number;
}

export interface DesignInspectNode {
  readonly id: string;
  readonly type: DesignNode["type"];
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly visible?: boolean;
  readonly locked?: boolean;
  readonly layout?: DesignAutoLayout["direction"];
  readonly text?: string;
  readonly childCount?: number;
  readonly children?: ReadonlyArray<DesignInspectNode>;
}

const DEFAULT_CANVAS_BG = "#0f1117";
const DEFAULT_EMPTY_WIDTH = 800;
const DEFAULT_EMPTY_HEIGHT = 500;
const MAX_RENDER_WIDTH = 1600;
const MIN_RENDER_WIDTH = 240;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sanitizeCssValue(value: string): string {
  // Strip characters that could break out of an inline CSS declaration or inject expressions.
  return value.replace(/[;<>{}]/g, "").replace(/url\s*\(\s*['"]?\s*javascript:/gi, "");
}

function sanitizeImageSrc(src: string): string | null {
  const trimmed = src.trim();
  if (
    /^(?:https?:\/\/|\/api\/assets\/|data:image\/(?:png|jpeg|jpg|webp|gif);base64,)/i.test(trimmed)
  ) {
    return trimmed;
  }
  return null;
}

export function sanitizeDesignSvg(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");
}

export function formatDesignPadding(padding: DesignPadding | undefined): string | null {
  if (padding === undefined) return null;
  if (typeof padding === "number") {
    return `${padding}px`;
  }
  return `${padding.top}px ${padding.right}px ${padding.bottom}px ${padding.left}px`;
}

export function formatDesignShadow(shadow: DesignShadow | undefined): string | null {
  if (shadow === undefined) return null;
  const spread = shadow.spread ?? 0;
  return `${shadow.x}px ${shadow.y}px ${shadow.blur}px ${spread}px ${sanitizeCssValue(shadow.color)}`;
}

function flexAlign(value: DesignAutoLayout["alignItems"]): string {
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

function flexJustify(value: DesignAutoLayout["justifyContent"]): string {
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

function renderNodeHtml(
  doc: DesignDocument,
  node: DesignNode,
  inAutoLayoutParent: boolean,
  offsetX = 0,
  offsetY = 0,
): string {
  if (node.visible === false) return "";

  const styles: Array<string> = ["box-sizing:border-box"];

  if (inAutoLayoutParent) {
    styles.push("position:relative", "flex-shrink:0");
    if (node.widthMode === "fill") {
      styles.push("width:100%", "flex:1 1 auto", "min-width:0");
    } else if (node.widthMode === "hug") {
      styles.push("width:fit-content");
    } else {
      styles.push(`width:${node.width}px`);
    }
    if (node.heightMode === "fill") {
      styles.push("height:100%", "align-self:stretch");
    } else if (node.heightMode === "hug") {
      styles.push("height:fit-content");
    } else {
      styles.push(`height:${node.height}px`);
    }
  } else {
    styles.push(
      "position:absolute",
      `left:${node.x - offsetX}px`,
      `top:${node.y - offsetY}px`,
      `width:${node.width}px`,
      `height:${node.height}px`,
    );
  }

  if (node.opacity !== undefined && node.opacity !== 1) {
    styles.push(`opacity:${node.opacity}`);
  }
  if (node.rotation !== undefined && node.rotation !== 0) {
    styles.push(`transform:rotate(${node.rotation}deg)`);
  }
  if (node.fill !== undefined && node.type !== "line") {
    const safeFill = sanitizeCssValue(node.fill);
    styles.push(
      safeFill.includes("gradient(") ? `background:${safeFill}` : `background-color:${safeFill}`,
    );
  }
  if (node.stroke !== undefined && node.type !== "line") {
    const strokeWidth = node.strokeWidth ?? 1;
    styles.push(`border:${strokeWidth}px solid ${sanitizeCssValue(node.stroke)}`);
  }
  if (node.type === "ellipse") {
    styles.push("border-radius:9999px");
  } else if (node.radius !== undefined && node.radius > 0) {
    styles.push(`border-radius:${node.radius}px`);
  }
  const shadow = formatDesignShadow(node.shadow);
  if (shadow !== null) {
    styles.push(`box-shadow:${shadow}`);
  }

  switch (node.type) {
    case "frame": {
      if (node.clip !== false) {
        styles.push("overflow:hidden");
      }
      const isAutoLayout = node.layout !== undefined;
      if (node.layout !== undefined) {
        styles.push(
          "display:flex",
          `flex-direction:${node.layout.direction === "horizontal" ? "row" : "column"}`,
          `align-items:${flexAlign(node.layout.alignItems)}`,
          `justify-content:${flexJustify(node.layout.justifyContent)}`,
        );
        if (node.layout.gap !== undefined) {
          styles.push(`gap:${node.layout.gap}px`);
        }
        const padding = formatDesignPadding(node.layout.padding);
        if (padding !== null) {
          styles.push(`padding:${padding}`);
        }
        if (node.layout.wrap) {
          styles.push("flex-wrap:wrap");
        }
      }
      const childrenHtml = node.childIds
        .map((childId) => {
          const child = doc.nodes[childId];
          return child === undefined ? "" : renderNodeHtml(doc, child, isAutoLayout);
        })
        .join("");
      return `<div data-node-id="${escapeHtml(node.id)}" style="${styles.join(";")}">${childrenHtml}</div>`;
    }
    case "rect":
    case "ellipse":
      return `<div data-node-id="${escapeHtml(node.id)}" style="${styles.join(";")}"></div>`;
    case "text": {
      const color = sanitizeCssValue(node.color ?? "#f8fafc");
      const fontSize = node.fontSize ?? 16;
      const fontWeight = node.fontWeight ?? 400;
      const lineHeight = node.lineHeight ?? 1.4;
      const textAlign = node.textAlign ?? "left";
      styles.push(
        `color:${color}`,
        `font-size:${fontSize}px`,
        `font-weight:${fontWeight}`,
        `line-height:${lineHeight}`,
        `text-align:${textAlign}`,
        "white-space:pre-wrap",
        "word-break:break-word",
      );
      if (node.fontFamily !== undefined) {
        styles.push(`font-family:${sanitizeCssValue(node.fontFamily)}`);
      }
      if (node.letterSpacing !== undefined) {
        styles.push(`letter-spacing:${node.letterSpacing}px`);
      }
      return `<div data-node-id="${escapeHtml(node.id)}" style="${styles.join(";")}">${escapeHtml(node.text)}</div>`;
    }
    case "line": {
      const stroke = sanitizeCssValue(node.stroke ?? node.fill ?? "#94a3b8");
      const strokeWidth = node.strokeWidth ?? Math.max(1, Math.min(node.height, 8));
      const dash =
        node.strokeDasharray !== undefined
          ? ` stroke-dasharray="${escapeHtml(node.strokeDasharray)}"`
          : "";
      return `<div data-node-id="${escapeHtml(node.id)}" style="${styles.join(";")}"><svg width="100%" height="100%" viewBox="0 0 ${Math.max(1, node.width)} ${Math.max(1, node.height)}" preserveAspectRatio="none"><line x1="0" y1="${node.height / 2}" x2="${node.width}" y2="${node.height / 2}" stroke="${escapeHtml(stroke)}" stroke-width="${strokeWidth}"${dash} /></svg></div>`;
    }
    case "svg": {
      styles.push("display:flex", "align-items:center", "justify-content:center");
      return `<div data-node-id="${escapeHtml(node.id)}" style="${styles.join(";")}">${sanitizeDesignSvg(node.svg)}</div>`;
    }
    case "image": {
      const safeSrc = sanitizeImageSrc(node.src);
      const fit = node.objectFit ?? "cover";
      styles.push("overflow:hidden");
      const img =
        safeSrc === null
          ? ""
          : `<img src="${escapeHtml(safeSrc)}" alt="${escapeHtml(node.name)}" style="width:100%;height:100%;object-fit:${fit};display:block" />`;
      return `<div data-node-id="${escapeHtml(node.id)}" style="${styles.join(";")}">${img}</div>`;
    }
  }
}

export function renderDesignToHtml(
  doc: DesignDocument,
  options: DesignRenderOptions = {},
): DesignRenderResult {
  const padding = options.padding ?? 24;
  const background = sanitizeCssValue(doc.background ?? DEFAULT_CANVAS_BG);

  if (options.frameId !== undefined) {
    const target = doc.nodes[options.frameId];
    if (target !== undefined) {
      const rawWidth = Math.max(1, Math.round(target.width));
      const rawHeight = Math.max(1, Math.round(target.height));
      const maxWidth = Math.min(
        MAX_RENDER_WIDTH,
        Math.max(MIN_RENDER_WIDTH, options.maxWidth ?? MAX_RENDER_WIDTH),
      );
      const scale = rawWidth > maxWidth ? maxWidth / rawWidth : 1;
      const width = Math.max(MIN_RENDER_WIDTH, Math.round(rawWidth * scale));
      const height = Math.max(80, Math.round(rawHeight * scale));
      const nodeHtml = renderNodeHtml(doc, target, false, target.x, target.y);
      const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  html, body { margin: 0; padding: 0; background: ${background}; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  .stage { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; background: ${background}; }
  .scaler { position: absolute; left: 0; top: 0; width: ${rawWidth}px; height: ${rawHeight}px; transform-origin: top left; transform: scale(${scale}); }
</style>
</head>
<body>
  <div class="stage"><div class="scaler">${nodeHtml}</div></div>
</body>
</html>`;
      return { html, width, height, frameId: target.id };
    }
  }

  const visibleRoots = doc.rootIds
    .map((id) => doc.nodes[id])
    .filter((node): node is DesignNode => node !== undefined && node.visible !== false);

  if (visibleRoots.length === 0) {
    const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  html, body { margin: 0; padding: 0; background: ${background}; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  .empty { width: ${DEFAULT_EMPTY_WIDTH}px; height: ${DEFAULT_EMPTY_HEIGHT}px; display: flex; align-items: center; justify-content: center; color: #64748b; font-size: 14px; }
</style>
</head>
<body><div class="empty">Empty design canvas</div></body>
</html>`;
    return { html, width: DEFAULT_EMPTY_WIDTH, height: DEFAULT_EMPTY_HEIGHT, frameId: null };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const root of visibleRoots) {
    minX = Math.min(minX, root.x);
    minY = Math.min(minY, root.y);
    maxX = Math.max(maxX, root.x + root.width);
    maxY = Math.max(maxY, root.y + root.height);
  }

  const rawWidth = Math.max(1, Math.round(maxX - minX + padding * 2));
  const rawHeight = Math.max(1, Math.round(maxY - minY + padding * 2));
  const maxWidth = Math.min(
    MAX_RENDER_WIDTH,
    Math.max(MIN_RENDER_WIDTH, options.maxWidth ?? MAX_RENDER_WIDTH),
  );
  const scale = rawWidth > maxWidth ? maxWidth / rawWidth : 1;
  const width = Math.max(MIN_RENDER_WIDTH, Math.round(rawWidth * scale));
  const height = Math.max(80, Math.round(rawHeight * scale));

  const rootsHtml = visibleRoots
    .map((root) => renderNodeHtml(doc, root, false, minX - padding, minY - padding))
    .join("");

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  html, body { margin: 0; padding: 0; background: ${background}; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  .stage { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; background: ${background}; }
  .scaler { position: absolute; left: 0; top: 0; width: ${rawWidth}px; height: ${rawHeight}px; transform-origin: top left; transform: scale(${scale}); }
</style>
</head>
<body>
  <div class="stage"><div class="scaler">${rootsHtml}</div></div>
</body>
</html>`;

  return { html, width, height, frameId: null };
}

export function inspectDesignDocument(
  doc: DesignDocument,
  options: {
    readonly frameId?: DesignNodeId | undefined;
    readonly maxDepth?: number | undefined;
  } = {},
): ReadonlyArray<DesignInspectNode> {
  const maxDepth = options.maxDepth ?? 8;

  const build = (id: string, depth: number): DesignInspectNode | null => {
    const node = doc.nodes[id];
    if (node === undefined) return null;
    const base: DesignInspectNode = {
      id: node.id,
      type: node.type,
      name: node.name,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      ...(node.visible === false ? { visible: false } : {}),
      ...(node.locked === true ? { locked: true } : {}),
      ...(node.type === "frame" && node.layout !== undefined
        ? { layout: node.layout.direction }
        : {}),
      ...(node.type === "text"
        ? { text: node.text.length > 80 ? `${node.text.slice(0, 77)}...` : node.text }
        : {}),
    };
    if (node.type === "frame") {
      if (depth >= maxDepth) {
        return { ...base, childCount: node.childIds.length };
      }
      const children = node.childIds
        .map((childId) => build(childId, depth + 1))
        .filter((child): child is DesignInspectNode => child !== null);
      return { ...base, childCount: node.childIds.length, children };
    }
    return base;
  };

  if (options.frameId !== undefined) {
    const single = build(options.frameId, 0);
    return single === null ? [] : [single];
  }
  return doc.rootIds
    .map((rootId) => build(rootId, 0))
    .filter((node): node is DesignInspectNode => node !== null);
}

function normalizeBoxPadding(padding: DesignPadding | undefined): {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
} {
  if (padding === undefined) return { top: 0, right: 0, bottom: 0, left: 0 };
  if (typeof padding === "number") {
    return { top: padding, right: padding, bottom: padding, left: padding };
  }
  return padding;
}

function extractSolidColor(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.includes("gradient(")) return null;
  return sanitizeCssValue(trimmed);
}

function renderNodeSvg(
  doc: DesignDocument,
  node: DesignNode,
  x: number,
  y: number,
  width: number,
  height: number,
  defs: Array<string>,
): string {
  if (node.visible === false) return "";
  const safeId = escapeHtml(node.name || node.id);
  const opacityAttr =
    node.opacity !== undefined && node.opacity !== 1 ? ` opacity="${node.opacity}"` : "";
  const rotateAttr =
    node.rotation !== undefined && node.rotation !== 0
      ? ` transform="rotate(${node.rotation} ${x + width / 2} ${y + height / 2})"`
      : "";
  const fillColor = extractSolidColor(node.fill);
  const strokeColor = extractSolidColor(node.stroke);
  const strokeWidth = node.strokeWidth ?? 1;
  const strokeAttrs =
    strokeColor !== null
      ? ` stroke="${escapeHtml(strokeColor)}" stroke-width="${strokeWidth}"`
      : "";

  switch (node.type) {
    case "frame": {
      const rx = node.radius !== undefined && node.radius > 0 ? ` rx="${node.radius}"` : "";
      const bgRect =
        fillColor !== null || strokeColor !== null
          ? `<rect x="${x}" y="${y}" width="${width}" height="${height}"${rx} fill="${fillColor !== null ? escapeHtml(fillColor) : "none"}"${strokeAttrs} />`
          : "";

      let clipAttr = "";
      if (node.clip !== false && node.childIds.length > 0) {
        const clipId = `clip-${defs.length + 1}`;
        defs.push(
          `<clipPath id="${clipId}"><rect x="${x}" y="${y}" width="${width}" height="${height}"${rx} /></clipPath>`,
        );
        clipAttr = ` clip-path="url(#${clipId})"`;
      }

      const childrenSvg: Array<string> = [];
      if (node.layout !== undefined) {
        const pad = normalizeBoxPadding(node.layout.padding);
        const gap = node.layout.gap ?? 0;
        const innerW = Math.max(0, width - pad.left - pad.right);
        const innerH = Math.max(0, height - pad.top - pad.bottom);
        const isRow = node.layout.direction === "horizontal";
        let cursor = isRow ? x + pad.left : y + pad.top;

        const visibleChildren = node.childIds
          .map((id) => doc.nodes[id])
          .filter((child): child is DesignNode => child !== undefined && child.visible !== false);

        const fillCount = visibleChildren.filter((child) =>
          isRow ? child.widthMode === "fill" : child.heightMode === "fill",
        ).length;
        const fixedTotal = visibleChildren.reduce((acc, child) => {
          const isFill = isRow ? child.widthMode === "fill" : child.heightMode === "fill";
          return acc + (isFill ? 0 : isRow ? child.width : child.height);
        }, 0);
        const totalGap = Math.max(0, visibleChildren.length - 1) * gap;
        const remaining = Math.max(0, (isRow ? innerW : innerH) - fixedTotal - totalGap);
        const fillSize = fillCount > 0 ? remaining / fillCount : 0;

        for (const child of visibleChildren) {
          const childW = isRow
            ? child.widthMode === "fill"
              ? fillSize
              : child.width
            : child.widthMode === "fill" || node.layout.alignItems === "stretch"
              ? innerW
              : child.width;
          const childH = !isRow
            ? child.heightMode === "fill"
              ? fillSize
              : child.height
            : child.heightMode === "fill" || node.layout.alignItems === "stretch"
              ? innerH
              : child.height;

          let childX = isRow ? cursor : x + pad.left;
          let childY = isRow ? y + pad.top : cursor;

          if (!isRow) {
            if (node.layout.alignItems === "center") childX = x + pad.left + (innerW - childW) / 2;
            else if (node.layout.alignItems === "end") childX = x + width - pad.right - childW;
          } else {
            if (node.layout.alignItems === "center") childY = y + pad.top + (innerH - childH) / 2;
            else if (node.layout.alignItems === "end") childY = y + height - pad.bottom - childH;
          }

          childrenSvg.push(renderNodeSvg(doc, child, childX, childY, childW, childH, defs));
          cursor += (isRow ? childW : childH) + gap;
        }
      } else {
        for (const childId of node.childIds) {
          const child = doc.nodes[childId];
          if (child === undefined) continue;
          childrenSvg.push(
            renderNodeSvg(doc, child, x + child.x, y + child.y, child.width, child.height, defs),
          );
        }
      }

      return `<g id="${safeId}"${opacityAttr}${rotateAttr}>${bgRect}${childrenSvg.length > 0 ? `<g${clipAttr}>${childrenSvg.join("")}</g>` : ""}</g>`;
    }
    case "rect": {
      const rx = node.radius !== undefined && node.radius > 0 ? ` rx="${node.radius}"` : "";
      return `<rect id="${safeId}" x="${x}" y="${y}" width="${width}" height="${height}"${rx} fill="${fillColor !== null ? escapeHtml(fillColor) : "none"}"${strokeAttrs}${opacityAttr}${rotateAttr} />`;
    }
    case "ellipse": {
      return `<ellipse id="${safeId}" cx="${x + width / 2}" cy="${y + height / 2}" rx="${width / 2}" ry="${height / 2}" fill="${fillColor !== null ? escapeHtml(fillColor) : "none"}"${strokeAttrs}${opacityAttr}${rotateAttr} />`;
    }
    case "text": {
      const color = extractSolidColor(node.color) ?? "#f8fafc";
      const fontSize = node.fontSize ?? 16;
      const fontWeight = node.fontWeight ?? 400;
      const lineHeightPx = fontSize * (node.lineHeight ?? 1.4);
      const fontFamily = escapeHtml(
        node.fontFamily ?? 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      );
      const anchor =
        node.textAlign === "center" ? "middle" : node.textAlign === "right" ? "end" : "start";
      const textX =
        node.textAlign === "center" ? x + width / 2 : node.textAlign === "right" ? x + width : x;
      const lines = node.text.split("\n");
      const tspans = lines
        .map(
          (line, idx) =>
            `<tspan x="${textX}" dy="${idx === 0 ? fontSize : lineHeightPx}">${escapeHtml(line)}</tspan>`,
        )
        .join("");
      return `<text id="${safeId}" x="${textX}" y="${y}" fill="${escapeHtml(color)}" font-family="${fontFamily}" font-size="${fontSize}" font-weight="${fontWeight}" text-anchor="${anchor}"${opacityAttr}${rotateAttr}>${tspans}</text>`;
    }
    case "line": {
      const stroke = extractSolidColor(node.stroke ?? node.fill) ?? "#94a3b8";
      const dash =
        node.strokeDasharray !== undefined
          ? ` stroke-dasharray="${escapeHtml(node.strokeDasharray)}"`
          : "";
      return `<line id="${safeId}" x1="${x}" y1="${y + height / 2}" x2="${x + width}" y2="${y + height / 2}" stroke="${escapeHtml(stroke)}" stroke-width="${strokeWidth}"${dash}${opacityAttr}${rotateAttr} />`;
    }
    case "svg": {
      return `<g id="${safeId}" transform="translate(${x}, ${y})"${opacityAttr}>${sanitizeDesignSvg(node.svg)}</g>`;
    }
    case "image": {
      const safeSrc = sanitizeImageSrc(node.src);
      if (safeSrc === null) return "";
      return `<image id="${safeId}" x="${x}" y="${y}" width="${width}" height="${height}" href="${escapeHtml(safeSrc)}" preserveAspectRatio="${node.objectFit === "contain" ? "xMidYMid meet" : "xMidYMid slice"}"${opacityAttr}${rotateAttr} />`;
    }
  }
}

export function renderDesignToSvg(
  doc: DesignDocument,
  options: {
    readonly frameId?: DesignNodeId | undefined;
    readonly padding?: number | undefined;
  } = {},
): DesignSvgExportResult {
  const padding = options.padding ?? 24;
  const background = extractSolidColor(doc.background) ?? DEFAULT_CANVAS_BG;
  const defs: Array<string> = [];

  if (options.frameId !== undefined) {
    const target = doc.nodes[options.frameId];
    if (target !== undefined) {
      const width = Math.max(1, Math.round(target.width));
      const height = Math.max(1, Math.round(target.height));
      const body = renderNodeSvg(doc, target, 0, 0, target.width, target.height, defs);
      const defsBlock = defs.length > 0 ? `<defs>${defs.join("")}</defs>` : "";
      const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${defsBlock}<rect width="${width}" height="${height}" fill="${escapeHtml(background)}" />${body}</svg>`;
      return { svg, width, height };
    }
  }

  const visibleRoots = doc.rootIds
    .map((id) => doc.nodes[id])
    .filter((node): node is DesignNode => node !== undefined && node.visible !== false);

  if (visibleRoots.length === 0) {
    const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${DEFAULT_EMPTY_WIDTH}" height="${DEFAULT_EMPTY_HEIGHT}" viewBox="0 0 ${DEFAULT_EMPTY_WIDTH} ${DEFAULT_EMPTY_HEIGHT}"><rect width="${DEFAULT_EMPTY_WIDTH}" height="${DEFAULT_EMPTY_HEIGHT}" fill="${escapeHtml(background)}" /></svg>`;
    return { svg, width: DEFAULT_EMPTY_WIDTH, height: DEFAULT_EMPTY_HEIGHT };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const root of visibleRoots) {
    minX = Math.min(minX, root.x);
    minY = Math.min(minY, root.y);
    maxX = Math.max(maxX, root.x + root.width);
    maxY = Math.max(maxY, root.y + root.height);
  }

  const width = Math.max(1, Math.round(maxX - minX + padding * 2));
  const height = Math.max(1, Math.round(maxY - minY + padding * 2));
  const body = visibleRoots
    .map((root) =>
      renderNodeSvg(
        doc,
        root,
        root.x - minX + padding,
        root.y - minY + padding,
        root.width,
        root.height,
        defs,
      ),
    )
    .join("");
  const defsBlock = defs.length > 0 ? `<defs>${defs.join("")}</defs>` : "";
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${defsBlock}<rect width="${width}" height="${height}" fill="${escapeHtml(background)}" />${body}</svg>`;
  return { svg, width, height };
}
