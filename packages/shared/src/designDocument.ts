import {
  DesignNodeId,
  type DesignDocument,
  type DesignFrameNode,
  type DesignMutationOp,
  type DesignNode,
  type DesignNodeInput,
  type DesignNodePatch,
} from "@t3tools/contracts";

export type DesignDocumentValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

export type DesignMutationApplyResult =
  | {
      readonly ok: true;
      readonly document: DesignDocument;
      readonly createdIds: ReadonlyArray<DesignNodeId>;
    }
  | { readonly ok: false; readonly message: string };

const MAX_DESIGN_NODES = 2_500;

export function countDesignNodes(doc: DesignDocument): number {
  return Object.keys(doc.nodes).length;
}

export function validateDesignDocument(doc: DesignDocument): DesignDocumentValidationResult {
  const nodeKeys = Object.keys(doc.nodes);
  if (nodeKeys.length > MAX_DESIGN_NODES) {
    return {
      ok: false,
      message: `Design document exceeds maximum of ${MAX_DESIGN_NODES} nodes.`,
    };
  }

  for (const key of nodeKeys) {
    const node = doc.nodes[key];
    if (node === undefined) continue;
    if (node.id !== key) {
      return {
        ok: false,
        message: `Node key "${key}" does not match node.id "${node.id}".`,
      };
    }
  }

  const visited = new Set<string>();

  const visit = (
    id: string,
    expectedParentId: string | null,
    ancestry: Set<string>,
  ): string | null => {
    if (ancestry.has(id)) {
      return `Cycle detected at node "${id}".`;
    }
    if (visited.has(id)) {
      return `Node "${id}" is referenced more than once in the tree.`;
    }
    const node = doc.nodes[id];
    if (node === undefined) {
      return `Missing node "${id}".`;
    }
    if (node.parentId !== expectedParentId) {
      return `Node "${id}" has parentId "${String(node.parentId)}" instead of "${String(expectedParentId)}".`;
    }
    visited.add(id);
    if (node.type === "frame") {
      ancestry.add(id);
      for (const childId of node.childIds) {
        const error = visit(childId, id, ancestry);
        if (error !== null) return error;
      }
      ancestry.delete(id);
    }
    return null;
  };

  const ancestry = new Set<string>();
  for (const rootId of doc.rootIds) {
    const error = visit(rootId, null, ancestry);
    if (error !== null) {
      return { ok: false, message: error };
    }
  }

  if (visited.size !== nodeKeys.length) {
    const orphan = nodeKeys.find((id) => !visited.has(id));
    return {
      ok: false,
      message: `Orphan node "${orphan ?? "unknown"}" is not reachable from rootIds.`,
    };
  }

  return { ok: true };
}

function insertAt<T>(items: ReadonlyArray<T>, item: T, index?: number): ReadonlyArray<T> {
  if (index === undefined || index >= items.length) {
    return [...items, item];
  }
  const clamped = Math.max(0, Math.min(index, items.length));
  return [...items.slice(0, clamped), item, ...items.slice(clamped)];
}

function defaultNodeIdGenerator(): () => DesignNodeId {
  let counter = 1;
  return () => DesignNodeId.make(`node_${counter++}`);
}

function buildNodeFromInput(input: DesignNodeInput, id: DesignNodeId): DesignNode {
  const base = {
    id,
    name: input.name,
    parentId: input.parentId ?? null,
    x: input.x ?? 0,
    y: input.y ?? 0,
    width: input.width,
    height: input.height,
    ...(input.rotation !== undefined ? { rotation: input.rotation } : {}),
    ...(input.opacity !== undefined ? { opacity: input.opacity } : {}),
    ...(input.visible !== undefined ? { visible: input.visible } : {}),
    ...(input.locked !== undefined ? { locked: input.locked } : {}),
    ...(input.fill !== undefined ? { fill: input.fill } : {}),
    ...(input.stroke !== undefined ? { stroke: input.stroke } : {}),
    ...(input.strokeWidth !== undefined ? { strokeWidth: input.strokeWidth } : {}),
    ...(input.radius !== undefined ? { radius: input.radius } : {}),
    ...(input.shadow !== undefined ? { shadow: input.shadow } : {}),
    ...(input.widthMode !== undefined ? { widthMode: input.widthMode } : {}),
    ...(input.heightMode !== undefined ? { heightMode: input.heightMode } : {}),
  };

  switch (input.type) {
    case "frame":
      return {
        ...base,
        type: "frame",
        ...(input.clip !== undefined ? { clip: input.clip } : {}),
        ...(input.layout !== undefined ? { layout: input.layout } : {}),
        childIds: [],
      };
    case "rect":
      return { ...base, type: "rect" };
    case "ellipse":
      return { ...base, type: "ellipse" };
    case "text":
      return {
        ...base,
        type: "text",
        text: input.text,
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(input.fontSize !== undefined ? { fontSize: input.fontSize } : {}),
        ...(input.fontWeight !== undefined ? { fontWeight: input.fontWeight } : {}),
        ...(input.fontFamily !== undefined ? { fontFamily: input.fontFamily } : {}),
        ...(input.lineHeight !== undefined ? { lineHeight: input.lineHeight } : {}),
        ...(input.letterSpacing !== undefined ? { letterSpacing: input.letterSpacing } : {}),
        ...(input.textAlign !== undefined ? { textAlign: input.textAlign } : {}),
      };
    case "line":
      return {
        ...base,
        type: "line",
        ...(input.strokeDasharray !== undefined ? { strokeDasharray: input.strokeDasharray } : {}),
      };
    case "svg":
      return { ...base, type: "svg", svg: input.svg };
    case "image":
      return {
        ...base,
        type: "image",
        src: input.src,
        ...(input.objectFit !== undefined ? { objectFit: input.objectFit } : {}),
      };
  }
}

