import { useAtomValue } from "@effect/atom-react";
import {
  DesignNodeId,
  T3ObjectId,
  emptyDesignDocument,
  type EnvironmentId,
} from "@t3tools/contracts";
import { applyDesignMutations } from "@t3tools/shared/designDocument";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { msg, T, useGT } from "gt-react";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  LayersIcon,
  PlusIcon,
  ShapesIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { Input } from "~/components/ui/input";
import { SidebarInset } from "~/components/ui/sidebar";
import { Spinner } from "~/components/ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbText,
} from "~/components/WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "~/components/WorkspacePageContainer";
import { WorkspacePageHeader } from "~/components/WorkspacePageHeader";
import { environmentCatalog } from "~/connection/catalog";
import { isElectron } from "~/env";
import { m } from "~/i18n/messages";
import {
  createDesignObject,
  deleteT3Object,
  setT3ObjectArchived,
  sortedObjectSummaries,
  useCanMutateObjects,
  useObjectsEnvironmentState,
} from "~/state/objects";
import { primaryEnvironmentIdAtom } from "~/state/primaryEnvironment";
import { DesignObjectWorkspace } from "./DesignObjectWorkspace";

function makeStarterDesignDocument() {
  const result = applyDesignMutations(emptyDesignDocument(), [
    {
      op: "add",
      node: {
        id: DesignNodeId.make("frame-1"),
        type: "frame",
        name: "Desktop Artboard",
        x: 0,
        y: 0,
        width: 960,
        height: 560,
        fill: "#111522",
        stroke: "#1f2937",
        strokeWidth: 1,
        radius: 16,
        layout: { direction: "vertical", gap: 20, padding: 40, alignItems: "start" },
      },
    },
    {
      op: "add",
      node: {
        id: DesignNodeId.make("heading-1"),
        type: "text",
        name: "Headline",
        parentId: DesignNodeId.make("frame-1"),
        width: 640,
        height: 52,
        text: m(msg("Design together with your agents")),
        color: "#f8fafc",
        fontSize: 36,
        fontWeight: 700,
        lineHeight: 1.2,
      },
    },
    {
      op: "add",
      node: {
        id: DesignNodeId.make("sub-1"),
        type: "text",
        name: "Subtitle",
        parentId: DesignNodeId.make("frame-1"),
        width: 560,
        height: 48,
        text: m(
          msg(
            "Ask any agent to build or iterate on this canvas, edit directly with tools and inspector, or export SVG to Figma.",
          ),
        ),
        color: "#94a3b8",
        fontSize: 16,
        fontWeight: 400,
        lineHeight: 1.5,
      },
    },
  ]);
  return result.ok ? result.document : emptyDesignDocument();
}

function useActiveObjectsEnvironmentId(preferred?: string): EnvironmentId | null {
  const primaryId = useAtomValue(primaryEnvironmentIdAtom);
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  if (preferred !== undefined) {
    for (const envId of catalog.entries.keys()) {
      if (envId === preferred) return envId;
    }
  }
  if (primaryId !== null) return primaryId;
  for (const envId of catalog.entries.keys()) {
    return envId;
  }
  return null;
}

