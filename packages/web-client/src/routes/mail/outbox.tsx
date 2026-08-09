/**
 * /mail/outbox — one of the four list layouts. Two panes, list and reading;
 * there is no intelligence rail for mail that has not been sent yet.
 */
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { z } from "zod";
import { MailShell } from "@/components/layout/MailShell";
import { OutboxPane } from "@/components/mail/OutboxPane";
import { useSearchMirror } from "@/hooks/useSearchMirror";

// `selectedOutboxMessageId` is read by `OutboxPane` itself.
//
// `q` is inherited from the parent /mail route; re-declared here so it survives
// this route's own search validation and isn't dropped when navigating with a
// functional search updater.
const outboxSearchSchema = z.object({
	selectedOutboxMessageId: z.string().optional(),
	q: z.string().optional(),
});

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
