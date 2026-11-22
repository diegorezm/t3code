import {
  createObjectsEnvironmentAtoms,
  EMPTY_OBJECTS_ENVIRONMENT_STATE,
  type ObjectsEnvironmentState,
} from "@t3tools/client-runtime/state/objects";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type {
  DesignDocument,
  DesignMutationOp,
  EnvironmentId,
  T3Object,
  T3ObjectDeleteResult,
  T3ObjectId,
  T3ObjectMutationResult,
  T3ObjectReadResult,
  T3ObjectRevisionSummary,
  T3ObjectSummary,
  ThreadId,
} from "@t3tools/contracts";
import { useMessages } from "gt-react";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { formatEnvironmentQueryError, useEnvironmentQuery } from "./query";

const objectsEnvironment = createObjectsEnvironmentAtoms(connectionAtomRuntime);

export function useObjectsEnvironmentState(environmentId: EnvironmentId | null): {
  readonly state: ObjectsEnvironmentState;
  readonly loaded: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
} {
  const resolve = useMessages();
  const query = useEnvironmentQuery(
    environmentId === null
      ? null
      : objectsEnvironment.stream({ environmentId, input: { includeArchived: true } }),
    resolve,
  );
  const state = query.data ?? EMPTY_OBJECTS_ENVIRONMENT_STATE;
  return {
    state,
    loaded: state.loaded,
    error: query.error,
    refresh: query.refresh,
  };
}

export function sortedObjectSummaries(
  state: ObjectsEnvironmentState,
  includeArchived: boolean,
): ReadonlyArray<T3ObjectSummary> {
  return Object.values(state.summariesById)
    .filter((item) => includeArchived || item.archivedAt === null)
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function unwrapCommand<A>(
  promise: Promise<
    | { readonly _tag: "Success"; readonly value: A }
    | { readonly _tag: "Failure"; readonly cause: unknown }
  >,
): Promise<A> {
  const result = await promise;
  if (result._tag === "Success") return result.value;
  return Promise.reject(new Error(formatEnvironmentQueryError(result.cause as never)));
}

export function readT3Object(environmentId: EnvironmentId, id: T3ObjectId): Promise<T3Object> {
  return unwrapCommand(
    runAtomCommand(
      appAtomRegistry,
      objectsEnvironment.read,
      { environmentId, input: { id } },
      { reportFailure: false },
    ),
  ).then((result) => result.object);
}

export function createDesignObject(
  environmentId: EnvironmentId,
  input: {
    readonly title: string;
    readonly document?: DesignDocument | undefined;
    readonly summary?: string | undefined;
    readonly threadId?: ThreadId | null | undefined;
  },
): Promise<T3ObjectMutationResult> {
  return unwrapCommand(
    runAtomCommand(
      appAtomRegistry,
      objectsEnvironment.create,
      {
        environmentId,
        input: {
          kind: "design",
          title: input.title,
          ...(input.document !== undefined ? { document: input.document } : {}),
          ...(input.summary !== undefined ? { summary: input.summary } : {}),
          ...(input.threadId !== undefined ? { threadId: input.threadId } : {}),
        },
      },
      { reportFailure: false },
    ),
  );
}

export function renameT3Object(
  environmentId: EnvironmentId,
  id: T3ObjectId,
  title: string,
): Promise<T3ObjectReadResult> {
  return unwrapCommand(
    runAtomCommand(
      appAtomRegistry,
      objectsEnvironment.rename,
      { environmentId, input: { id, title } },
      { reportFailure: false },
    ),
  );
}

export function setT3ObjectArchived(
  environmentId: EnvironmentId,
  id: T3ObjectId,
  archived: boolean,
): Promise<T3ObjectReadResult> {
  return unwrapCommand(
    runAtomCommand(
      appAtomRegistry,
      objectsEnvironment.setArchived,
      { environmentId, input: { id, archived } },
      { reportFailure: false },
    ),
  );
}

export function deleteT3Object(
  environmentId: EnvironmentId,
  id: T3ObjectId,
): Promise<T3ObjectDeleteResult> {
  return unwrapCommand(
    runAtomCommand(
      appAtomRegistry,
      objectsEnvironment.delete,
      { environmentId, input: { id } },
      { reportFailure: false },
    ),
  );
}

export function mutateDesignObject(
  environmentId: EnvironmentId,
  input: {
    readonly id: T3ObjectId;
    readonly ops: ReadonlyArray<DesignMutationOp>;
    readonly summary: string;
    readonly expectedRevision?: number | undefined;
    readonly threadId?: ThreadId | null | undefined;
  },
): Promise<T3ObjectMutationResult> {
  return unwrapCommand(
    runAtomCommand(
      appAtomRegistry,
      objectsEnvironment.mutateDesign,
      { environmentId, input },
      { reportFailure: false },
    ),
  );
}

export function listT3ObjectRevisions(
  environmentId: EnvironmentId,
  id: T3ObjectId,
  limit = 50,
): Promise<ReadonlyArray<T3ObjectRevisionSummary>> {
  return unwrapCommand(
    runAtomCommand(
      appAtomRegistry,
      objectsEnvironment.listRevisions,
      { environmentId, input: { id, limit } },
      { reportFailure: false },
    ),
  ).then((result) => result.revisions);
}

export function restoreT3ObjectRevision(
  environmentId: EnvironmentId,
  input: {
    readonly id: T3ObjectId;
    readonly revision: number;
    readonly expectedRevision?: number | undefined;
  },
): Promise<T3ObjectMutationResult> {
  return unwrapCommand(
    runAtomCommand(
      appAtomRegistry,
      objectsEnvironment.restoreRevision,
      { environmentId, input },
      { reportFailure: false },
    ),
  );
}
