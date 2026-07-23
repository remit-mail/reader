/**
 * MessageListItem — the mailbox list's adapter onto the shared `MessageRow`.
 *
 * It maps an API thread to the row's `ThreadRowData` shape and supplies the two
 * things only the mailbox list has: route-linking rows and the auto-moved
 * badge. Everything visual and interactive lives in `MessageRow`, which the
 * brief and Flagged render too.
 */
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import type { Density, SenderTrustLevel, ThreadRowData } from "@remit/ui";
import { memo } from "react";
import type { SelectionModifiers } from "@/hooks/useSelection";
import { toDisplayCategory } from "@/lib/display-category";
import { formatEmailDate } from "@/lib/format";
import { AutoMovedIndicator } from "./AutoMovedIndicator";
import { MessageRow } from "./MessageRow";

interface MessageListItemProps {
	thread: RemitImapThreadMessageResponse;
	mailboxId: string;
	/** Owning account, used to resolve the Inbox/Junk mailboxes for the auto-moved badge's undo action. */
	accountId?: string;
	isSelected: boolean;
	isFocused?: boolean;
	isTabStop?: boolean;
	onFocusRow?: (messageId: string) => void;
	isChecked: boolean;
	onToggleCheck: (id: string) => void;
	onRowSelect: (messageId: string, modifiers: SelectionModifiers) => boolean;
	messageCount?: number;
	isMultiSelectMode?: boolean;
	onLongPress?: (messageId: string) => void;
	isDesktop?: boolean;
	density?: Density;
}

/**
 * Map a RemitImapThreadMessageResponse to the ThreadRowData shape the shared
 * row renders.
 */
export const threadToRowData = (
	thread: RemitImapThreadMessageResponse,
	messageCount?: number,
): ThreadRowData => ({
	id: thread.messageId,
	accountId: thread.accountConfigId,
	mailboxId: thread.mailboxId,
	fromName: thread.fromName ?? thread.fromEmail ?? "Unknown",
	fromEmail: thread.fromEmail ?? "",
	subject: thread.subject ?? "(No subject)",
	snippet: thread.snippet ?? "",
	timeLabel: formatEmailDate(thread.sentDate),
	isRead: thread.isRead,
	hasAttachment: thread.hasAttachment,
	starred: thread.hasStars === true,
	trust: thread.senderTrust as SenderTrustLevel,
	category: toDisplayCategory(thread.category),
	messageCount,
	// The backend's DKIM-alignment verdict is authoritative: it already accounts
	// for the multi-signature / alignment semantics a single string compare
	// misses.
	suspicious: thread.authenticity?.dkimMismatch === true,
});

const MessageListItemComponent = ({
	thread,
	mailboxId,
	accountId,
	isSelected,
	isFocused,
	isTabStop,
	onFocusRow,
	isChecked,
	onToggleCheck,
	onRowSelect,
	messageCount,
	isMultiSelectMode,
	onLongPress,
	isDesktop,
	density,
}: MessageListItemProps) => (
	<MessageRow
		thread={threadToRowData(thread, messageCount)}
		linkMailboxId={mailboxId}
		active={isSelected}
		focused={isFocused}
		isTabStop={isTabStop}
		density={density}
		isDesktop={isDesktop}
		onFocusRow={onFocusRow}
		selection={{
			isChecked,
			onToggleCheck,
			onRowSelect,
			isMultiSelectMode,
			onLongPress,
		}}
		badge={
			thread.autoMoved ? (
				<AutoMovedIndicator
					accountId={accountId}
					messageId={thread.messageId}
					threadId={thread.threadId}
					mailboxId={thread.mailboxId}
					autoMoved={thread.autoMoved}
					size="sm"
				/>
			) : undefined
		}
	/>
);

export const MessageListItem = memo(MessageListItemComponent);
