import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import {
	type Density,
	type SelectionModifiers,
	SwipeableRow,
	type SwipePeek,
	type ThreadRowData,
	useModifierSelect,
} from "@remit/ui";
import { Link } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { toDisplayCategory } from "@/lib/display-category";
import { formatEmailDate } from "@/lib/format";
import { MessageListItem } from "./MessageListItem";

interface MailboxLinkSearch {
	selectedMessageId?: string;
	q?: string;
}

interface SwipeableMessageRowProps {
	thread: RemitImapThreadMessageResponse;
	mailboxId: string;
	isSelected: boolean;
	/** Roving keyboard focus cursor — renders the left accent rail (#429). */
	isFocused?: boolean;
	/** The one row in the tab order (roving tabindex). */
	isTabStop?: boolean;
	/** Called when the row takes DOM focus, so the cursor follows it. */
	onFocusRow?: (messageId: string) => void;
	isChecked: boolean;
	onToggleCheck: (id: string) => void;
	onRowSelect: (messageId: string, modifiers: SelectionModifiers) => boolean;
	isMultiSelectMode: boolean;
	onLongPress: (messageId: string) => void;
	isDesktop: boolean;
	onDelete: (messageId: string) => void;
	onToggleRead: (messageId: string, currentIsRead: boolean) => void;
	density?: Density;
}

const toThreadRowData = (
	thread: RemitImapThreadMessageResponse,
): ThreadRowData => {
	const suspicious = thread.authenticity?.dkimMismatch === true;
	return {
		id: thread.messageId,
		accountId: thread.accountId,
		fromName: thread.fromName ?? thread.fromEmail ?? "Unknown",
		fromEmail: thread.fromEmail ?? "",
		subject: thread.subject ?? "(No subject)",
		snippet: thread.snippet ?? "",
		timeLabel: formatEmailDate(thread.sentDate),
		isRead: thread.isRead,
		hasAttachment: thread.hasAttachment,
		starred: thread.hasStars === true,
		trust: thread.senderTrust,
		category: toDisplayCategory(thread.category),
		suspicious,
	};
};

export const SwipeableMessageRow = ({
	thread,
	mailboxId,
	isSelected,
	isFocused,
	isTabStop,
	onFocusRow,
	isChecked,
	onToggleCheck,
	onRowSelect,
	isMultiSelectMode,
	onLongPress,
	isDesktop,
	onDelete,
	onToggleRead,
	density,
}: SwipeableMessageRowProps) => {
	const [peek, setPeek] = useState<SwipePeek>("none");

	const handleAct = useCallback(
		(side: "leading" | "trailing") => {
			navigator.vibrate?.(10);
			if (side === "trailing") {
				onDelete(thread.messageId);
			} else {
				onToggleRead(thread.messageId, thread.isRead);
			}
			setPeek("none");
		},
		[onDelete, onToggleRead, thread.messageId, thread.isRead],
	);

	const handleLongPress = useCallback(() => {
		onLongPress(thread.messageId);
	}, [onLongPress, thread.messageId]);

	const handleToggleCheck = useCallback(() => {
		onToggleCheck(thread.messageId);
	}, [onToggleCheck, thread.messageId]);

	// The swipe row is the layout tier's row, not the input device's: a mouse at
	// a narrow width still gets it, and a shift or cmd click on it belongs to
	// selection rather than to the anchor's own new-window/new-tab gesture.
	const modifierSelect = useModifierSelect(thread.messageId, onRowSelect);

	if (isDesktop || isMultiSelectMode) {
		return (
			<MessageListItem
				thread={thread}
				mailboxId={mailboxId}
				isSelected={isSelected}
				isFocused={isFocused}
				isTabStop={isTabStop}
				onFocusRow={onFocusRow}
				isChecked={isChecked}
				onToggleCheck={onToggleCheck}
				onRowSelect={onRowSelect}
				isMultiSelectMode={isMultiSelectMode}
				onLongPress={onLongPress}
				isDesktop={isDesktop}
				density={density}
			/>
		);
	}

	return (
		<SwipeableRow
			thread={toThreadRowData(thread)}
			selectionMode={false}
			checked={false}
			active={isSelected}
			peek={peek}
			onPeek={setPeek}
			onToggleCheck={handleToggleCheck}
			onLongPress={handleLongPress}
			onOpen={() => undefined}
			onAct={handleAct}
			linkComponent={({ onOpenClick, children, ...rowProps }) => (
				<Link
					{...rowProps}
					to="/mail/$mailboxId"
					params={{ mailboxId }}
					search={(prev: MailboxLinkSearch) => ({
						...prev,
						selectedMessageId: thread.messageId,
					})}
					data-message-row
					onMouseDown={modifierSelect.onMouseDown}
					onContextMenu={modifierSelect.onContextMenu}
					onClick={(e) => {
						if (modifierSelect.claimClick(e)) return;
						onOpenClick(e);
					}}
				>
					{children}
				</Link>
			)}
		/>
	);
};
