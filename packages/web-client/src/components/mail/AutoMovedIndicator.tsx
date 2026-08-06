import type {
	RemitImapAutoMovedInfo,
	RemitImapMessageSpamReport,
} from "@remit/api-http-client/types.gen.ts";
import { AutoMovedBadge } from "@remit/ui";
import { useAutoMovedBadge } from "@/hooks/useAutoMovedBadge";

interface AutoMovedIndicatorProps {
	accountId: string | undefined;
	messageId: string;
	threadId: string;
	mailboxId: string;
	autoMoved: RemitImapAutoMovedInfo | undefined;
	spamReport: RemitImapMessageSpamReport | undefined;
}

/**
 * Renders the "auto-moved by Remit" / "Reported as spam" badge on the open
 * message only while the underlying state is still in effect — see
 * `useAutoMovedBadge`. Mailbox list rows deliberately do not show it: there
 * the indicator is noise, and here it carries the Undo and Manage-filter
 * actions. Mount this only when `autoMoved` or `spamReport` is present
 * (callers gate with `threadMessage.autoMoved || threadMessage.spamReport`)
 * so messages with neither never pay for the Inbox/Junk mailbox lookups.
 */
export function AutoMovedIndicator({
	accountId,
	messageId,
	threadId,
	mailboxId,
	autoMoved,
	spamReport,
}: AutoMovedIndicatorProps) {
	const badge = useAutoMovedBadge({
		accountId,
		messageId,
		threadId,
		mailboxId,
		autoMoved,
		spamReport,
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
