import * as Schema from "effect/Schema";

import {
  DesignNodeId,
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  T3ObjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

export const T3ObjectKind = Schema.Literals(["design"]);
export type T3ObjectKind = typeof T3ObjectKind.Type;

export const T3ObjectActor = Schema.Literals(["user", "agent"]);
export type T3ObjectActor = typeof T3ObjectActor.Type;

export const DesignColor = TrimmedNonEmptyString.check(Schema.isMaxLength(256));
export type DesignColor = typeof DesignColor.Type;

export const DesignPaddingBox = Schema.Struct({
  top: Schema.Finite,
  right: Schema.Finite,
  bottom: Schema.Finite,
  left: Schema.Finite,
});
export type DesignPaddingBox = typeof DesignPaddingBox.Type;

export const DesignPadding = Schema.Union([Schema.Finite, DesignPaddingBox]);
export type DesignPadding = typeof DesignPadding.Type;

export const DesignShadow = Schema.Struct({
  x: Schema.Finite,
  y: Schema.Finite,
  blur: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  spread: Schema.optional(Schema.Finite),
  color: DesignColor,
});
export type DesignShadow = typeof DesignShadow.Type;

export const DesignAutoLayout = Schema.Struct({
  direction: Schema.Literals(["vertical", "horizontal"]),
  gap: Schema.optional(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
  padding: Schema.optional(DesignPadding),
  alignItems: Schema.optional(Schema.Literals(["start", "center", "end", "stretch"])),
  justifyContent: Schema.optional(
    Schema.Literals(["start", "center", "end", "space-between", "space-around"]),
  ),
  wrap: Schema.optional(Schema.Boolean),
});
export type DesignAutoLayout = typeof DesignAutoLayout.Type;

export const DesignSizingMode = Schema.Literals(["fixed", "hug", "fill"]);
export type DesignSizingMode = typeof DesignSizingMode.Type;

const DesignNodeBaseFields = {
  id: DesignNodeId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  parentId: Schema.NullOr(DesignNodeId),
  x: Schema.Finite,
  y: Schema.Finite,
  width: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  height: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  rotation: Schema.optional(Schema.Finite),
  opacity: Schema.optional(Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }))),
  visible: Schema.optional(Schema.Boolean),
  locked: Schema.optional(Schema.Boolean),
  fill: Schema.optional(DesignColor),
  stroke: Schema.optional(DesignColor),
  strokeWidth: Schema.optional(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
  radius: Schema.optional(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
  shadow: Schema.optional(DesignShadow),
  widthMode: Schema.optional(DesignSizingMode),
  heightMode: Schema.optional(DesignSizingMode),
} as const;

export const DesignFrameNode = Schema.Struct({
  ...DesignNodeBaseFields,
  type: Schema.Literal("frame"),
  clip: Schema.optional(Schema.Boolean),
  layout: Schema.optional(DesignAutoLayout),
  childIds: Schema.Array(DesignNodeId),
});
export type DesignFrameNode = typeof DesignFrameNode.Type;

export const DesignRectNode = Schema.Struct({
  ...DesignNodeBaseFields,
  type: Schema.Literal("rect"),
});
export type DesignRectNode = typeof DesignRectNode.Type;

export const DesignEllipseNode = Schema.Struct({
  ...DesignNodeBaseFields,
  type: Schema.Literal("ellipse"),
});
export type DesignEllipseNode = typeof DesignEllipseNode.Type;

export const DesignTextNode = Schema.Struct({
  ...DesignNodeBaseFields,
  type: Schema.Literal("text"),
  text: Schema.String.check(Schema.isMaxLength(32_000)),
  color: Schema.optional(DesignColor),
  fontSize: Schema.optional(Schema.Finite.check(Schema.isBetween({ minimum: 4, maximum: 512 }))),
  fontWeight: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 900 }))),
  fontFamily: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(128))),
  lineHeight: Schema.optional(Schema.Finite.check(Schema.isBetween({ minimum: 0.5, maximum: 5 }))),
  letterSpacing: Schema.optional(Schema.Finite),
  textAlign: Schema.optional(Schema.Literals(["left", "center", "right"])),
});
export type DesignTextNode = typeof DesignTextNode.Type;

