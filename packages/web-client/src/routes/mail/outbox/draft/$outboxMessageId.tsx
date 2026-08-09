/**
 * /mail/outbox/draft/$outboxMessageId — one outbox message open in the
 * reading pane.
 *
 * An outbox message is addressable on its own: it belongs to no thread and no
 * folder, so the id is the whole address. The `draft/` prefix keeps the id in a
 * named segment, so the literal siblings the outbox will grow stay
 * distinguishable from it.
 */
import { createFileRoute } from "@tanstack/react-router";
import { OutboxPane } from "@/components/mail/OutboxPane";

function OutboxDraftPane() {
	return <OutboxPane.Reading />;
}

export const Route = createFileRoute("/mail/outbox/draft/$outboxMessageId")({
	component: OutboxDraftPane,
});
