import { assert, describe, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, RunId, ThreadId } from "@t3tools/contracts";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpSchema, McpServer } from "effect/ai";

import * as HtmlRender from "../../../htmlRender/HtmlRender.ts";
import * as T3Objects from "../../../objects/T3ObjectService.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import { runMigrations } from "../../../persistence/Migrations.ts";
import * as McpHttpServer from "../../McpHttpServer.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const callerThreadId = ThreadId.make("thread-objects-mcp-1");

const callerScope: McpInvocationContext.McpInvocationScope = {
  environmentId: EnvironmentId.make("env-objects-test"),
  requestNamespace: "mcp-objects-test",
  thread: {
    threadId: callerThreadId,
    providerSessionId: "provider-session-objects-1",
    providerInstanceId: ProviderInstanceId.make("claude"),
  },
  client: undefined,
  issuedAt: 0,
  capabilities: new Set(["orchestration"]),
};

const mcpClient = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-06-18",
  clientCapabilities: {},
  clientInfo: { name: "objects-test", version: "1" },
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "objects-test", version: "1" },
  },
  getClient: Effect.die("unused"),
});

const makeTestLayer = () => {
  const sqliteLayer = NodeSqliteClient.layer({ filename: ":memory:" });
  const migrationLayer = Layer.effectDiscard(runMigrations()).pipe(Layer.provide(sqliteLayer));
  const objectsLayer = T3Objects.layer.pipe(
    Layer.provide(sqliteLayer),
    Layer.provide(migrationLayer),
    Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
  );
  const htmlRenderMock = Layer.mock(HtmlRender.HtmlRender)({
    preview: (input) =>
      Effect.succeed({
        png: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        width: input.width ?? 800,
        contentHeight: 400,
        capturedHeight: 400,
        consoleMessages: [],
      }),
  });
  const threadManagementMock = Layer.mock(ThreadManagement.ThreadManagementService)({
    getThreadShell: (id) =>
      Effect.succeed({
        id,
        deletedAt: null,
        archivedAt: null,
        activeRunId: RunId.make("run-objects-1"),
        providerInstanceId: ProviderInstanceId.make("claude"),
        runtimeMode: "auto-accept-edits",
        interactionMode: "default",
      } as never),
  });

  return McpHttpServer.layerObjectsToolkitWithoutHtmlRender.pipe(
    Layer.provideMerge(McpHttpServer.layerInProcessMcpServer),
    Layer.provideMerge(objectsLayer),
    Layer.provide(htmlRenderMock),
    Layer.provide(threadManagementMock),
    Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
  );
};

describe("Objects MCP toolkit", () => {
  it.effect("creates, mutates, inspects, screenshots, and restores a design object", () =>
    Effect.gen(function* () {
      const server = yield* McpServer.McpServer;
      const call = (name: string, args: Record<string, unknown>) =>
        server
          .callTool({ name, arguments: args })
          .pipe(
            Effect.provideService(McpInvocationContext.McpInvocationContext, callerScope),
            Effect.provideService(McpSchema.McpServerClient, mcpClient),
          );

      const created = yield* call("t3_object_create", {
        kind: "design",
        title: "Signup Modal",
        background: "#09090b",
        summary: "Create modal frame",
        ops: [
          {
            op: "add",
            node: {
              id: "modal",
              type: "frame",
              name: "Modal",
              x: 40,
              y: 40,
              width: 420,
              height: 300,
              fill: "#18181b",
              radius: 16,
              layout: { direction: "vertical", gap: 16, padding: 24 },
            },
          },
          {
            op: "add",
            node: {
              id: "heading",
              type: "text",
              name: "Heading",
              parentId: "modal",
              width: 372,
              height: 32,
              text: "Create account",
              fontSize: 24,
              fontWeight: 700,
              color: "#fafafa",
            },
          },
        ],
      });
      assert.isFalse(created.isError === true);
      const createdPayload = created.structuredContent as {
        readonly object: {
          readonly id: string;
          readonly revision: number;
          readonly nodeCount: number;
        };
      };
      assert.strictEqual(createdPayload.object.revision, 1);
      assert.strictEqual(createdPayload.object.nodeCount, 2);
      const objectId = createdPayload.object.id;

      const mutated = yield* call("design_mutate", {
        id: objectId,
        expectedRevision: 1,
        summary: "Add submit button",
        ops: [
          {
            op: "add",
            node: {
              id: "btn",
              type: "rect",
              name: "Submit Button",
              parentId: "modal",
              width: 372,
              height: 44,
              fill: "#2563eb",
              radius: 10,
            },
          },
        ],
      });
      assert.isFalse(mutated.isError === true);
      const mutatedPayload = mutated.structuredContent as {
        readonly object: { readonly revision: number; readonly nodeCount: number };
      };
      assert.strictEqual(mutatedPayload.object.revision, 2);
      assert.strictEqual(mutatedPayload.object.nodeCount, 3);

      const inspected = yield* call("t3_object_read", { id: objectId });
      assert.isFalse(inspected.isError === true);
      const inspectedPayload = inspected.structuredContent as {
        readonly tree: ReadonlyArray<{ readonly id: string; readonly childCount?: number }>;
      };
      assert.strictEqual(inspectedPayload.tree.length, 1);
      assert.strictEqual(inspectedPayload.tree[0]?.id, "modal");
      assert.strictEqual(inspectedPayload.tree[0]?.childCount, 2);

      const shot = yield* call("design_screenshot", { id: objectId, frameId: "modal" });
      assert.isFalse(shot.isError === true);
      assert.isTrue(
        shot.content.some((part) => part.type === "image" && part.mimeType === "image/png"),
      );

      const restored = yield* call("design_revisions", {
        id: objectId,
        action: "restore",
        revision: 1,
      });
      assert.isFalse(restored.isError === true);
      const restoredPayload = restored.structuredContent as {
        readonly restored: {
          readonly object: { readonly revision: number; readonly nodeCount: number };
        };
      };
      assert.strictEqual(restoredPayload.restored.object.revision, 3);
      assert.strictEqual(restoredPayload.restored.object.nodeCount, 2);
    }).pipe(Effect.provide(makeTestLayer())),
  );
});
