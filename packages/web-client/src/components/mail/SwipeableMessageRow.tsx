import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import {
	type Density,
	type SelectionModifiers,
	SwipeableRow,
	type SwipePeek,
	type ThreadRowData,
} from "@remit/ui";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { toDisplayCategory } from "@/lib/display-category";
import { formatEmailDate } from "@/lib/format";
import { MessageListItem } from "./MessageListItem";
import { useModifierSelect } from "./useModifierSelect";

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
	const navigate = useNavigate();

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

	const handleOpen = useCallback(() => {
		navigate({
			to: "/mail/$mailboxId",
			params: { mailboxId },
			search: (prev: MailboxLinkSearch) => ({
				...prev,
				selectedMessageId: thread.messageId,
			}),
		});
	}, [navigate, mailboxId, thread.messageId]);

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

	// The swipe row reads the press as a pointer gesture, and it opens the message
	// from the release — a `mousedown` handler on the row would already be behind
	// it. Taking the modified press in the capture phase keeps it away from the
	// gesture entirely, so a shift- or cmd-click selects instead of starting a
	// swipe, a long press or an open.
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: the wrapper only intercepts mouse modifiers ahead of the row's own gesture; the row beneath keeps the button semantics and the whole keyboard path
		<div
			role="presentation"
			onPointerDownCapture={modifierSelect.onMouseDown}
			onClickCapture={modifierSelect.claimClick}
			onContextMenu={modifierSelect.onContextMenu}
		>
			<SwipeableRow
				thread={toThreadRowData(thread)}
				selectionMode={false}
				checked={false}
				active={isSelected}
				peek={peek}
				onPeek={setPeek}
				onToggleCheck={handleToggleCheck}
				onLongPress={handleLongPress}
				onOpen={handleOpen}
				onAct={handleAct}
			/>
		</div>
	);
};