function applyOptionalPatch<T>(
  record: Record<string, unknown>,
  key: string,
  value: T | null | undefined,
) {
  if (value === undefined) return;
  if (value === null) {
    delete record[key];
  } else {
    record[key] = value;
  }
}

function patchNode(node: DesignNode, patch: DesignNodePatch): DesignNode {
  const next: Record<string, unknown> = { ...node };

  if (patch.name !== undefined) next.name = patch.name;
  if (patch.x !== undefined) next.x = patch.x;
  if (patch.y !== undefined) next.y = patch.y;
  if (patch.width !== undefined) next.width = patch.width;
  if (patch.height !== undefined) next.height = patch.height;
  if (patch.visible !== undefined) next.visible = patch.visible;
  if (patch.locked !== undefined) next.locked = patch.locked;

  applyOptionalPatch(next, "rotation", patch.rotation);
  applyOptionalPatch(next, "opacity", patch.opacity);
  applyOptionalPatch(next, "fill", patch.fill);
  applyOptionalPatch(next, "stroke", patch.stroke);
  applyOptionalPatch(next, "strokeWidth", patch.strokeWidth);
  applyOptionalPatch(next, "radius", patch.radius);
  applyOptionalPatch(next, "shadow", patch.shadow);
  applyOptionalPatch(next, "widthMode", patch.widthMode);
  applyOptionalPatch(next, "heightMode", patch.heightMode);

  if (node.type === "frame") {
    if (patch.clip !== undefined) next.clip = patch.clip;
    applyOptionalPatch(next, "layout", patch.layout);
  } else if (node.type === "text") {
    if (patch.text !== undefined) next.text = patch.text;
    applyOptionalPatch(next, "color", patch.color);
    applyOptionalPatch(next, "fontSize", patch.fontSize);
    applyOptionalPatch(next, "fontWeight", patch.fontWeight);
    applyOptionalPatch(next, "fontFamily", patch.fontFamily);
    applyOptionalPatch(next, "lineHeight", patch.lineHeight);
    applyOptionalPatch(next, "letterSpacing", patch.letterSpacing);
    applyOptionalPatch(next, "textAlign", patch.textAlign);
  } else if (node.type === "line") {
    applyOptionalPatch(next, "strokeDasharray", patch.strokeDasharray);
  } else if (node.type === "svg") {
    if (patch.svg !== undefined) next.svg = patch.svg;
  } else if (node.type === "image") {
    if (patch.src !== undefined) next.src = patch.src;
    applyOptionalPatch(next, "objectFit", patch.objectFit);
  }

  return next as unknown as DesignNode;
}

function isDescendant(
  nodes: Record<string, DesignNode>,
  candidateAncestorId: string,
  targetId: string,
): boolean {
  let cursor: DesignNode | undefined = nodes[targetId];
  while (cursor !== undefined) {
    if (cursor.id === candidateAncestorId) return true;
    if (cursor.parentId === null) return false;
    cursor = nodes[cursor.parentId];
  }
  return false;
}

function collectSubtreeIds(nodes: Record<string, DesignNode>, id: string, out: Set<string>) {
  const node = nodes[id];
  if (node === undefined || out.has(id)) return;
  out.add(id);
  if (node.type === "frame") {
    for (const childId of node.childIds) {
      collectSubtreeIds(nodes, childId, out);
    }
  }
}

