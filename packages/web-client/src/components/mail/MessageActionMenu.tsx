import {
	messageBulkOperationsUpdateFlagsMutation,
	threadDetailOperationsListThreadMessagesQueryKey,
	threadOperationsListThreadsQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { MailOpen, MoreVertical, Trash2 } from "lucide-react";
import { useCallback } from "react";
import {
	DropdownMenu,
	DropdownMenuItem,
	DropdownMenuSeparator,
} from "@/components/ui/DropdownMenu";
import { useDeleteMessages } from "@/hooks/useDeleteMessages";

interface MessageActionMenuProps {
	messageId: string;
	threadId: string;
	mailboxId: string;
	isRead: boolean;
}

export const MessageActionMenu = ({
	messageId,
	threadId,
	mailboxId,
	isRead,
}: MessageActionMenuProps) => {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const { selectedMessageId } = useSearch({ strict: false }) as {
		selectedMessageId?: string;
	};

	const { mutate: updateFlags, isPending: isUpdatingFlags } = useMutation({
		...messageBulkOperationsUpdateFlagsMutation(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: threadDetailOperationsListThreadMessagesQueryKey({
					path: { threadId },
				}),
			});
			queryClient.invalidateQueries({
				queryKey: threadOperationsListThreadsQueryKey({
					path: { mailboxId },
				}),
			});
		},
	});

	// Deselect the thread before the server response arrives if the message
	// being deleted is the one currently routed to. Mirrors the bulk-delete
	// flow on the mailbox route — without this, the URL keeps a stale
	// `selectedMessageId` after the row vanishes from the list.
	const handleAfterOptimisticRemove = useCallback(
		(removedIds: string[]) => {
			if (!selectedMessageId) return;
			if (!removedIds.includes(selectedMessageId)) return;
			navigate({
				to: "/mail/$mailboxId",
				params: { mailboxId },
				search: (prev: Record<string, unknown>) => ({
					...prev,
					selectedMessageId: undefined,
				}),
			});
		},
		[selectedMessageId, mailboxId, navigate],
	);

	const { deleteMessages, isPending: isDeleting } = useDeleteMessages({
		mailboxId,
		threadId,
		onAfterOptimisticRemove: handleAfterOptimisticRemove,
	});

	const handleMarkAsUnread = () => {
		updateFlags({
			body: {
				messageIds: [messageId],
				isRead: false,
			},
		});
	};

	const handleDelete = () => {
		deleteMessages([messageId]);
	};

	const isDisabled = isUpdatingFlags || isDeleting;

	return (
		<DropdownMenu trigger={<MoreVertical className="size-4" />}>
			{isRead && (
				<DropdownMenuItem onClick={handleMarkAsUnread} disabled={isDisabled}>
					<MailOpen className="size-4" />
					Mark as unread
				</DropdownMenuItem>
			)}
			<DropdownMenuSeparator />
			<DropdownMenuItem
				onClick={handleDelete}
				disabled={isDisabled}
				destructive
			>
				<Trash2 className="size-4" />
				Delete
			</DropdownMenuItem>
		</DropdownMenu>
	);
};
