import {
  WS_METHODS,
  type T3ObjectId,
  type T3ObjectRevisionSummary,
  type T3ObjectStreamEvent,
  type T3ObjectSummary,
  type ThreadId,
} from "@t3tools/contracts";
import * as Stream from "effect/Stream";
import type { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

export interface OpenObjectRequest {
  readonly id: T3ObjectId;
  readonly threadId: ThreadId | null;
  readonly seq: number;
}

export interface ObjectsEnvironmentState {
  readonly loaded: boolean;
  readonly summariesById: Readonly<Record<string, T3ObjectSummary>>;
  readonly latestRevisionById: Readonly<Record<string, T3ObjectRevisionSummary>>;
  readonly lastOpenRequest: OpenObjectRequest | null;
}

export const EMPTY_OBJECTS_ENVIRONMENT_STATE: ObjectsEnvironmentState = {
  loaded: false,
  summariesById: {},
  latestRevisionById: {},
  lastOpenRequest: null,
};

export function reduceT3ObjectStreamEvent(
  state: ObjectsEnvironmentState,
  event: T3ObjectStreamEvent,
): ObjectsEnvironmentState {
  switch (event.type) {
    case "snapshot": {
      const summariesById: Record<string, T3ObjectSummary> = {};
      for (const summary of event.objects) {
        summariesById[summary.id] = summary;
      }
      return {
        ...state,
        loaded: true,
        summariesById,
      };
    }
    case "created": {
      return {
        ...state,
        loaded: true,
        summariesById: {
          ...state.summariesById,
          [event.object.id]: event.object,
        },
      };
    }
    case "updated": {
      return {
        ...state,
        loaded: true,
        summariesById: {
          ...state.summariesById,
          [event.object.id]: event.object,
        },
        latestRevisionById: {
          ...state.latestRevisionById,
          [event.object.id]: event.revision,
        },
      };
    }
    case "renamed": {
      const existingSummary = state.summariesById[event.id];
      return {
        ...state,
        summariesById:
          existingSummary === undefined
            ? state.summariesById
            : {
                ...state.summariesById,
                [event.id]: { ...existingSummary, title: event.title, updatedAt: event.updatedAt },
              },
      };
    }
    case "archived": {
      const existingSummary = state.summariesById[event.id];
      return {
        ...state,
        summariesById:
          existingSummary === undefined
            ? state.summariesById
            : {
                ...state.summariesById,
                [event.id]: {
                  ...existingSummary,
                  archivedAt: event.archivedAt,
                  updatedAt: event.updatedAt,
                },
              },
      };
    }
    case "deleted": {
      const nextSummaries = { ...state.summariesById };
      const nextRevisions = { ...state.latestRevisionById };
      delete nextSummaries[event.id];
      delete nextRevisions[event.id];
      return {
        ...state,
        summariesById: nextSummaries,
        latestRevisionById: nextRevisions,
      };
    }
    case "openRequested": {
      return {
        ...state,
        lastOpenRequest: {
          id: event.id,
          threadId: event.threadId,
          seq: (state.lastOpenRequest?.seq ?? 0) + 1,
        },
      };
    }
  }
}

export function createObjectsEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const scheduler = createAtomCommandScheduler();
  const objectConcurrency = {
    mode: "serial" as const,
    key: ({ environmentId, input }: { environmentId: string; input: { readonly id: string } }) =>
      `${environmentId}:${input.id}`,
  };

  return {
    stream: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:objects:stream",
      tag: WS_METHODS.objectsSubscribe,
      transform: (stream) =>
        stream.pipe(Stream.scan(() => EMPTY_OBJECTS_ENVIRONMENT_STATE, reduceT3ObjectStreamEvent)),
    }),
    list: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:objects:list",
      tag: WS_METHODS.objectsList,
    }),
    read: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:objects:read",
      tag: WS_METHODS.objectsRead,
    }),
    create: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:objects:create",
      tag: WS_METHODS.objectsCreate,
    }),
    rename: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:objects:rename",
      tag: WS_METHODS.objectsRename,
      scheduler,
      concurrency: objectConcurrency,
    }),
    setArchived: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:objects:set-archived",
      tag: WS_METHODS.objectsSetArchived,
      scheduler,
      concurrency: objectConcurrency,
    }),
    delete: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:objects:delete",
      tag: WS_METHODS.objectsDelete,
      scheduler,
      concurrency: objectConcurrency,
    }),
    mutateDesign: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:objects:mutate-design",
      tag: WS_METHODS.objectsMutateDesign,
      scheduler,
      concurrency: objectConcurrency,
    }),
    replaceDesign: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:objects:replace-design",
      tag: WS_METHODS.objectsReplaceDesign,
      scheduler,
      concurrency: objectConcurrency,
    }),
    listRevisions: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:objects:list-revisions",
      tag: WS_METHODS.objectsListRevisions,
    }),
    readRevision: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:objects:read-revision",
      tag: WS_METHODS.objectsReadRevision,
    }),
    restoreRevision: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:objects:restore-revision",
      tag: WS_METHODS.objectsRestoreRevision,
      scheduler,
      concurrency: objectConcurrency,
    }),
  };
}
