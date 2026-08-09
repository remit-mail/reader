/**
 * /mail/outbox — one of the four list layouts. Two panes, list and reading;
 * there is no intelligence rail for mail that has not been sent yet.
 */
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { MailShell } from "@/components/layout/MailShell";
import { OutboxPane } from "@/components/mail/OutboxPane";
import { useSearchMirror } from "@/hooks/useSearchMirror";
import { outboxSearchSchema } from "@/lib/mail-search";

function OutboxLayout() {
	useSearchMirror({ to: "/mail/outbox" });

	return (
		<OutboxPane>
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
