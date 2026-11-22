import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect, useRef } from "react";

import { useRightPanelStore } from "~/rightPanelStore";
import { useObjectsEnvironmentState } from "~/state/objects";

/**
 * Watches an environment's live Objects stream and opens an object tab in the
 * calling thread's Right Panel whenever an agent calls `t3_object_create` or `t3_object_open`.
 */
export function AgentOpenedObjectsObserver({
  environmentId,
}: {
  readonly environmentId: EnvironmentId | null;
}) {
  const { state } = useObjectsEnvironmentState(environmentId);
  const lastSeqRef = useRef(0);
  const request = state.lastOpenRequest;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reacts to server-pushed openRequested events by opening the object tab in the Right Panel store
  useEffect(() => {
    if (environmentId === null || request === null) return;
    if (request.seq <= lastSeqRef.current) return;
    lastSeqRef.current = request.seq;
    if (request.threadId === null) return;
    const summary = state.summariesById[request.id];
    useRightPanelStore.getState().openObject(scopeThreadRef(environmentId, request.threadId), {
      objectId: request.id,
      environmentId,
      ...(summary !== undefined ? { title: summary.title } : {}),
    });
  }, [environmentId, request, state.summariesById]);

  return null;
}
