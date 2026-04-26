import {
	messageBulkOperationsUpdateFlagsMutation,
	threadDetailOperationsListThreadMessagesQueryKey,
	threadOperationsListThreadsQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
	BadgeCheck,
	Check,
	MailOpen,
	MoreVertical,
	Trash2,
} from "lucide-react";
import { useCallback } from "react";
import {
	DropdownMenu,
	DropdownMenuItem,
	DropdownMenuSeparator,
} from "@/components/ui/DropdownMenu";
import { ErrorState } from "@/components/ui/ErrorState";
import { useDeleteMessages } from "@/hooks/useDeleteMessages";
import { useToggleTrusted } from "@/hooks/useToggleTrusted";

interface MessageActionMenuProps {
	messageId: string;
	threadId: string;
	mailboxId: string;
	isRead: boolean;
	/**
	 * The From-address `addressId` for the message. When omitted (e.g. the
	 * envelope has no parseable From) the "Trusted sender" toggle is
	 * disabled with an explanatory tooltip.
	 */
	fromAddressId?: string;
	/**
	 * Whether the From-address is currently flagged as trusted.
	 */
	isTrusted?: boolean;
}

export const MessageActionMenu = ({
	messageId,
	threadId,
	mailboxId,
	isRead,
	fromAddressId,
	isTrusted = false,
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

	const {
		toggleTrusted,
		isPending: isUpdatingTrusted,
		error: trustedError,
		reset: resetTrustedError,
	} = useToggleTrusted({ messageId });

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

	const handleToggleTrusted = () => {
		if (!fromAddressId) return;
		toggleTrusted(fromAddressId, isTrusted);
	};

	const isDisabled = isUpdatingFlags || isDeleting || isUpdatingTrusted;
	const trustedItemDisabled = isDisabled || !fromAddressId;
	const trustedItemTitle = !fromAddressId
		? "Sender has no parseable address"
		: undefined;

	return (
		<div className="flex flex-col items-end gap-1">
			<DropdownMenu trigger={<MoreVertical className="size-4" />}>
				<DropdownMenuItem
					onClick={handleToggleTrusted}
					disabled={trustedItemDisabled}
				>
					{isTrusted ? (
						<BadgeCheck className="size-4 text-green-600 dark:text-green-500" />
					) : (
						<Check className="size-4 opacity-0" />
					)}
					<span title={trustedItemTitle}>Trusted sender</span>
				</DropdownMenuItem>
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
			{trustedError && (
				<div className="w-64">
					<ErrorState
						variant="inline"
						title="Couldn't update trust"
						error={trustedError}
						onRetry={() => {
							resetTrustedError();
							handleToggleTrusted();
						}}
					/>
				</div>
			)}
		</div>
	);
};