export const DesignLineNode = Schema.Struct({
  ...DesignNodeBaseFields,
  type: Schema.Literal("line"),
  strokeDasharray: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(64))),
});
export type DesignLineNode = typeof DesignLineNode.Type;

export const DesignSvgNode = Schema.Struct({
  ...DesignNodeBaseFields,
  type: Schema.Literal("svg"),
  svg: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64_000)),
});
export type DesignSvgNode = typeof DesignSvgNode.Type;

export const DesignImageNode = Schema.Struct({
  ...DesignNodeBaseFields,
  type: Schema.Literal("image"),
  src: TrimmedNonEmptyString.check(Schema.isMaxLength(4_096)),
  objectFit: Schema.optional(Schema.Literals(["cover", "contain", "fill"])),
});
export type DesignImageNode = typeof DesignImageNode.Type;

export const DesignNode = Schema.Union([
  DesignFrameNode,
  DesignRectNode,
  DesignEllipseNode,
  DesignTextNode,
  DesignLineNode,
  DesignSvgNode,
  DesignImageNode,
]);
export type DesignNode = typeof DesignNode.Type;
export type DesignNodeType = DesignNode["type"];

export const DesignDocument = Schema.Struct({
  version: Schema.Literal(1),
  background: Schema.optional(DesignColor),
  rootIds: Schema.Array(DesignNodeId),
  nodes: Schema.Record(Schema.String, DesignNode),
});
export type DesignDocument = typeof DesignDocument.Type;

export function emptyDesignDocument(background?: string): DesignDocument {
  return {
    version: 1,
    ...(background !== undefined ? { background } : {}),
    rootIds: [],
    nodes: {},
  };
}

export const T3ObjectContent = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("design"),
    document: DesignDocument,
  }),
]);
export type T3ObjectContent = typeof T3ObjectContent.Type;

