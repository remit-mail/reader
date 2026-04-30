import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
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
import { MessageListItem } from "./MessageListItem";

interface SwipeableMessageRowProps {
	thread: RemitImapThreadMessageResponse;
	mailboxId: string;
	isSelected: boolean;
	isChecked: boolean;
	onToggleCheck: (id: string) => void;
	isMultiSelectMode: boolean;
	onLongPress: (messageId: string) => void;
	isDesktop: boolean;
	onDelete: (messageId: string) => void;
	onToggleRead: (messageId: string, currentIsRead: boolean) => void;
}

const SWIPE_THRESHOLD = 0.3;

export const SwipeableMessageRow = ({
	thread,
	mailboxId,
	isSelected,
	isChecked,
	onToggleCheck,
	isMultiSelectMode,
	onLongPress,
	isDesktop,
	onDelete,
	onToggleRead,
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
				isChecked={isChecked}
				onToggleCheck={onToggleCheck}
				isMultiSelectMode={isMultiSelectMode}
				onLongPress={onLongPress}
				isDesktop={isDesktop}
			/>
		);
	}

	const leadingActions = (
		<LeadingActions>
			<SwipeAction onClick={handleToggleRead}>
				<div className="flex items-center justify-center h-full bg-blue-500 px-6">
					{thread.isRead ? (
						<MailOpen className="size-6 text-white" />
					) : (
						<Mail className="size-6 text-white" />
					)}
				</div>
			</SwipeAction>
		</LeadingActions>
	);

	const trailingActions = (
		<TrailingActions>
			<SwipeAction onClick={handleDelete} destructive>
				<div className="flex items-center justify-center h-full bg-red-500 px-6">
					<Trash2 className="size-6 text-white" />
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
				isChecked={isChecked}
				onToggleCheck={onToggleCheck}
				isMultiSelectMode={isMultiSelectMode}
				onLongPress={onLongPress}
				isDesktop={isDesktop}
			/>
		</SwipeableListItem>
	);
};
