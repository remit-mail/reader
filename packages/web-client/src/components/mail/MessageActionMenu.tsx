import {
	messageBulkOperationsUpdateFlagsMutation,
	threadDetailOperationsListThreadMessagesQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
	BadgeCheck,
	Check,
	Code,
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
import { setReadOnItems } from "@/hooks/useMarkAsRead";
import { useMoveMessages } from "@/hooks/useMoveMessages";
import { useToggleTrusted } from "@/hooks/useToggleTrusted";
import {
	cancelThreadListQueries,
	invalidateThreadListQueries,
	patchThreadListQueries,
	restoreThreadListQueries,
	snapshotThreadListQueries,
	type ThreadListSnapshotEntry,
	threadListCacheKeys,
} from "@/lib/thread-list-cache";
import { MoveToTrigger } from "./MoveToTrigger";

interface ThreadMessagesData {
	items: RemitImapThreadMessageResponse[];
	[key: string]: unknown;
}

interface SnapshotEntry<T> {
	queryKey: readonly unknown[];
	data: T;
}

interface MarkUnreadContext {
	threadMessagesPrefix: readonly unknown[];
	listPrefixes: ReadonlyArray<readonly unknown[]>;
	previousThreadMessages: SnapshotEntry<ThreadMessagesData>[];
	previousThreadsList: ThreadListSnapshotEntry[];
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
	/**
	 * Whether the body area is currently showing the raw RFC822/MIME source
	 * instead of the rendered body. Controls the label/icon of the toggle.
	 */
	showRaw?: boolean;
	/**
	 * Toggle between the rendered body and the raw source. Owned by the
	 * parent card so the body area and this menu stay in sync.
	 */
	onToggleRaw?: () => void;
}

export const MessageActionMenu = ({
	messageId,
	threadId,
	mailboxId,
	isRead,
	accountId,
	fromAddressId,
	isTrusted = false,
	showRaw = false,
	onToggleRaw,
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
			const listPrefixes = threadListCacheKeys([mailboxId]);

			await Promise.all([
				queryClient.cancelQueries({ queryKey: threadMessagesPrefix }),
				cancelThreadListQueries(queryClient, listPrefixes),
			]);

			const previousThreadMessages = queryClient
				.getQueriesData<ThreadMessagesData>({ queryKey: threadMessagesPrefix })
				.filter(
					(entry): entry is [readonly unknown[], ThreadMessagesData] =>
						entry[1] !== undefined,
				)
				.map(([queryKey, data]) => ({ queryKey, data }));

			const previousThreadsList = snapshotThreadListQueries(
				queryClient,
				listPrefixes,
			);

			queryClient.setQueriesData<ThreadMessagesData>(
				{ queryKey: threadMessagesPrefix },
				(old) => {
					if (!old) return old;
					return {
						...old,
						items: setReadOnItems(old.items, targetIds, isReadNext),
					};
				},
			);

			patchThreadListQueries(queryClient, listPrefixes, (items) =>
				setReadOnItems(items, targetIds, isReadNext),
			);

			return {
				threadMessagesPrefix,
				listPrefixes,
				previousThreadMessages,
				previousThreadsList,
			};
		},
		onError: (err, variables, context) => {
			if (context) {
				for (const entry of context.previousThreadMessages) {
					queryClient.setQueryData(entry.queryKey, entry.data);
				}
				restoreThreadListQueries(queryClient, context.previousThreadsList);
			}
			const isReadNext = variables.body.isRead ?? true;
			pushError({
				title: isReadNext ? "Couldn't mark as read" : "Couldn't mark as unread",
				detail: formatErrorDetail(err),
				error: err,
			});
		},
		onSettled: (_data, _err, _vars, context) => {
			if (!context) return;
			queryClient.invalidateQueries({
				queryKey: context.threadMessagesPrefix,
			});
			invalidateThreadListQueries(queryClient, context.listPrefixes);
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
							<BadgeCheck className="size-4 text-positive" />
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
					{onToggleRaw && (
						<DropdownMenuItem onClick={onToggleRaw}>
							<Code className="size-4" />
							{showRaw ? "Show formatted" : "Show raw email"}
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