const T3ObjectSummaryFields = {
  id: T3ObjectId,
  kind: T3ObjectKind,
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  revision: PositiveInt,
  nodeCount: NonNegativeInt,
  createdByThreadId: Schema.NullOr(ThreadId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archivedAt: Schema.NullOr(IsoDateTime),
} as const;

export const T3ObjectSummary = Schema.Struct(T3ObjectSummaryFields);
export type T3ObjectSummary = typeof T3ObjectSummary.Type;

export const T3Object = Schema.Struct({
  ...T3ObjectSummaryFields,
  content: T3ObjectContent,
});
export type T3Object = typeof T3Object.Type;

export const T3ObjectRevisionSummary = Schema.Struct({
  objectId: T3ObjectId,
  revision: PositiveInt,
  actor: T3ObjectActor,
  summary: TrimmedNonEmptyString.check(Schema.isMaxLength(500)),
  threadId: Schema.NullOr(ThreadId),
  createdAt: IsoDateTime,
});
export type T3ObjectRevisionSummary = typeof T3ObjectRevisionSummary.Type;

export const T3ObjectRevision = Schema.Struct({
  ...T3ObjectRevisionSummary.fields,
  content: T3ObjectContent,
});
export type T3ObjectRevision = typeof T3ObjectRevision.Type;

// Input schema for `design_mutate` add operations (allows omitting id / parentId / childIds).
const DesignNodeAddBaseFields = {
  id: Schema.optional(DesignNodeId),
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  parentId: Schema.optional(Schema.NullOr(DesignNodeId)),
  x: Schema.optional(Schema.Finite),
  y: Schema.optional(Schema.Finite),
  width: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  height: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  rotation: Schema.optional(Schema.Finite),
  opacity: Schema.optional(Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }))),
  visible: Schema.optional(Schema.Boolean),
  locked: Schema.optional(Schema.Boolean),
  fill: Schema.optional(DesignColor),
  stroke: Schema.optional(DesignColor),
  strokeWidth: Schema.optional(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
  radius: Schema.optional(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
  shadow: Schema.optional(DesignShadow),
  widthMode: Schema.optional(DesignSizingMode),
  heightMode: Schema.optional(DesignSizingMode),
} as const;

export const DesignNodeInput = Schema.Union([
  Schema.Struct({
    ...DesignNodeAddBaseFields,
    type: Schema.Literal("frame"),
    clip: Schema.optional(Schema.Boolean),
    layout: Schema.optional(DesignAutoLayout),
  }),
  Schema.Struct({
    ...DesignNodeAddBaseFields,
    type: Schema.Literal("rect"),
  }),
  Schema.Struct({
    ...DesignNodeAddBaseFields,
    type: Schema.Literal("ellipse"),
  }),
  Schema.Struct({
    ...DesignNodeAddBaseFields,
    type: Schema.Literal("text"),
    text: Schema.String.check(Schema.isMaxLength(32_000)),
    color: Schema.optional(DesignColor),
    fontSize: Schema.optional(Schema.Finite.check(Schema.isBetween({ minimum: 4, maximum: 512 }))),
    fontWeight: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 900 }))),
    fontFamily: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(128))),
    lineHeight: Schema.optional(
      Schema.Finite.check(Schema.isBetween({ minimum: 0.5, maximum: 5 })),
    ),
    letterSpacing: Schema.optional(Schema.Finite),
    textAlign: Schema.optional(Schema.Literals(["left", "center", "right"])),
  }),
  Schema.Struct({
    ...DesignNodeAddBaseFields,
    type: Schema.Literal("line"),
    strokeDasharray: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(64))),
  }),
  Schema.Struct({
    ...DesignNodeAddBaseFields,
    type: Schema.Literal("svg"),
    svg: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64_000)),
  }),
  Schema.Struct({
    ...DesignNodeAddBaseFields,
    type: Schema.Literal("image"),
    src: TrimmedNonEmptyString.check(Schema.isMaxLength(4_096)),
    objectFit: Schema.optional(Schema.Literals(["cover", "contain", "fill"])),
  }),
]);
export type DesignNodeInput = typeof DesignNodeInput.Type;

export const DesignNodePatch = Schema.Struct({
  name: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(200))),
  x: Schema.optional(Schema.Finite),
  y: Schema.optional(Schema.Finite),
  width: Schema.optional(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
  height: Schema.optional(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
  rotation: Schema.optional(Schema.NullOr(Schema.Finite)),
  opacity: Schema.optional(
    Schema.NullOr(Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }))),
  ),
  visible: Schema.optional(Schema.Boolean),
  locked: Schema.optional(Schema.Boolean),
  fill: Schema.optional(Schema.NullOr(DesignColor)),
  stroke: Schema.optional(Schema.NullOr(DesignColor)),
  strokeWidth: Schema.optional(
    Schema.NullOr(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
  ),
  radius: Schema.optional(Schema.NullOr(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)))),
  shadow: Schema.optional(Schema.NullOr(DesignShadow)),
  widthMode: Schema.optional(Schema.NullOr(DesignSizingMode)),
  heightMode: Schema.optional(Schema.NullOr(DesignSizingMode)),
  // Frame-specific
  clip: Schema.optional(Schema.Boolean),
  layout: Schema.optional(Schema.NullOr(DesignAutoLayout)),
  // Text-specific
  text: Schema.optional(Schema.String.check(Schema.isMaxLength(32_000))),
  color: Schema.optional(Schema.NullOr(DesignColor)),
  fontSize: Schema.optional(
    Schema.NullOr(Schema.Finite.check(Schema.isBetween({ minimum: 4, maximum: 512 }))),
  ),
  fontWeight: Schema.optional(
    Schema.NullOr(Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 900 }))),
  ),
  fontFamily: Schema.optional(Schema.NullOr(TrimmedNonEmptyString.check(Schema.isMaxLength(128)))),
  lineHeight: Schema.optional(
    Schema.NullOr(Schema.Finite.check(Schema.isBetween({ minimum: 0.5, maximum: 5 }))),
  ),
  letterSpacing: Schema.optional(Schema.NullOr(Schema.Finite)),
  textAlign: Schema.optional(Schema.NullOr(Schema.Literals(["left", "center", "right"]))),
  // Line-specific
  strokeDasharray: Schema.optional(
    Schema.NullOr(TrimmedNonEmptyString.check(Schema.isMaxLength(64))),
  ),
  // SVG-specific
  svg: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64_000))),
  // Image-specific
  src: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(4_096))),
  objectFit: Schema.optional(Schema.NullOr(Schema.Literals(["cover", "contain", "fill"]))),
});
export type DesignNodePatch = typeof DesignNodePatch.Type;

