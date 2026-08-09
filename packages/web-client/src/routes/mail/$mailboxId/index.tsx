import { createFileRoute } from "@tanstack/react-router";
import { MailboxPane } from "@/components/mail/MailboxPane";

export const Route = createFileRoute("/mail/$mailboxId/")({
	component: MailboxPane.Reading,
});