export function ObjectsPage() {
  const gt = useGT();
  const navigate = useNavigate();
  const search = useSearch({ from: "/_chat/objects" });
  const environmentId = useActiveObjectsEnvironmentId(search.objectEnvId);
  const { state, loaded, error } = useObjectsEnvironmentState(environmentId);
  const canMutate = useCanMutateObjects(environmentId);

  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);

  const activeObjectId =
    search.objectId !== undefined && search.objectId.length > 0
      ? T3ObjectId.make(search.objectId)
      : null;

  const openObject = (id: T3ObjectId | null) => {
    void navigate({
      to: "/objects",
      search:
        id === null
          ? {}
          : { objectId: id, ...(environmentId ? { objectEnvId: environmentId } : {}) },
    });
  };

  if (environmentId === null) {
    return (
      <SidebarInset className="flex h-dvh items-center justify-center">
        <p className="text-sm text-muted-foreground">
          <T>Connect to a T3 Code environment to browse Objects.</T>
        </p>
      </SidebarInset>
    );
  }

  if (activeObjectId !== null) {
    return (
      <SidebarInset className="flex h-dvh min-h-0 flex-col overflow-hidden">
        <DesignObjectWorkspace
          environmentId={environmentId}
          objectId={activeObjectId}
          reserveWindowControls={isElectron}
          onBack={() => openObject(null)}
        />
      </SidebarInset>
    );
  }

  const allSummaries = sortedObjectSummaries(state, showArchived);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleObjects =
    normalizedQuery.length === 0
      ? allSummaries
      : allSummaries.filter((item) => item.title.toLowerCase().includes(normalizedQuery));

  const handleCreate = () => {
    setCreating(true);
    void createDesignObject(environmentId, {
      title: gt("Untitled Design"),
      document: makeStarterDesignDocument(),
      summary: gt("Created design canvas"),
    }).then(
      (result) => {
        setCreating(false);
        openObject(result.object.id);
      },
      () => {
        setCreating(false);
      },
    );
  };

  return (
    <SidebarInset className="flex h-dvh min-h-0 flex-col overflow-hidden">
      <WorkspacePageHeader
        electron={isElectron}
        reserveNativeControls={isElectron}
        className="border-b border-border/60"
      >
        <WorkspaceBreadcrumb ariaLabel={gt("Objects")} className="min-w-0 flex-1">
          <WorkspaceBreadcrumbItem current>
            <WorkspaceBreadcrumbText>
              <T>Objects</T>
            </WorkspaceBreadcrumbText>
          </WorkspaceBreadcrumbItem>
        </WorkspaceBreadcrumb>

        <div className="flex items-center gap-2 [-webkit-app-region:no-drag]">
          <Button size="xs" disabled={!canMutate || creating} onClick={handleCreate}>
            <PlusIcon className="size-3.5" />
            <span>
              <T>New design</T>
            </span>
          </Button>
        </div>
      </WorkspacePageHeader>

      <div className="topbar-scroll-fade scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto">
        <WorkspacePageContainer width="wide" className="min-h-full gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-48 flex-1">
              <Input
                size="sm"
                placeholder={gt("Search objects...")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <Button
              size="sm"
              variant={showArchived ? "secondary" : "outline"}
              onClick={() => setShowArchived(!showArchived)}
            >
              <ArchiveIcon className="size-3.5" />
              <span>{showArchived ? <T>Archived shown</T> : <T>Archived</T>}</span>
            </Button>
          </div>

          {error !== null ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          ) : null}

          {!loaded ? (
            <div className="flex flex-1 items-center justify-center py-16 text-muted-foreground">
              <Spinner size="md" />
            </div>
          ) : visibleObjects.length === 0 ? (
            <Empty size="compact">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ShapesIcon />
                </EmptyMedia>
                <EmptyTitle>
                  {normalizedQuery.length > 0 ? <T>No matching objects</T> : <T>No objects yet</T>}
                </EmptyTitle>
                <EmptyDescription>
                  {normalizedQuery.length > 0 ? (
                    <T>Try a different search term or toggle archived objects.</T>
                  ) : (
                    <T>Create a design canvas here, or ask an agent in any thread to make one.</T>
                  )}
                </EmptyDescription>
              </EmptyHeader>
              {normalizedQuery.length === 0 ? (
                <EmptyContent>
                  <Button size="sm" disabled={!canMutate || creating} onClick={handleCreate}>
                    <PlusIcon className="size-3.5" />
                    <span>
                      <T>New design</T>
                    </span>
                  </Button>
                </EmptyContent>
              ) : null}
            </Empty>
          ) : (
            <div className="flex flex-col divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-background">
              {visibleObjects.map((item) => {
                const isArchived = item.archivedAt !== null;
                return (
                  <div
                    key={item.id}
                    className="group flex items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-accent/40"
                  >
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none"
                      onClick={() => openObject(item.id)}
                    >
                      <LayersIcon className="size-4 shrink-0 text-muted-foreground" />
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-foreground">
                            {item.title}
                          </span>
                          {isArchived ? (
                            <span className="shrink-0 text-2xs text-muted-foreground">
                              <T>Archived</T>
                            </span>
                          ) : null}
                        </div>
                        <span className="truncate text-xs text-muted-foreground">
                          <span className="capitalize">{item.kind}</span>
                          {" · "}
                          {gt("{count, plural, one {{count} layer} other {{count} layers}}", {
                            count: item.nodeCount,
                          })}
                          {" · "}v{item.revision}
                          {" · "}
                          {new Date(item.updatedAt).toLocaleDateString()}
                        </span>
                      </div>
                    </button>

                    <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              disabled={!canMutate}
                              aria-label={isArchived ? gt("Unarchive") : gt("Archive")}
                              onClick={() => {
                                void setT3ObjectArchived(environmentId, item.id, !isArchived);
                              }}
                            />
                          }
                        >
                          {isArchived ? (
                            <ArchiveRestoreIcon className="size-3.5" />
                          ) : (
                            <ArchiveIcon className="size-3.5" />
                          )}
                        </TooltipTrigger>
                        <TooltipPopup>
                          {isArchived ? <T>Unarchive</T> : <T>Archive</T>}
                        </TooltipPopup>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              size="icon-xs"
                              variant="ghost-destructive"
                              disabled={!canMutate}
                              aria-label={gt("Delete")}
                              onClick={() => {
                                void deleteT3Object(environmentId, item.id);
                              }}
                            />
                          }
                        >
                          <Trash2Icon className="size-3.5" />
                        </TooltipTrigger>
                        <TooltipPopup>
                          <T>Delete</T>
                        </TooltipPopup>
                      </Tooltip>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </WorkspacePageContainer>
      </div>
    </SidebarInset>
  );
}
