/**
 * The thread with no message named. The pane opens on the newest message, the
 * same as for a thread whose row the reader never pointed at.
 */
import { createFileRoute } from "@tanstack/react-router";
import { BriefPane } from "@/components/mail/BriefPane";

function BriefThreadPane() {
	return <BriefPane.Reading />;
}

export const Route = createFileRoute("/mail/brief/$threadId/")({
	component: BriefThreadPane,
});
