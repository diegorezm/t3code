import type { ObjectContextRecord, ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useGT } from "gt-react";
import { ShapesIcon } from "lucide-react";
import { use } from "react";

import { useRightPanelStore } from "~/rightPanelStore";
import { useObjectsEnvironmentState } from "~/state/objects";
import { ComposerContextActionsContext } from "./composerContextActions";
import { ContextChip, ContextChipLabel } from "./ContextChip";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

/**
 * Inline chip for a referenced T3 Object, in the composer and in sent messages.
 * Click opens the object in the current thread's right panel, or in the Objects page
 * when outside an active thread.
 */
export function ObjectContextChip(props: {
  record: Pick<
    ObjectContextRecord,
    "environmentId" | "objectId" | "objectKind" | "title" | "revision"
  >;
  threadRef?: ScopedThreadRef | null | undefined;
  copyMarkdown?: string | undefined;
}) {
  const gt = useGT();
  const navigate = useNavigate();
  const composerActions = use(ComposerContextActionsContext);
  const { state } = useObjectsEnvironmentState(props.record.environmentId);
  const liveSummary = state.summariesById[props.record.objectId];
  const title = liveSummary?.title.trim() || props.record.title;
  const revision = liveSummary?.revision ?? props.record.revision;
  const tooltipText =
    revision !== undefined ? gt("Design Object · v{revision}", { revision }) : gt("Design Object");

  const handleOpen = () => {
    if (props.threadRef) {
      useRightPanelStore.getState().openObject(props.threadRef, {
        objectId: props.record.objectId,
        environmentId: props.record.environmentId,
        title,
      });
      return;
    }
    if (composerActions.openObject) {
      composerActions.openObject({
        objectId: props.record.objectId,
        environmentId: props.record.environmentId,
        title,
      });
      return;
    }
    void navigate({
      to: "/objects",
      search: {
        objectId: props.record.objectId,
        objectEnvId: props.record.environmentId,
      },
    });
  };

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ContextChip
            kind="object"
            render={<button type="button" />}
            aria-label={gt("Open object {title}", { title })}
            data-markdown-copy={props.copyMarkdown}
            onClick={handleOpen}
          >
            <ShapesIcon />
            <ContextChipLabel>{title}</ContextChipLabel>
          </ContextChip>
        }
      />
      <TooltipPopup side="top">{tooltipText}</TooltipPopup>
    </Tooltip>
  );
}
