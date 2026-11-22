import { createFileRoute } from "@tanstack/react-router";

import { ObjectsPage } from "../components/objects/ObjectsPage";

interface ObjectsSearch {
  readonly objectId?: string;
  readonly objectEnvId?: string;
}

export const Route = createFileRoute("/_chat/objects")({
  validateSearch: (search: Record<string, unknown>): ObjectsSearch => ({
    ...(typeof search.objectId === "string" && search.objectId.length > 0
      ? { objectId: search.objectId }
      : {}),
    ...(typeof search.objectEnvId === "string" && search.objectEnvId.length > 0
      ? { objectEnvId: search.objectEnvId }
      : {}),
  }),
  component: ObjectsPage,
});
