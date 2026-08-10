/**
 * /mail/$mailboxId/$threadId/$messageId — the same conversation, with one of its
 * messages expanded and scrolled to.
 *
 * A message is not addressable on its own: `GET /messages/{messageId}` answers
 * with no thread, so the pane has nothing to fetch by. The segment names which
 * message inside the thread the reader pointed at, and the surface it renders is
 * the thread's.
 */
import { createFileRoute } from "@tanstack/react-router";
import { MailboxPane } from "@/components/mail/MailboxPane";

function MailboxMessagePane() {
	return <MailboxPane.Reading />;
}

export const Route = createFileRoute("/mail/$mailboxId/$threadId/$messageId")({
	component: MailboxMessagePane,
});
