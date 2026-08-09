import { createFileRoute } from "@tanstack/react-router";
import { MailboxPane } from "@/components/mail/MailboxPane";

function MailboxReadingPane() {
	return <MailboxPane.Reading />;
}

export const Route = createFileRoute("/mail/$mailboxId/")({
	component: MailboxReadingPane,
});
