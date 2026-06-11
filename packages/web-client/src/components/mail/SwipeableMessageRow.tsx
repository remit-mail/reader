import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import type { Density } from "@remit/ui";
import { Mail, MailOpen, Trash2 } from "lucide-react";
import { useCallback } from "react";
import {
	LeadingActions,
	Type as ListType,
	SwipeAction,
	SwipeableListItem,
	TrailingActions,
} from "react-swipeable-list";
import "react-swipeable-list/dist/styles.css";
import type { SelectionModifiers } from "@/hooks/useSelection";
import { MessageListItem } from "./MessageListItem";

interface SwipeableMessageRowProps {
	thread: RemitImapThreadMessageResponse;
	mailboxId: string;
	isSelected: boolean;
	/** Roving keyboard focus cursor — renders the left accent rail (#429). */
	isFocused?: boolean;
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

const SWIPE_THRESHOLD = 0.3;

export const SwipeableMessageRow = ({
	thread,
	mailboxId,
	isSelected,
	isFocused,
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
	const handleDelete = useCallback(() => {
		navigator.vibrate?.(10);
		onDelete(thread.messageId);
	}, [onDelete, thread.messageId]);

	const handleToggleRead = useCallback(() => {
		navigator.vibrate?.(10);
		onToggleRead(thread.messageId, thread.isRead);
	}, [onToggleRead, thread.messageId, thread.isRead]);

	if (isDesktop || isMultiSelectMode) {
		return (
			<MessageListItem
				thread={thread}
				mailboxId={mailboxId}
				isSelected={isSelected}
				isFocused={isFocused}
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

	const leadingActions = (
		<LeadingActions>
			<SwipeAction onClick={handleToggleRead}>
				<div className="flex items-center justify-center h-full bg-accent-2 px-6">
					{thread.isRead ? (
						<MailOpen className="size-6 text-accent-fg" />
					) : (
						<Mail className="size-6 text-accent-fg" />
					)}
				</div>
			</SwipeAction>
		</LeadingActions>
	);

	const trailingActions = (
		<TrailingActions>
			<SwipeAction onClick={handleDelete} destructive>
				<div className="flex items-center justify-center h-full bg-danger px-6">
					<Trash2 className="size-6 text-canvas" />
				</div>
			</SwipeAction>
		</TrailingActions>
	);

	return (
		<SwipeableListItem
			listType={ListType.IOS}
			threshold={SWIPE_THRESHOLD}
			leadingActions={leadingActions}
			trailingActions={trailingActions}
		>
			<MessageListItem
				thread={thread}
				mailboxId={mailboxId}
				isSelected={isSelected}
				isFocused={isFocused}
				isChecked={isChecked}
				onToggleCheck={onToggleCheck}
				onRowSelect={onRowSelect}
				isMultiSelectMode={isMultiSelectMode}
				onLongPress={onLongPress}
				isDesktop={isDesktop}
				density={density}
			/>
		</SwipeableListItem>
	);
};
