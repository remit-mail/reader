import { useNavigate, useParams } from "@tanstack/react-router";
import { useCallback } from "react";
import { useNavigateToBrowsedList } from "./browsed-list";
import { useRetainOpenPanels } from "./fragment";

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

/** Open an outbox message in the reading pane. */
export function useOpenOutboxDraft(): (outboxMessageId: string) => void {
	const navigate = useNavigate();
	const retainPanels = useRetainOpenPanels();

	return useCallback(
		(outboxMessageId: string) => {
			navigate({
				to: "/mail/outbox/draft/$outboxMessageId",
				params: { outboxMessageId },
				search: (prev: Record<string, unknown>) => prev,
				hash: retainPanels,
			});
		},
		[navigate, retainPanels],
	);
}

/** Close it again, landing back on the outbox. */
export function useCloseOutboxDraft(): () => void {
	return useNavigateToBrowsedList();
}
