/**
 * The brief's reading pane. It is a route because the pane belongs to the list
 * it was opened from; the thread and message segments arrive under it.
 */
import { createFileRoute } from "@tanstack/react-router";
import { BriefPane } from "@/components/mail/BriefPane";

function BriefReadingPane() {
	return <BriefPane.Reading />;
}

export const Route = createFileRoute("/mail/brief/")({
	component: BriefReadingPane,
});
