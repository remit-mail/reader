import {
	messageBulkOperationsDeleteMessagesMutation,
	messageBulkOperationsUpdateFlagsMutation,
	threadDetailOperationsListThreadMessagesQueryKey,
	threadOperationsListThreadsQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MailOpen, MoreVertical, Trash2 } from "lucide-react";
import {
	DropdownMenu,
	DropdownMenuItem,
	DropdownMenuSeparator,
} from "@/components/ui/DropdownMenu";

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

	const invalidateQueries = () => {
		// Invalidate thread messages query using generated key
		queryClient.invalidateQueries({
			queryKey: threadDetailOperationsListThreadMessagesQueryKey({
				path: { threadId },
			}),
		});
		// Invalidate thread list query using generated key
		queryClient.invalidateQueries({
			queryKey: threadOperationsListThreadsQueryKey({
				path: { mailboxId },
			}),
		});
	};

	const { mutate: updateFlags, isPending: isUpdatingFlags } = useMutation({
		...messageBulkOperationsUpdateFlagsMutation(),
		onSuccess: () => {
			invalidateQueries();
		},
	});

	const { mutate: deleteMessages, isPending: isDeleting } = useMutation({
		...messageBulkOperationsDeleteMessagesMutation(),
		onSuccess: () => {
			invalidateQueries();
		},
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
		deleteMessages({
			body: {
				messageIds: [messageId],
			},
		});
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
