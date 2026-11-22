import {
  OrchestratorMcpFailure,
  emptyDesignDocument,
  toT3ObjectSummary,
  type T3ObjectError,
} from "@t3tools/contracts";
import { inspectDesignDocument, renderDesignToHtml } from "@t3tools/shared/designRender";
import * as Effect from "effect/Effect";

import * as HtmlRender from "../../../htmlRender/HtmlRender.ts";
import * as T3Objects from "../../../objects/T3ObjectService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { DesignScreenshotToolkit, ObjectsStandardToolkit, type ObjectsToolkit } from "./tools.ts";

function toMcpFailure(error: T3ObjectError): OrchestratorMcpFailure {
  const code =
    error.code === "not_found" ||
    error.code === "invalid_request" ||
    error.code === "revision_conflict"
      ? "invalid_request"
      : "orchestration_error";
  return new OrchestratorMcpFailure({
    code,
    message: error.message,
  });
}

const handlers = {
  t3_object_list: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const objects = yield* T3Objects.T3ObjectService;
      return yield* objects.list(input).pipe(Effect.mapError(toMcpFailure));
    }),
  ),
  t3_object_create: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const threadId = scope.thread?.threadId ?? null;
      const objects = yield* T3Objects.T3ObjectService;
      const created = yield* objects
        .create({
          kind: input.kind,
          title: input.title,
          document: emptyDesignDocument(input.background),
          ...(input.ops !== undefined ? { ops: input.ops } : {}),
          summary: input.summary ?? "Created design object",
          actor: "agent",
          threadId,
        })
        .pipe(Effect.mapError(toMcpFailure));

      if (input.open !== false) {
        yield* objects.requestOpen({ id: created.object.id, threadId }).pipe(Effect.ignore);
      }

      return {
        object: toT3ObjectSummary(created.object),
        revision: created.revision,
      };
    }),
  ),
  t3_object_read: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const objects = yield* T3Objects.T3ObjectService;
      const { object } = yield* objects.read({ id: input.id }).pipe(Effect.mapError(toMcpFailure));
      const tree = inspectDesignDocument(object.content.document, {
        frameId: input.frameId,
      });
      return {
        object: toT3ObjectSummary(object),
        ...(object.content.document.background !== undefined
          ? { background: object.content.document.background }
          : {}),
        tree,
        ...(input.includeDocument === true ? { document: object.content } : {}),
      };
    }),
  ),
  t3_object_open: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const objects = yield* T3Objects.T3ObjectService;
      const { object } = yield* objects
        .requestOpen({ id: input.id, threadId: scope.thread?.threadId ?? null })
        .pipe(Effect.mapError(toMcpFailure));
      return { object: toT3ObjectSummary(object) };
    }),
  ),
  t3_object_delete: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const objects = yield* T3Objects.T3ObjectService;
      if (input.archive !== false) {
        yield* objects
          .setArchived({ id: input.id, archived: true })
          .pipe(Effect.mapError(toMcpFailure));
        return { id: input.id, archived: true, deleted: false };
      }
      const { deleted } = yield* objects
        .delete({ id: input.id })
        .pipe(Effect.mapError(toMcpFailure));
      return { id: input.id, archived: false, deleted };
    }),
  ),
  design_mutate: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const threadId = scope.thread?.threadId ?? null;
      const objects = yield* T3Objects.T3ObjectService;
      const result = yield* objects
        .mutateDesign({
          id: input.id,
          ops: input.ops,
          summary: input.summary,
          expectedRevision: input.expectedRevision,
          actor: "agent",
          threadId,
        })
        .pipe(Effect.mapError(toMcpFailure));
      if (input.open === true) {
        yield* objects.requestOpen({ id: result.object.id, threadId }).pipe(Effect.ignore);
      }
      return {
        object: toT3ObjectSummary(result.object),
        revision: result.revision,
      };
    }),
  ),
  design_revisions: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const objects = yield* T3Objects.T3ObjectService;
      if (input.action === "list") {
        const { revisions } = yield* objects
          .listRevisions({ id: input.id, limit: input.limit })
          .pipe(Effect.mapError(toMcpFailure));
        return { revisions };
      }
      if (input.revision === undefined) {
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: "Pass `revision` when action is 'restore'.",
        });
      }
      const restored = yield* objects
        .restoreRevision({
          id: input.id,
          revision: input.revision,
          actor: "agent",
          threadId: scope.thread?.threadId ?? null,
        })
        .pipe(Effect.mapError(toMcpFailure));
      return {
        restored: {
          object: toT3ObjectSummary(restored.object),
          revision: restored.revision,
        },
      };
    }),
  ),
  design_screenshot: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const objects = yield* T3Objects.T3ObjectService;
      const htmlRender = yield* HtmlRender.HtmlRender;
      const { object } = yield* objects.read({ id: input.id }).pipe(Effect.mapError(toMcpFailure));
      if (
        input.frameId !== undefined &&
        object.content.document.nodes[input.frameId] === undefined
      ) {
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: `Frame "${input.frameId}" does not exist in object "${input.id}".`,
        });
      }
      const rendered = renderDesignToHtml(object.content.document, {
        frameId: input.frameId,
        maxWidth: input.maxWidth ?? 1200,
      });
      const preview = yield* htmlRender
        .preview({
          html: rendered.html,
          width: rendered.width,
          appearance: input.appearance ?? "dark",
        })
        .pipe(
          Effect.mapError(
            (error) =>
              new OrchestratorMcpFailure({
                code: "orchestration_error",
                message: error.message,
              }),
          ),
        );
      return {
        objectId: object.id,
        revision: object.revision,
        frameId: rendered.frameId,
        width: preview.width,
        height: preview.capturedHeight,
        screenshot: {
          mimeType: "image/png" as const,
          data: preview.png,
          width: preview.width,
          height: preview.capturedHeight,
        },
      };
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof ObjectsToolkit.tools>;

export const layerStandard = McpToolAccess.toLayer(ObjectsStandardToolkit, {
  t3_object_list: handlers.t3_object_list,
  t3_object_create: handlers.t3_object_create,
  t3_object_read: handlers.t3_object_read,
  t3_object_open: handlers.t3_object_open,
  t3_object_delete: handlers.t3_object_delete,
  design_mutate: handlers.design_mutate,
  design_revisions: handlers.design_revisions,
});

export const layerScreenshot = McpToolAccess.toLayer(DesignScreenshotToolkit, {
  design_screenshot: handlers.design_screenshot,
});
