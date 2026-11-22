import {
  DesignColor,
  DesignMutationOp,
  DesignNodeId,
  OrchestratorMcpFailure,
  PositiveInt,
  T3Object,
  T3ObjectId,
  T3ObjectKind,
  T3ObjectRevisionSummary,
  T3ObjectSummary,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";

import * as HtmlRender from "../../../htmlRender/HtmlRender.ts";
import * as T3Objects from "../../../objects/T3ObjectService.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const T3ObjectListTool = Tool.make("t3_object_list", {
  description:
    "List T3 Objects stored in this T3 Code instance (instance-wide, not tied to a project).",
  parameters: Schema.Struct({
    kind: Schema.optional(T3ObjectKind),
    includeArchived: Schema.optional(Schema.Boolean),
  }),
  success: Schema.Struct({
    objects: Schema.Array(T3ObjectSummary),
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [McpInvocationContext.McpInvocationContext, T3Objects.T3ObjectService],
})
  .annotate(Tool.Title, "List T3 Objects")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

const T3ObjectCreateTool = Tool.make("t3_object_create", {
  description:
    "Create a new T3 Object (e.g. kind='design') in this T3 instance. Optionally pass initial design ops in the same call and open it in the user's panel (default open=true).",
  parameters: Schema.Struct({
    kind: T3ObjectKind,
    title: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
    background: Schema.optional(DesignColor),
    ops: Schema.optional(
      Schema.Array(DesignMutationOp).check(Schema.isMinLength(1), Schema.isMaxLength(500)),
    ),
    summary: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(500))),
    open: Schema.optional(
      Schema.Boolean.annotate({
        description: "Open the new object in the user's side panel. Default true.",
      }),
    ),
  }),
  success: Schema.Struct({
    object: T3ObjectSummary,
    revision: T3ObjectRevisionSummary,
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    T3Objects.T3ObjectService,
  ],
})
  .annotate(Tool.Title, "Create T3 Object")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

const T3ObjectReadTool = Tool.make("t3_object_read", {
  description:
    "Inspect a T3 Object. Returns metadata and a compact node tree by default; pass includeDocument=true for the full JSON document.",
  parameters: Schema.Struct({
    id: T3ObjectId,
    frameId: Schema.optional(DesignNodeId),
    includeDocument: Schema.optional(Schema.Boolean),
  }),
  success: Schema.Struct({
    object: T3ObjectSummary,
    background: Schema.optional(Schema.String),
    tree: Schema.Array(Schema.Unknown),
    document: Schema.optional(T3Object.fields.content),
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [McpInvocationContext.McpInvocationContext, T3Objects.T3ObjectService],
})
  .annotate(Tool.Title, "Read T3 Object")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

const T3ObjectOpenTool = Tool.make("t3_object_open", {
  description: "Open or focus a T3 Object in the user's side panel.",
  parameters: Schema.Struct({
    id: T3ObjectId,
  }),
  success: Schema.Struct({
    object: T3ObjectSummary,
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    T3Objects.T3ObjectService,
  ],
})
  .annotate(Tool.Title, "Open T3 Object")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

const T3ObjectDeleteTool = Tool.make("t3_object_delete", {
  description: "Archive (default archive=true) or permanently delete (archive=false) a T3 Object.",
  parameters: Schema.Struct({
    id: T3ObjectId,
    archive: Schema.optional(Schema.Boolean),
  }),
  success: Schema.Struct({
    id: T3ObjectId,
    archived: Schema.Boolean,
    deleted: Schema.Boolean,
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    T3Objects.T3ObjectService,
  ],
})
  .annotate(Tool.Title, "Archive or Delete T3 Object")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

const DesignMutateTool = Tool.make("design_mutate", {
  description:
    "Apply atomic batch mutations (add, update, delete, reparent, reorder, setBackground) to a design T3 Object. Always include a short summary for revision history. Pass expectedRevision to guard against concurrent user edits.",
  parameters: Schema.Struct({
    id: T3ObjectId,
    ops: Schema.Array(DesignMutationOp).check(Schema.isMinLength(1), Schema.isMaxLength(500)),
    summary: TrimmedNonEmptyString.check(Schema.isMaxLength(500)),
    expectedRevision: Schema.optional(PositiveInt),
    open: Schema.optional(Schema.Boolean),
  }),
  success: Schema.Struct({
    object: T3ObjectSummary,
    revision: T3ObjectRevisionSummary,
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    T3Objects.T3ObjectService,
  ],
})
  .annotate(Tool.Title, "Mutate Design Object")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

const DesignRevisionsTool = Tool.make("design_revisions", {
  description: "List revision history for a T3 Object or restore a previous revision.",
  parameters: Schema.Struct({
    id: T3ObjectId,
    action: Schema.Literals(["list", "restore"]),
    revision: Schema.optional(PositiveInt),
    limit: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(200))),
  }),
  success: Schema.Struct({
    revisions: Schema.optional(Schema.Array(T3ObjectRevisionSummary)),
    restored: Schema.optional(
      Schema.Struct({
        object: T3ObjectSummary,
        revision: T3ObjectRevisionSummary,
      }),
    ),
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    T3Objects.T3ObjectService,
  ],
})
  .annotate(Tool.Title, "T3 Object Revisions")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

export const DesignScreenshotTool = Tool.make("design_screenshot", {
  description:
    "Render a design T3 Object (whole canvas or one frameId) and return a PNG screenshot for visual inspection.",
  parameters: Schema.Struct({
    id: T3ObjectId,
    frameId: Schema.optional(DesignNodeId),
    maxWidth: Schema.optional(
      Schema.Int.check(Schema.isBetween({ minimum: 240, maximum: 1600 })).annotate({
        description: "Max PNG width in CSS pixels (240..1600). Default 1200.",
      }),
    ),
    appearance: Schema.optional(Schema.Literals(["dark", "light"])),
  }),
  success: Schema.Struct({
    objectId: T3ObjectId,
    revision: PositiveInt,
    frameId: Schema.NullOr(Schema.String),
    width: Schema.Int,
    height: Schema.Int,
    screenshot: Schema.Struct({
      mimeType: Schema.Literal("image/png"),
      data: Schema.String,
      width: Schema.Int,
      height: Schema.Int,
    }),
  }),
  failure: OrchestratorMcpFailure,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    T3Objects.T3ObjectService,
    HtmlRender.HtmlRender,
  ],
})
  .annotate(Tool.Title, "Screenshot Design Object")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

export const ObjectsStandardToolkit = Toolkit.make(
  T3ObjectListTool,
  T3ObjectCreateTool,
  T3ObjectReadTool,
  T3ObjectOpenTool,
  T3ObjectDeleteTool,
  DesignMutateTool,
  DesignRevisionsTool,
);

export const DesignScreenshotToolkit = Toolkit.make(DesignScreenshotTool);

export const ObjectsToolkit = Toolkit.make(
  T3ObjectListTool,
  T3ObjectCreateTool,
  T3ObjectReadTool,
  T3ObjectOpenTool,
  T3ObjectDeleteTool,
  DesignMutateTool,
  DesignRevisionsTool,
  DesignScreenshotTool,
);
