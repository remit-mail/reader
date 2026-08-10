/**
 * The thread with no message named. The pane opens on the newest message, the
 * same as for a thread whose row the reader never pointed at.
 */
import { createFileRoute } from "@tanstack/react-router";
import { MailboxPane } from "@/components/mail/MailboxPane";

function MailboxThreadPane() {
	return <MailboxPane.Reading />;
}

export const Route = createFileRoute("/mail/$mailboxId/$threadId/")({
	component: MailboxThreadPane,
});