export const DesignMutationOp = Schema.Union([
  Schema.Struct({
    op: Schema.Literal("add"),
    node: DesignNodeInput,
    index: Schema.optional(NonNegativeInt),
  }),
  Schema.Struct({
    op: Schema.Literal("update"),
    id: DesignNodeId,
    patch: DesignNodePatch,
  }),
  Schema.Struct({
    op: Schema.Literal("delete"),
    id: DesignNodeId,
  }),
  Schema.Struct({
    op: Schema.Literal("reparent"),
    id: DesignNodeId,
    parentId: Schema.NullOr(DesignNodeId),
    index: Schema.optional(NonNegativeInt),
  }),
  Schema.Struct({
    op: Schema.Literal("reorder"),
    id: DesignNodeId,
    index: NonNegativeInt,
  }),
  Schema.Struct({
    op: Schema.Literal("setBackground"),
    background: Schema.NullOr(DesignColor),
  }),
]);
export type DesignMutationOp = typeof DesignMutationOp.Type;

export const T3ObjectErrorCode = Schema.Literals([
  "not_found",
  "invalid_request",
  "revision_conflict",
  "storage_error",
]);
export type T3ObjectErrorCode = typeof T3ObjectErrorCode.Type;

export class T3ObjectError extends Schema.TaggedError<T3ObjectError>()("T3ObjectError", {
  code: T3ObjectErrorCode,
  message: Schema.String,
  objectId: Schema.optional(T3ObjectId),
  currentRevision: Schema.optional(PositiveInt),
}) {}

// RPC contracts
export const T3ObjectListInput = Schema.Struct({
  includeArchived: Schema.optional(Schema.Boolean),
  kind: Schema.optional(T3ObjectKind),
});
export type T3ObjectListInput = typeof T3ObjectListInput.Type;

export const T3ObjectListResult = Schema.Struct({
  objects: Schema.Array(T3ObjectSummary),
});
export type T3ObjectListResult = typeof T3ObjectListResult.Type;

export const T3ObjectReadInput = Schema.Struct({
  id: T3ObjectId,
});
export type T3ObjectReadInput = typeof T3ObjectReadInput.Type;

export const T3ObjectReadResult = Schema.Struct({
  object: T3Object,
});
export type T3ObjectReadResult = typeof T3ObjectReadResult.Type;

export const T3ObjectCreateInput = Schema.Struct({
  kind: T3ObjectKind,
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  document: Schema.optional(DesignDocument),
  summary: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(500))),
  threadId: Schema.optional(Schema.NullOr(ThreadId)),
});
export type T3ObjectCreateInput = typeof T3ObjectCreateInput.Type;

export const T3ObjectMutationResult = Schema.Struct({
  object: T3Object,
  revision: T3ObjectRevisionSummary,
});
export type T3ObjectMutationResult = typeof T3ObjectMutationResult.Type;

export const T3ObjectRenameInput = Schema.Struct({
  id: T3ObjectId,
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
});
export type T3ObjectRenameInput = typeof T3ObjectRenameInput.Type;

export const T3ObjectSetArchivedInput = Schema.Struct({
  id: T3ObjectId,
  archived: Schema.Boolean,
});
export type T3ObjectSetArchivedInput = typeof T3ObjectSetArchivedInput.Type;

