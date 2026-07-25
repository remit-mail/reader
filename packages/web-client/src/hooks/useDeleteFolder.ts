import {
	configOperationsGetConfigQueryKey,
	mailboxOperationsListMailboxesQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import {
	mailboxDetailOperationsDeleteMailbox,
	mailboxOperationsListMailboxes,
	messageBulkOperationsMoveMessages,
	threadOperationsListThreads,
} from "@remit/api-http-client/sdk.gen.ts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import {
	advanceMove,
	beginMove,
	failMove,
	MOVE_BATCH_SIZE,
	type MoveProgress,
} from "@/lib/delete-folder";

const PAGE_CAP = 50;

type Outcome<T> = { ok: true; value: T } | { ok: false; error: string };

const errorText = (error: unknown): string =>
	error instanceof Error ? error.message : "Something went wrong.";

/**
 * Run a network call to a branchable result instead of a thrown exception, so
 * the caller can surface a failed batch to the UI without a block catch (the
 * fail-fast lint rule reserves those for rethrows).
 */
const attempt = <T>(work: Promise<T>): Promise<Outcome<T>> =>
	work.then(
		(value) => ({ ok: true as const, value }),
		(error) => ({ ok: false as const, error: errorText(error) }),
	);

/**
 * Collect up to `limit` message ids still living in the mailbox, skipping ones
 * already moved this run and anything flagged deleted. Reads fresh from the
 * server every call so a resumed or interrupted move enumerates what is
 * actually left, never a stale snapshot.
 */
const collectMovableIds = async (
	mailboxId: string,
	alreadyMoved: ReadonlySet<string>,
	limit: number,
): Promise<string[]> => {
	const ids: string[] = [];
	let continuationToken: string | undefined;
	for (let page = 0; page < PAGE_CAP; page += 1) {
		const { data } = await threadOperationsListThreads({
			path: { mailboxId },
			query: { order: "desc", continuationToken },
			throwOnError: true,
		});
		for (const item of data.items) {
			if (item.isDeleted) continue;
			if (alreadyMoved.has(item.messageId)) continue;
			if (ids.includes(item.messageId)) continue;
			ids.push(item.messageId);
			if (ids.length >= limit) return ids;
		}
		if (!data.continuationToken) break;
		continuationToken = data.continuationToken;
	}
	return ids;
};

export type DeleteFolderPhase =
	| "idle"
	| "moving"
	| "deleting"
	| "done"
	| "error";

interface UseDeleteFolderOptions {
	accountId: string;
	mailboxId: string;
	onDeleted: () => void;
}

export function useDeleteFolder({
	accountId,
	mailboxId,
	onDeleted,
}: UseDeleteFolderOptions) {
	const queryClient = useQueryClient();
	const [phase, setPhase] = useState<DeleteFolderPhase>("idle");
	const [progress, setProgress] = useState<MoveProgress | null>(null);
	const [errorMessage, setErrorMessage] = useState<string>();

	const invalidate = useCallback(() => {
		queryClient.invalidateQueries({
			queryKey: mailboxOperationsListMailboxesQueryKey({ path: { accountId } }),
		});
		queryClient.invalidateQueries({
			queryKey: configOperationsGetConfigQueryKey(),
		});
	}, [queryClient, accountId]);

	const deleteMailbox = useCallback(async () => {
		setPhase("deleting");
		const outcome = await attempt(
			mailboxDetailOperationsDeleteMailbox({
				path: { accountId, mailboxId },
				throwOnError: true,
			}),
		);
		if (!outcome.ok) {
			setErrorMessage(outcome.error);
			setPhase("error");
			return;
		}
		invalidate();
		setPhase("done");
		onDeleted();
	}, [accountId, mailboxId, invalidate, onDeleted]);

	const remainingCount = useCallback(
		(): Promise<number> =>
			mailboxOperationsListMailboxes({
				path: { accountId },
				throwOnError: true,
			}).then(
				({ data }) =>
					data.items.find((box) => box.mailboxId === mailboxId)?.messageCount ??
					0,
			),
		[accountId, mailboxId],
	);

	const moveThenDelete = useCallback(
		async (destinationMailboxId: string) => {
			setPhase("moving");
			setErrorMessage(undefined);

			const counted = await attempt(remainingCount());
			if (!counted.ok) {
				setErrorMessage(counted.error);
				setPhase("error");
				return;
			}
			let current = beginMove(counted.value);
			setProgress(current);

			const moved = new Set<string>();
			while (true) {
				const collected = await attempt(
					collectMovableIds(mailboxId, moved, MOVE_BATCH_SIZE),
				);
				if (!collected.ok) {
					current = failMove(current, collected.error);
					setProgress(current);
					setErrorMessage(collected.error);
					setPhase("error");
					return;
				}
				const batch = collected.value;
				if (batch.length === 0) break;

				const movedBatch = await attempt(
					messageBulkOperationsMoveMessages({
						body: { messageIds: batch, destinationMailboxId },
						throwOnError: true,
					}),
				);
				if (!movedBatch.ok) {
					current = failMove(current, movedBatch.error);
					setProgress(current);
					setErrorMessage(movedBatch.error);
					setPhase("error");
					return;
				}
				for (const id of batch) moved.add(id);
				current = advanceMove(current, batch.length);
				setProgress(current);
			}

			await deleteMailbox();
		},
		[mailboxId, remainingCount, deleteMailbox],
	);

	const reset = useCallback(() => {
		setPhase("idle");
		setProgress(null);
		setErrorMessage(undefined);
	}, []);

	return {
		phase,
		progress,
		errorMessage,
		deleteMailbox,
		moveThenDelete,
		reset,
	};
}
