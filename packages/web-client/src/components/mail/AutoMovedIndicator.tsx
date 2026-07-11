import type { RemitImapAutoMovedInfo } from "@remit/api-http-client/types.gen.ts";
import { AutoMovedBadge } from "@remit/ui";
import { useAutoMovedBadge } from "@/hooks/useAutoMovedBadge";

interface AutoMovedIndicatorProps {
	accountId: string | undefined;
	messageId: string;
	threadId: string;
	mailboxId: string;
	autoMoved: RemitImapAutoMovedInfo | undefined;
	/** `md` (reading view) adds the inline Undo action; `sm` (list row) is icon + label only. */
	size?: "sm" | "md";
}

/**
 * Renders the "auto-moved by Remit" badge only while the move is still in
 * effect (current mailbox matches the verdict's implied destination) — see
 * `useAutoMovedBadge`. Mount this only when `autoMoved` is present on the row
 * (callers gate with `thread.autoMoved &&`) so rows without a move never pay
 * for the Inbox/Junk mailbox lookups.
 */
export function AutoMovedIndicator({
	accountId,
	messageId,
	threadId,
	mailboxId,
	autoMoved,
	size = "sm",
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
			size={size}
			onUndo={badge.onUndo}
			undoLabel={badge.isUndoing ? "Undoing…" : "Undo"}
		/>
	);
}
