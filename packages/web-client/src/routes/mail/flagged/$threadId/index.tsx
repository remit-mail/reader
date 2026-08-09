/**
 * The thread with no message named. The pane opens on the newest message, the
 * same as for a thread whose row the reader never pointed at.
 */
import { createFileRoute } from "@tanstack/react-router";
import { FlaggedPane } from "@/components/mail/FlaggedPane";

function FlaggedThreadPane() {
	return <FlaggedPane.Reading />;
}

export const Route = createFileRoute("/mail/flagged/$threadId/")({
	component: FlaggedThreadPane,
});
