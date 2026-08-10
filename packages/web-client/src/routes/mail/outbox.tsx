/**
 * /mail/outbox — one of the four list layouts. Two panes, list and reading;
 * there is no intelligence rail for mail that has not been sent yet.
 *
 * The open message is the segment below this one, which is why nothing here
 * reads a selection out of the query.
 */
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { MailShell } from "@/components/layout/MailShell";
import { OutboxPane } from "@/components/mail/OutboxPane";
import { useSearchMirror } from "@/hooks/useSearchMirror";
import { outboxSearchSchema } from "@/lib/mail-search";
import { useOutboxDraftId } from "@/routing";

function OutboxLayout() {
	const outboxMessageId = useOutboxDraftId();
	useSearchMirror({ to: "/mail/outbox" });

	return (
		<OutboxPane outboxMessageId={outboxMessageId}>
			<MailShell
				phone={<OutboxPane.Phone />}
				list={<OutboxPane.List />}
				reading={<Outlet />}
			/>
		</OutboxPane>
	);
}

export const Route = createFileRoute("/mail/outbox")({
	component: OutboxLayout,
	validateSearch: outboxSearchSchema,
});
