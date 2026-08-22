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
import { useCallback, useRef, useState } from "react";
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
	signal: AbortSignal,
): Promise<string[]> => {
	const ids: string[] = [];
	let continuationToken: string | undefined;
	for (let page = 0; page < PAGE_CAP; page += 1) {
		if (signal.aborted) return ids;
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

/**
 * Count live messages still listed in the mailbox with no `moved`-set filtering,
 * an independent read the move loop cannot fool. The delete gates on this: if any
 * message still shows here — including one that lags in the source listing after a
 * move — the folder is not emptied yet and must not be deleted.
 */
const liveMessageCount = async (
	mailboxId: string,
	signal: AbortSignal,
): Promise<number> => {
	let count = 0;
	let continuationToken: string | undefined;
	for (let page = 0; page < PAGE_CAP; page += 1) {
		if (signal.aborted) return count;
		const { data } = await threadOperationsListThreads({
			path: { mailboxId },
			query: { order: "desc", continuationToken },
			throwOnError: true,
		});
		for (const item of data.items) {
			if (item.isDeleted) continue;
			count += 1;
		}
		if (!data.continuationToken) break;
		continuationToken = data.continuationToken;
	}
	return count;
};

export type DeleteFolderPhase =
	| "idle"
	| "checking"
	| "moving"
	| "deleting"
	| "done"
	| "error";

/** What a delete-as-empty found: nothing to save, or mail the folder still holds. */
export type EmptyDeleteOutcome =
	| { blocked: false }
	| { blocked: true; messageCount: number };

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
	const abortRef = useRef<AbortController | null>(null);

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

	/**
	 * Deleting a folder takes its mail with it, and `messageCount` on the folder
	 * row is the last synced IMAP STATUS. Re-read the server first: mail that
	 * arrived since blocks the delete instead of being destroyed by it.
	 */
	const deleteIfEmpty = useCallback(async (): Promise<EmptyDeleteOutcome> => {
		setPhase("checking");
		setErrorMessage(undefined);
		const counted = await attempt(remainingCount());
		if (!counted.ok) {
			setErrorMessage(counted.error);
			setPhase("error");
			return { blocked: false };
		}
		if (counted.value > 0) {
			setPhase("idle");
			return { blocked: true, messageCount: counted.value };
		}
		await deleteMailbox();
		return { blocked: false };
	}, [remainingCount, deleteMailbox]);

	const cancel = useCallback(() => {
		abortRef.current?.abort();
	}, []);

	const moveThenDelete = useCallback(
		async (destinationMailboxId: string) => {
			const controller = new AbortController();
			abortRef.current = controller;
			const { signal } = controller;
			setPhase("moving");
			setErrorMessage(undefined);

			const counted = await attempt(remainingCount());
			if (signal.aborted) return;
			if (!counted.ok) {
				setErrorMessage(counted.error);
				setPhase("error");
				return;
			}
			let current = beginMove(counted.value);
			setProgress(current);

			const moved = new Set<string>();
			while (true) {
				if (signal.aborted) return;
				const collected = await attempt(
					collectMovableIds(mailboxId, moved, MOVE_BATCH_SIZE, signal),
				);
				if (signal.aborted) return;
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
				if (signal.aborted) return;
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

			const remaining = await attempt(liveMessageCount(mailboxId, signal));
			if (signal.aborted) return;
			if (!remaining.ok) {
				current = failMove(current, remaining.error);
				setProgress(current);
				setErrorMessage(remaining.error);
				setPhase("error");
				return;
			}
			if (remaining.value > 0) {
				const message = `${remaining.value} ${
					remaining.value === 1 ? "email is" : "emails are"
				} still syncing. Re-open delete to finish removing this folder.`;
				current = failMove(current, message);
				setProgress(current);
				setErrorMessage(message);
				setPhase("error");
				invalidate();
				return;
			}

			await deleteMailbox();
		},
		[mailboxId, remainingCount, deleteMailbox, invalidate],
	);

	const reset = useCallback(() => {
		abortRef.current?.abort();
		abortRef.current = null;
		setPhase("idle");
		setProgress(null);
		setErrorMessage(undefined);
	}, []);

	return {
		phase,
		progress,
		errorMessage,
		deleteMailbox,
		deleteIfEmpty,
		moveThenDelete,
		cancel,
		reset,
	};
}