export function applyDesignMutations(
  doc: DesignDocument,
  ops: ReadonlyArray<DesignMutationOp>,
  generateId: () => DesignNodeId = defaultNodeIdGenerator(),
): DesignMutationApplyResult {
  let rootIds: ReadonlyArray<DesignNodeId> = [...doc.rootIds];
  const nodes: Record<string, DesignNode> = { ...doc.nodes };
  let background = doc.background;
  const createdIds: Array<DesignNodeId> = [];

  for (const [opIndex, op] of ops.entries()) {
    switch (op.op) {
      case "setBackground": {
        background = op.background === null ? undefined : op.background;
        break;
      }
      case "add": {
        let id = op.node.id ?? generateId();
        while (op.node.id === undefined && nodes[id] !== undefined) {
          id = generateId();
        }
        if (nodes[id] !== undefined) {
          return {
            ok: false,
            message: `Op #${opIndex} (add): node id "${id}" already exists.`,
          };
        }
        const parentId = op.node.parentId ?? null;
        if (parentId !== null) {
          const parent = nodes[parentId];
          if (parent === undefined) {
            return {
              ok: false,
              message: `Op #${opIndex} (add): parent "${parentId}" does not exist.`,
            };
          }
          if (parent.type !== "frame") {
            return {
              ok: false,
              message: `Op #${opIndex} (add): parent "${parentId}" must be a frame, got "${parent.type}".`,
            };
          }
          nodes[parentId] = {
            ...parent,
            childIds: insertAt(parent.childIds, id, op.index),
          };
        } else {
          rootIds = insertAt(rootIds, id, op.index);
        }
        nodes[id] = buildNodeFromInput(op.node, id);
        createdIds.push(id);
        break;
      }
      case "update": {
        const existing = nodes[op.id];
        if (existing === undefined) {
          return {
            ok: false,
            message: `Op #${opIndex} (update): node "${op.id}" does not exist.`,
          };
        }
        nodes[op.id] = patchNode(existing, op.patch);
        break;
      }
      case "delete": {
        const existing = nodes[op.id];
        if (existing === undefined) {
          return {
            ok: false,
            message: `Op #${opIndex} (delete): node "${op.id}" does not exist.`,
          };
        }
        if (existing.parentId !== null) {
          const parent = nodes[existing.parentId];
          if (parent !== undefined && parent.type === "frame") {
            nodes[existing.parentId] = {
              ...parent,
              childIds: parent.childIds.filter((childId) => childId !== op.id),
            };
          }
        } else {
          rootIds = rootIds.filter((rootId) => rootId !== op.id);
        }
        const toDelete = new Set<string>();
        collectSubtreeIds(nodes, op.id, toDelete);
        for (const deleteId of toDelete) {
          delete nodes[deleteId];
        }
        break;
      }
      case "reparent": {
        const existing = nodes[op.id];
        if (existing === undefined) {
          return {
            ok: false,
            message: `Op #${opIndex} (reparent): node "${op.id}" does not exist.`,
          };
        }
        if (op.parentId !== null) {
          const nextParent = nodes[op.parentId];
          if (nextParent === undefined) {
            return {
              ok: false,
              message: `Op #${opIndex} (reparent): parent "${op.parentId}" does not exist.`,
            };
          }
          if (nextParent.type !== "frame") {
            return {
              ok: false,
              message: `Op #${opIndex} (reparent): parent "${op.parentId}" must be a frame, got "${nextParent.type}".`,
            };
          }
          if (isDescendant(nodes, op.id, op.parentId)) {
            return {
              ok: false,
              message: `Op #${opIndex} (reparent): cannot move "${op.id}" inside its own descendant "${op.parentId}".`,
            };
          }
        }
        // Detach from old parent/root
        if (existing.parentId !== null) {
          const oldParent = nodes[existing.parentId];
          if (oldParent !== undefined && oldParent.type === "frame") {
            nodes[existing.parentId] = {
              ...oldParent,
              childIds: oldParent.childIds.filter((childId) => childId !== op.id),
            };
          }
        } else {
          rootIds = rootIds.filter((rootId) => rootId !== op.id);
        }
        // Attach to new parent/root
        if (op.parentId !== null) {
          const nextParent = nodes[op.parentId] as DesignFrameNode;
          nodes[op.parentId] = {
            ...nextParent,
            childIds: insertAt(nextParent.childIds, op.id, op.index),
          };
        } else {
          rootIds = insertAt(rootIds, op.id, op.index);
        }
        nodes[op.id] = { ...existing, parentId: op.parentId };
        break;
      }
      case "reorder": {
        const existing = nodes[op.id];
        if (existing === undefined) {
          return {
            ok: false,
            message: `Op #${opIndex} (reorder): node "${op.id}" does not exist.`,
          };
        }
        if (existing.parentId !== null) {
          const parent = nodes[existing.parentId];
          if (parent === undefined || parent.type !== "frame") {
            return {
              ok: false,
              message: `Op #${opIndex} (reorder): parent "${existing.parentId}" is missing or not a frame.`,
            };
          }
          const filtered = parent.childIds.filter((childId) => childId !== op.id);
          nodes[existing.parentId] = {
            ...parent,
            childIds: insertAt(filtered, op.id, op.index),
          };
        } else {
          const filtered = rootIds.filter((rootId) => rootId !== op.id);
          rootIds = insertAt(filtered, op.id, op.index);
        }
        break;
      }
    }
  }

  const nextDoc: DesignDocument = {
    version: 1,
    ...(background !== undefined ? { background } : {}),
    rootIds,
    nodes,
  };
  const validation = validateDesignDocument(nextDoc);
  if (!validation.ok) {
    return validation;
  }

  return {
    ok: true,
    document: nextDoc,
    createdIds,
  };
}
