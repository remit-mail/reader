import {
	messageBulkOperationsDeleteMessagesMutation,
	messageBulkOperationsUpdateFlagsMutation,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MailOpen, MoreVertical, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
	DropdownMenu,
	DropdownMenuItem,
	DropdownMenuSeparator,
} from "@/components/ui/DropdownMenu";
import { threadKeys } from "@/hooks/queries/keys";

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
		queryClient.invalidateQueries({
			queryKey: threadKeys.messages(threadId),
		});
		queryClient.invalidateQueries({
			queryKey: threadKeys.list(mailboxId, {}),
			exact: false,
		});
	};

	const { mutate: updateFlags, isPending: isUpdatingFlags } = useMutation({
		...messageBulkOperationsUpdateFlagsMutation(),
		onSuccess: () => {
			invalidateQueries();
			toast.success(isRead ? "Marked as unread" : "Marked as read");
		},
		onError: () => {
			toast.error("Failed to update message");
		},
	});

	const { mutate: deleteMessages, isPending: isDeleting } = useMutation({
		...messageBulkOperationsDeleteMessagesMutation(),
		onSuccess: () => {
			invalidateQueries();
			toast.success("Message deleted");
		},
		onError: () => {
			toast.error("Failed to delete message");
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
