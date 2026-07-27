import type { RemitImapAutoMovedInfo } from "@remit/api-http-client/types.gen.ts";
import { AutoMovedBadge } from "@remit/ui";
import { useAutoMovedBadge } from "@/hooks/useAutoMovedBadge";

interface AutoMovedIndicatorProps {
	accountId: string | undefined;
	messageId: string;
	threadId: string;
	mailboxId: string;
	autoMoved: RemitImapAutoMovedInfo | undefined;
}

/**
 * Renders the "auto-moved by Remit" badge on the open message only while the
 * move is still in effect (current mailbox matches the verdict's implied
 * destination) — see `useAutoMovedBadge`. Mailbox list rows deliberately do not
 * show it: there the move is noise, and here it carries the Undo and
 * Manage-filter actions. Mount this only when `autoMoved` is present (callers
 * gate with `threadMessage.autoMoved &&`) so messages without a move never pay
 * for the Inbox/Junk mailbox lookups.
 */
export function AutoMovedIndicator({
	accountId,
	messageId,
	threadId,
	mailboxId,
	autoMoved,
}: AutoMovedIndicatorProps) {
	const badge = useAutoMovedBadge({
		accountId,
		messageId,
		threadId,
		mailboxId,
		autoMoved,
	});

	if (!badge.show) return null;

	return (
		<AutoMovedBadge
			label={badge.label}
			onUndo={badge.onUndo}
			undoLabel={badge.isUndoing ? "Undoing…" : "Undo"}
			filtersHref={badge.filtersHref}
		/>
	);
}
