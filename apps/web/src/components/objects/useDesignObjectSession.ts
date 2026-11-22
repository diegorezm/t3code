import {
  emptyDesignDocument,
  type DesignDocument,
  type DesignMutationOp,
  type DesignNodeId,
  type EnvironmentId,
  type T3Object,
  type T3ObjectId,
  type T3ObjectRevisionSummary,
} from "@t3tools/contracts";
import { applyDesignMutations } from "@t3tools/shared/designDocument";
import { useEffect, useRef, useState } from "react";

import {
  listT3ObjectRevisions,
  mutateDesignObject,
  readT3Object,
  renameT3Object,
  restoreT3ObjectRevision,
  useCanMutateObjects,
  useObjectsEnvironmentState,
} from "~/state/objects";
import { findPreviousRevision } from "./designEditorTypes";

export interface HistoryNavState {
  readonly trackedRevision: number;
  readonly logicalRevision: number;
  readonly redoStack: ReadonlyArray<number>;
}

export function useDesignObjectSession(input: {
  readonly environmentId: EnvironmentId;
  readonly objectId: T3ObjectId;
  readonly historyVisible: boolean;
  readonly onAutoSelectIds: (ids: ReadonlyArray<DesignNodeId>) => void;
}) {
  const { environmentId, objectId, historyVisible, onAutoSelectIds } = input;
  const { state: envState } = useObjectsEnvironmentState(environmentId);
  const canMutate = useCanMutateObjects(environmentId);
  const streamedSummary = envState.summariesById[objectId] ?? null;

  const [fetchedEntry, setFetchedEntry] = useState<{
    readonly key: string;
    readonly object: T3Object;
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [optimisticDoc, setOptimisticDoc] = useState<DesignDocument | null>(null);
  const [revisions, setRevisions] = useState<ReadonlyArray<T3ObjectRevisionSummary>>([]);
  const [loadedRevisionsKey, setLoadedRevisionsKey] = useState<string | null>(null);
  const [historyNav, setHistoryNav] = useState<HistoryNavState | null>(null);

  const inFlightMutationsRef = useRef(0);
  const latestOptimisticDocRef = useRef<DesignDocument | null>(null);

  const objectKey = `${environmentId}:${objectId}`;
  const fetchedObject = fetchedEntry?.key === objectKey ? fetchedEntry.object : null;

  const activeObject: T3Object | null =
    fetchedObject !== null &&
    streamedSummary !== null &&
    streamedSummary.revision === fetchedObject.revision
      ? {
          ...fetchedObject,
          title: streamedSummary.title,
          archivedAt: streamedSummary.archivedAt,
          updatedAt: streamedSummary.updatedAt,
        }
      : fetchedObject;

  const currentDoc: DesignDocument =
    optimisticDoc ?? activeObject?.content.document ?? emptyDesignDocument();

  const streamedRevision = streamedSummary?.revision ?? null;
  const remoteFetchRevision =
    fetchedObject === null
      ? 0
      : streamedRevision !== null && streamedRevision > fetchedObject.revision
        ? streamedRevision
        : null;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads the full object document on mount or when the summary stream advances past our cached revision
  useEffect(() => {
    if (remoteFetchRevision === null) return;
    if (remoteFetchRevision > 0 && inFlightMutationsRef.current > 0) return;
    let cancelled = false;
    void readT3Object(environmentId, objectId).then(
      (object) => {
        if (cancelled) return;
        setFetchedEntry({ key: objectKey, object });
        setLoadError(null);
      },
      (error: unknown) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : String(error));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [environmentId, objectId, objectKey, remoteFetchRevision]);

  const activeRevision = activeObject?.revision ?? null;
  const targetRevisionsKey =
    activeRevision === null ? null : `${environmentId}:${objectId}:${activeRevision}`;
  const revisionsFresh = targetRevisionsKey !== null && loadedRevisionsKey === targetRevisionsKey;
  const revisionsLoading = historyVisible && targetRevisionsKey !== null && !revisionsFresh;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- lazily loads the revision timeline only while the History tab is visible
  useEffect(() => {
    if (!historyVisible || targetRevisionsKey === null || revisionsFresh) return;
    let cancelled = false;
    void listT3ObjectRevisions(environmentId, objectId, 60).then(
      (list) => {
        if (cancelled) return;
        setRevisions(list);
        setLoadedRevisionsKey(targetRevisionsKey);
      },
      () => {
        if (cancelled) return;
        setLoadedRevisionsKey(targetRevisionsKey);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [environmentId, objectId, historyVisible, targetRevisionsKey, revisionsFresh]);

  const hasMatchingHistoryNav =
    historyNav !== null &&
    activeObject !== null &&
    historyNav.trackedRevision === activeObject.revision;
  const logicalRevision = hasMatchingHistoryNav
    ? historyNav.logicalRevision
    : (activeObject?.revision ?? null);
  const redoStack = hasMatchingHistoryNav ? historyNav.redoStack : [];
  const loadedUndoTarget =
    logicalRevision !== null && revisionsFresh
      ? findPreviousRevision(revisions, logicalRevision)
      : null;
  const canUndo =
    canMutate &&
    logicalRevision !== null &&
    (revisionsFresh ? loadedUndoTarget !== null : logicalRevision > 1);
  const redoTarget = redoStack[redoStack.length - 1] ?? null;
  const canRedo = canMutate && redoTarget !== null;

  const commitOps = (
    ops: ReadonlyArray<DesignMutationOp>,
    summary: string,
    options?: { readonly selectIds?: ReadonlyArray<DesignNodeId> },
  ) => {
    if (activeObject === null || !canMutate) return;
    const baseDoc = latestOptimisticDocRef.current ?? currentDoc;
    const isFirstInFlight = inFlightMutationsRef.current === 0;
    const preview = applyDesignMutations(baseDoc, ops);
    if (preview.ok) {
      latestOptimisticDocRef.current = preview.document;
      setOptimisticDoc(preview.document);
      if (options?.selectIds !== undefined) {
        onAutoSelectIds(options.selectIds);
      } else if (preview.createdIds.length > 0) {
        const lastCreated = preview.createdIds[preview.createdIds.length - 1];
        onAutoSelectIds(lastCreated !== undefined ? [lastCreated] : []);
      }
    }
    inFlightMutationsRef.current += 1;
    setActionError(null);
    void mutateDesignObject(environmentId, {
      id: objectId,
      ops,
      summary,
      // Only guard with expectedRevision on the first mutation in a burst; rapid consecutive edits
      // are already serialized per object by the client command scheduler.
      ...(isFirstInFlight ? { expectedRevision: activeObject.revision } : {}),
    }).then(
      (result) => {
        inFlightMutationsRef.current = Math.max(0, inFlightMutationsRef.current - 1);
        setFetchedEntry((prev) =>
          prev === null || prev.key !== objectKey || result.object.revision >= prev.object.revision
            ? { key: objectKey, object: result.object }
            : prev,
        );
        if (inFlightMutationsRef.current === 0) {
          latestOptimisticDocRef.current = null;
          setOptimisticDoc(null);
        }
        setHistoryNav(null);
      },
      (error: unknown) => {
        inFlightMutationsRef.current = Math.max(0, inFlightMutationsRef.current - 1);
        setActionError(error instanceof Error ? error.message : String(error));
        if (inFlightMutationsRef.current === 0) {
          latestOptimisticDocRef.current = null;
          setOptimisticDoc(null);
          void readT3Object(environmentId, objectId).then(
            (latest) => setFetchedEntry({ key: objectKey, object: latest }),
            () => undefined,
          );
        }
      },
    );
  };

  const restoreRevision = (
    targetRevision: number,
    nextNav: ((newRevision: number) => HistoryNavState | null) | null,
  ) => {
    if (activeObject === null || !canMutate) return;
    setActionError(null);
    void restoreT3ObjectRevision(environmentId, {
      id: objectId,
      revision: targetRevision,
      ...(inFlightMutationsRef.current === 0 ? { expectedRevision: activeObject.revision } : {}),
    }).then(
      (result) => {
        latestOptimisticDocRef.current = null;
        setFetchedEntry({ key: objectKey, object: result.object });
        setOptimisticDoc(null);
        setHistoryNav(nextNav ? nextNav(result.object.revision) : null);
      },
      (error: unknown) => {
        setActionError(error instanceof Error ? error.message : String(error));
      },
    );
  };

  const handleUndo = () => {
    if (!canUndo || logicalRevision === null) return;
    const applyUndo = (target: number) => {
      const nextRedo = [...redoStack.slice(-29), logicalRevision];
      restoreRevision(target, (newRevision) => ({
        trackedRevision: newRevision,
        logicalRevision: target,
        redoStack: nextRedo,
      }));
    };
    if (loadedUndoTarget !== null) {
      applyUndo(loadedUndoTarget);
      return;
    }
    void listT3ObjectRevisions(environmentId, objectId, 60).then(
      (list) => {
        setRevisions(list);
        if (targetRevisionsKey !== null) {
          setLoadedRevisionsKey(targetRevisionsKey);
        }
        const target = findPreviousRevision(list, logicalRevision);
        if (target !== null) {
          applyUndo(target);
        }
      },
      (error: unknown) => {
        setActionError(error instanceof Error ? error.message : String(error));
      },
    );
  };

  const handleRedo = () => {
    if (!canRedo || redoTarget === null) return;
    const nextRedo = redoStack.slice(0, -1);
    restoreRevision(redoTarget, (newRevision) => ({
      trackedRevision: newRevision,
      logicalRevision: redoTarget,
      redoStack: nextRedo,
    }));
  };

  const renameTitle = (nextTitle: string) => {
    if (activeObject === null || !canMutate) return;
    const trimmed = nextTitle.trim();
    if (trimmed.length === 0 || trimmed === activeObject.title) return;
    void renameT3Object(environmentId, objectId, trimmed).then(
      (result) => setFetchedEntry({ key: objectKey, object: result.object }),
      (error: unknown) => {
        setActionError(error instanceof Error ? error.message : String(error));
      },
    );
  };

  return {
    activeObject,
    currentDoc,
    canMutate,
    loadError,
    actionError,
    setActionError,
    revisions,
    revisionsLoading,
    canUndo,
    canRedo,
    commitOps,
    restoreRevision,
    handleUndo,
    handleRedo,
    renameTitle,
  };
}
