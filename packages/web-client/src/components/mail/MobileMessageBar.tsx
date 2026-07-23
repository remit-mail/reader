import {
	messageBulkOperationsUpdateFlagsMutation,
	threadDetailOperationsListThreadMessagesQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { MobileMessageActionBar, type PopoverMenuItem } from "@remit/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Check, Code } from "lucide-react";
import { useCallback } from "react";
import { useDeleteMessages } from "@/hooks/useDeleteMessages";
import { useMoveMessages } from "@/hooks/useMoveMessages";
import { useToggleTrusted } from "@/hooks/useToggleTrusted";
import {
	invalidateThreadListQueries,
	threadListCacheKeys,
} from "@/lib/thread-list-cache";
import { MoveToTrigger } from "./MoveToTrigger";

interface MobileMessageBarProps {
	messageId: string;
	threadId: string;
	mailboxId: string;
	accountId?: string;
	isRead: boolean;
	isStarred: boolean;
	onToggleStar: () => void;
	/** From-address id; enables the "Trusted sender" overflow item. */
	fromAddressId?: string;
	isTrusted: boolean;
	showRaw: boolean;
	onToggleRaw?: () => void;
	onReply?: () => void;
	onReplyAll?: () => void;
	onForward?: () => void;
}

/**
 * The live per-message action bar for the mobile single-pane reading view.
 * Wraps the kit `MobileMessageActionBar` and owns this message's mutations:
 * star (host), move-to-folder, delete, mark read/unread, plus the trusted /
 * raw toggles in the overflow. Reply verbs come from the conversation.
 */
export const MobileMessageBar = ({
	messageId,
	threadId,
	mailboxId,
	accountId,
	isRead,
	isStarred,
	onToggleStar,
	fromAddressId,
	isTrusted,
	showRaw,
	onToggleRaw,
	onReply,
	onReplyAll,
	onForward,
}: MobileMessageBarProps) => {
	const queryClient = useQueryClient();

	const { deleteMessages } = useDeleteMessages({ mailboxId, threadId });
	const { moveMessages } = useMoveMessages({ mailboxId, threadId, accountId });
	const { toggleTrusted } = useToggleTrusted({ messageId });

	const { mutate: updateFlags } = useMutation({
		...messageBulkOperationsUpdateFlagsMutation(),
		onSettled: () => {
			queryClient.invalidateQueries({
				queryKey: threadDetailOperationsListThreadMessagesQueryKey({
					path: { threadId },
				}),
			});
			invalidateThreadListQueries(
				queryClient,
				threadListCacheKeys([mailboxId]),
			);
		},
	});

	const handleMove = useCallback(
		(destinationMailboxId: string) => {
			moveMessages([messageId], destinationMailboxId);
		},
		[moveMessages, messageId],
	);

	const handleDelete = useCallback(() => {
		deleteMessages([messageId]);
	}, [deleteMessages, messageId]);

	const handleToggleRead = useCallback(() => {
		updateFlags({ body: { messageIds: [messageId], isRead: !isRead } });
	}, [updateFlags, messageId, isRead]);

	const overflowItems: PopoverMenuItem[] = [];
	if (fromAddressId) {
		overflowItems.push({
			key: "trusted",
			label: isTrusted ? "Trusted sender" : "Mark sender trusted",
			icon: isTrusted ? (
				<BadgeCheck className="size-4 text-positive" />
			) : (
				<Check className="size-4" />
			),
			onSelect: () => toggleTrusted(fromAddressId, isTrusted),
		});
	}
	if (onToggleRaw) {
		overflowItems.push({
			key: "raw",
			label: showRaw ? "Show formatted" : "Show raw email",
			icon: <Code className="size-4" />,
			onSelect: onToggleRaw,
		});
	}

	return (
		<MobileMessageActionBar
			hasThread
			onReply={onReply}
			onReplyAll={onReplyAll}
			onForward={onForward}
			isStarred={isStarred}
			onToggleStar={onToggleStar}
			onDelete={handleDelete}
			isRead={isRead}
			onToggleRead={handleToggleRead}
			overflowItems={overflowItems}
			moveSlot={
				accountId ? (
					<MoveToTrigger
						accountId={accountId}
						currentMailboxId={mailboxId}
						onMove={handleMove}
						label="Move this message"
					/>
				) : undefined
			}
		/>
	);
};
