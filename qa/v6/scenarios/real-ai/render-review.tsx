import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DraftReviewPanelView } from "../../../../apps/web/src/v6/features/draft/Review.tsx";

/** SSR helper: the real view with the state a loaded session produced. */
export function renderReview(state: Parameters<typeof DraftReviewPanelView>[0]["state"]): string {
  return renderToStaticMarkup(
    <DraftReviewPanelView state={state} onRefresh={async () => {}} onConfirm={async () => {}} onRevoke={async () => {}} />,
  );
}
