import { useParams } from "@tanstack/react-router";

/**
 * The outbox message the reader has open, read off the path.
 *
 * The message is a child route of the list, and the list layout mounts the
 * panes above the `Outlet` — so it asks the router which of its children
 * matched rather than reading a param it does not own. The `from` names a real
 * route, so a segment that does not exist fails to compile.
 */
export function useOutboxDraftId(): string | undefined {
	const draft = useParams({
		from: "/mail/outbox/draft/$outboxMessageId",
		shouldThrow: false,
	});
	return draft?.outboxMessageId;
}
