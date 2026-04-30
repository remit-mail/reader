import {
	messageBulkOperationsUpdateFlagsMutation,
	threadDetailOperationsListThreadMessagesQueryKey,
	threadOperationsListThreadsQueryKey,
	threadOperationsSearchThreadsQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
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
import { useErrorBanners } from "@/components/ui/ErrorBannerProvider";
import { ErrorState } from "@/components/ui/ErrorState";
import { formatErrorDetail } from "@/components/ui/error-banners";
import { useDeleteMessages } from "@/hooks/useDeleteMessages";
import { useMoveMessages } from "@/hooks/useMoveMessages";
import { useToggleTrusted } from "@/hooks/useToggleTrusted";
import { MoveToTrigger } from "./MoveToTrigger";

interface ThreadMessagesData {
	items: RemitImapThreadMessageResponse[];
	[key: string]: unknown;
}

interface ThreadsListPage {
	items: RemitImapThreadMessageResponse[];
	[key: string]: unknown;
}

interface ThreadsListData {
	pages: ThreadsListPage[];
	pageParams: Array<string | undefined>;
}

interface SnapshotEntry<T> {
	queryKey: readonly unknown[];
	data: T;
}

interface MarkUnreadContext {
	threadMessagesPrefix: readonly unknown[];
	threadsListPrefix: readonly unknown[];
	threadsSearchPrefix: readonly unknown[];
	previousThreadMessages: SnapshotEntry<ThreadMessagesData>[];
	previousThreadsList: SnapshotEntry<ThreadsListData>[];
}

interface MessageActionMenuProps {
	messageId: string;
	threadId: string;
	mailboxId: string;
	isRead: boolean;
	/**
	 * Account that owns this message's mailbox. When provided the
	 * Move-to-folder trigger is rendered next to the overflow; when
	 * omitted (e.g. the surrounding view hasn't resolved the account
	 * yet) the trigger is hidden so we never present a picker scoped to
	 * the wrong account.
	 */
	accountId?: string;
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
	accountId,
	fromAddressId,
	isTrusted = false,
}: MessageActionMenuProps) => {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const { pushError } = useErrorBanners();
	const { selectedMessageId } = useSearch({ strict: false }) as {
		selectedMessageId?: string;
	};

	const { mutate: updateFlags, isPending: isUpdatingFlags } = useMutation({
		...messageBulkOperationsUpdateFlagsMutation(),
		onMutate: async (variables): Promise<MarkUnreadContext> => {
			const isReadNext = variables.body.isRead ?? true;
			const targetIds = new Set(variables.body.messageIds ?? []);

			const threadMessagesPrefix =
				threadDetailOperationsListThreadMessagesQueryKey({
					path: { threadId },
				});
			const threadsListPrefix = threadOperationsListThreadsQueryKey({
				path: { mailboxId },
			});
			const threadsSearchPrefix = threadOperationsSearchThreadsQueryKey({
				path: { mailboxId },
			});

			await Promise.all([
				queryClient.cancelQueries({ queryKey: threadMessagesPrefix }),
				queryClient.cancelQueries({ queryKey: threadsListPrefix }),
				queryClient.cancelQueries({ queryKey: threadsSearchPrefix }),
			]);

			const previousThreadMessages = queryClient
				.getQueriesData<ThreadMessagesData>({ queryKey: threadMessagesPrefix })
				.filter(
					(entry): entry is [readonly unknown[], ThreadMessagesData] =>
						entry[1] !== undefined,
				)
				.map(([queryKey, data]) => ({ queryKey, data }));

			const previousThreadsList = queryClient
				.getQueriesData<ThreadsListData>({ queryKey: threadsListPrefix })
				.concat(
					queryClient.getQueriesData<ThreadsListData>({
						queryKey: threadsSearchPrefix,
					}),
				)
				.filter(
					(entry): entry is [readonly unknown[], ThreadsListData] =>
						entry[1] !== undefined,
				)
				.map(([queryKey, data]) => ({ queryKey, data }));

			queryClient.setQueriesData<ThreadMessagesData>(
				{ queryKey: threadMessagesPrefix },
				(old) => {
					if (!old) return old;
					return {
						...old,
						items: old.items.map((item) =>
							targetIds.has(item.messageId)
								? { ...item, isRead: isReadNext }
								: item,
						),
					};
				},
			);

			const patchListData = (old: ThreadsListData | undefined) => {
				if (!old) return old;
				return {
					...old,
					pages: old.pages.map((page) => ({
						...page,
						items: page.items.map((item) =>
							targetIds.has(item.messageId)
								? { ...item, isRead: isReadNext }
								: item,
						),
					})),
				};
			};

			queryClient.setQueriesData<ThreadsListData>(
				{ queryKey: threadsListPrefix },
				patchListData,
			);
			queryClient.setQueriesData<ThreadsListData>(
				{ queryKey: threadsSearchPrefix },
				patchListData,
			);

			return {
				threadMessagesPrefix,
				threadsListPrefix,
				threadsSearchPrefix,
				previousThreadMessages,
				previousThreadsList,
			};
		},
		onError: (err, variables, context) => {
			if (context) {
				for (const entry of context.previousThreadMessages) {
					queryClient.setQueryData(entry.queryKey, entry.data);
				}
				for (const entry of context.previousThreadsList) {
					queryClient.setQueryData(entry.queryKey, entry.data);
				}
			}
			const isReadNext = variables.body.isRead ?? true;
			pushError({
				title: isReadNext ? "Couldn't mark as read" : "Couldn't mark as unread",
				detail: formatErrorDetail(err),
			});
		},
		onSettled: (_data, _err, _vars, context) => {
			if (!context) return;
			queryClient.invalidateQueries({
				queryKey: context.threadMessagesPrefix,
			});
			queryClient.invalidateQueries({ queryKey: context.threadsListPrefix });
			queryClient.invalidateQueries({
				queryKey: context.threadsSearchPrefix,
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

	const { moveMessages, isPending: isMoving } = useMoveMessages({
		mailboxId,
		threadId,
		accountId,
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

	const isDisabled =
		isUpdatingFlags || isDeleting || isMoving || isUpdatingTrusted;
	const trustedItemDisabled = isDisabled || !fromAddressId;

	const handleMove = useCallback(
		(destinationMailboxId: string) => {
			moveMessages([messageId], destinationMailboxId);
		},
		[moveMessages, messageId],
	);
	const trustedItemTitle = !fromAddressId
		? "Sender has no parseable address"
		: undefined;

	return (
		<div className="flex flex-col items-end gap-1">
			<div className="flex items-center gap-1">
				{accountId && (
					<MoveToTrigger
						accountId={accountId}
						currentMailboxId={mailboxId}
						onMove={handleMove}
						disabled={isDisabled}
						label="Move this message"
					/>
				)}
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
						<DropdownMenuItem
							onClick={handleMarkAsUnread}
							disabled={isDisabled}
						>
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
			</div>
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