export const T3ObjectDeleteInput = Schema.Struct({
  id: T3ObjectId,
});
export type T3ObjectDeleteInput = typeof T3ObjectDeleteInput.Type;

export const T3ObjectDeleteResult = Schema.Struct({
  deleted: Schema.Boolean,
});
export type T3ObjectDeleteResult = typeof T3ObjectDeleteResult.Type;

export const T3ObjectMutateDesignInput = Schema.Struct({
  id: T3ObjectId,
  ops: Schema.Array(DesignMutationOp).check(Schema.isMinLength(1), Schema.isMaxLength(500)),
  summary: TrimmedNonEmptyString.check(Schema.isMaxLength(500)),
  expectedRevision: Schema.optional(PositiveInt),
  threadId: Schema.optional(Schema.NullOr(ThreadId)),
});
export type T3ObjectMutateDesignInput = typeof T3ObjectMutateDesignInput.Type;

export const T3ObjectReplaceDesignInput = Schema.Struct({
  id: T3ObjectId,
  document: DesignDocument,
  summary: TrimmedNonEmptyString.check(Schema.isMaxLength(500)),
  expectedRevision: Schema.optional(PositiveInt),
  threadId: Schema.optional(Schema.NullOr(ThreadId)),
});
export type T3ObjectReplaceDesignInput = typeof T3ObjectReplaceDesignInput.Type;

export const T3ObjectListRevisionsInput = Schema.Struct({
  id: T3ObjectId,
  limit: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(200))),
});
export type T3ObjectListRevisionsInput = typeof T3ObjectListRevisionsInput.Type;

export const T3ObjectListRevisionsResult = Schema.Struct({
  revisions: Schema.Array(T3ObjectRevisionSummary),
});
export type T3ObjectListRevisionsResult = typeof T3ObjectListRevisionsResult.Type;

export const T3ObjectReadRevisionInput = Schema.Struct({
  id: T3ObjectId,
  revision: PositiveInt,
});
export type T3ObjectReadRevisionInput = typeof T3ObjectReadRevisionInput.Type;

export const T3ObjectReadRevisionResult = Schema.Struct({
  revision: T3ObjectRevision,
});
export type T3ObjectReadRevisionResult = typeof T3ObjectReadRevisionResult.Type;

export const T3ObjectRestoreRevisionInput = Schema.Struct({
  id: T3ObjectId,
  revision: PositiveInt,
  expectedRevision: Schema.optional(PositiveInt),
  threadId: Schema.optional(Schema.NullOr(ThreadId)),
});
export type T3ObjectRestoreRevisionInput = typeof T3ObjectRestoreRevisionInput.Type;

export const T3ObjectSubscribeInput = Schema.Struct({
  includeArchived: Schema.optional(Schema.Boolean),
});
export type T3ObjectSubscribeInput = typeof T3ObjectSubscribeInput.Type;

export const T3ObjectStreamEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("snapshot"),
    objects: Schema.Array(T3ObjectSummary),
  }),
  Schema.Struct({
    type: Schema.Literal("created"),
    object: T3Object,
  }),
  Schema.Struct({
    type: Schema.Literal("updated"),
    object: T3Object,
    revision: T3ObjectRevisionSummary,
  }),
  Schema.Struct({
    type: Schema.Literal("renamed"),
    id: T3ObjectId,
    title: TrimmedNonEmptyString,
    updatedAt: IsoDateTime,
  }),
  Schema.Struct({
    type: Schema.Literal("archived"),
    id: T3ObjectId,
    archivedAt: Schema.NullOr(IsoDateTime),
    updatedAt: IsoDateTime,
  }),
  Schema.Struct({
    type: Schema.Literal("deleted"),
    id: T3ObjectId,
  }),
  Schema.Struct({
    type: Schema.Literal("openRequested"),
    id: T3ObjectId,
    threadId: Schema.NullOr(ThreadId),
  }),
]);
export type T3ObjectStreamEvent = typeof T3ObjectStreamEvent.Type;
