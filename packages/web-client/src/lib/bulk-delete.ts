/**
 * Chunked bulk-delete orchestration (issue #92).
 *
 * The bulk endpoint caps a call at 100 ids (`BulkMessageInput.messageIds`,
 * `@maxItems(100)`); a delete over a search result can run to thousands. These
 * helpers sequence the calls and tally which ids the run actually reached, so a
 * caller can always ask "what's still not deleted" instead of trusting the
 * request it sent.
 *
 * The endpoint enqueues the IMAP delete and returns; it does not apply it. So a
 * returned call means every id in it was accepted for deletion, not that the
 * mail server removed it — there is no per-id success/failure in the response
 * to read. The only failure this layer can observe is a thrown call: an
 * infrastructure failure (auth, the write, or the enqueue) that takes out the
 * whole batch and stops the run.
 *
 * Pure, framework-agnostic, and independently testable — no React, no fetch.
 * `useEscalatedDelete.ts` supplies the real `DeleteBatch`/`FetchIdsPage`
 * implementations (the generated SDK client) and owns the React state.
 */

export const BULK_DELETE_CHUNK_SIZE = 100;

/**
 * Resolves a promise to a discriminated result instead of throwing, so a
 * caller can branch on infrastructure failure as a value — the app's
 * try/catch rule requires a rethrow, and there is nothing to rethrow to here;
 * the caller's job on failure is to stop the run and report what happened,
 * not to keep propagating the same rejection past the point it's already
 * been handled.
 */
const attempt = async <T>(
	promise: Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> =>
	promise.then(
		(value) => ({ ok: true as const, value }),
		(error) => ({ ok: false as const, error }),
	);

/** Split `ids` into chunks of at most `size`. Empty input yields no chunks. */
export const chunkIds = (
	ids: readonly string[],
	size = BULK_DELETE_CHUNK_SIZE,
): string[][] => {
	if (ids.length === 0) return [];
	const chunks: string[][] = [];
	for (let i = 0; i < ids.length; i += size) {
		chunks.push(ids.slice(i, i + size));
	}
	return chunks;
};

export interface DeleteBatchResult {
	successCount: number;
	failureCount: number;
}

/** Sends one bulk-delete call for the given ids (≤100). */
export type DeleteBatch = (ids: string[]) => Promise<DeleteBatchResult>;

export interface BulkDeleteProgress {
	/** Ids confirmed deleted so far. */
	done: number;
	/** The total the run was started against (may be an estimate for the
	 *  predicate case — see `runPredicateDelete`). */
	total: number;
}

export interface BulkDeleteOutcome {
	/** Ids confirmed deleted (server-reported success, not merely "sent"). */
	done: number;
	/**
	 * Ids the run did not reach and are therefore not confirmed deleted: on
	 * cancellation or a thrown error, the chunks the bounded run never attempted
	 * (see `runChunkedDelete`). Empty in the predicate case, which re-resolves on
	 * every run rather than handing back a remainder (see `runPredicateDelete`).
	 * There is no per-id failure source: a returned batch call counts every id in
	 * it as accepted (see the module header).
	 */
	failedIds: string[];
	cancelled: boolean;
	/** Set when a batch call threw — an infrastructure failure, not a
	 *  per-item failure. The run stops at the point it was raised. */
	error?: unknown;
}

/**
 * Bounded case: the full id list is known upfront (a materialized selection,
 * or a "select all loaded" that grew past 100 rows). Chunked synchronously, so
 * on cancellation or a thrown error every chunk not yet attempted — including
 * the one in flight when an error was thrown — is folded into `failedIds`. The
 * caller always gets back exactly the ids still not confirmed deleted, ready
 * to retry as-is (deleting an already-trashed message is a safe no-op).
 */
export const runChunkedDelete = async (
	ids: readonly string[],
	deleteBatch: DeleteBatch,
	onProgress: (progress: BulkDeleteProgress) => void,
	isCancelled: () => boolean,
): Promise<BulkDeleteOutcome> => {
	const chunks = chunkIds(ids);
	const total = ids.length;
	let done = 0;
	const failedIds: string[] = [];

	for (let i = 0; i < chunks.length; i++) {
		if (isCancelled()) {
			failedIds.push(...chunks.slice(i).flat());
			return { done, failedIds, cancelled: true };
		}
		const chunk = chunks[i];
		const attempted = await attempt(deleteBatch(chunk));
		if (!attempted.ok) {
			failedIds.push(...chunks.slice(i).flat());
			onProgress({ done, total });
			return { done, failedIds, cancelled: false, error: attempted.error };
		}
		done += chunk.length;
		onProgress({ done, total });
	}

	return { done, failedIds, cancelled: false };
};

export interface FetchIdsPageResult {
	ids: string[];
	continuationToken?: string;
}

/** Fetches one page of matching message ids for the active predicate. */
export type FetchIdsPage = (
	continuationToken: string | undefined,
) => Promise<FetchIdsPageResult>;

/**
 * Escalated case: the selection is a predicate (D2), not a materialized list.
 * Each page is fetched immediately before the chunk it feeds is deleted — a
 * page IS a chunk, sized to the same 100-id cap the write side enforces — so
 * ids are never held in memory beyond the batch in flight.
 *
 * Cancelling or a thrown error simply stops paging: nothing is added to
 * `failedIds` for the unreached remainder, because those ids were never
 * fetched — there is nothing to hand back. A predicate resolves fresh on
 * every run (D2), so resuming is re-invoking this same function with the same
 * predicate: already-deleted matches drop out of the search on their own and
 * are not re-sent.
 */
export const runPredicateDelete = async (
	fetchIdsPage: FetchIdsPage,
	total: number,
	deleteBatch: DeleteBatch,
	onProgress: (progress: BulkDeleteProgress) => void,
	isCancelled: () => boolean,
): Promise<BulkDeleteOutcome> => {
	let done = 0;
	const failedIds: string[] = [];
	let token: string | undefined;

	do {
		if (isCancelled()) {
			return { done, failedIds, cancelled: true };
		}

		const fetched = await attempt(fetchIdsPage(token));
		if (!fetched.ok) {
			return { done, failedIds, cancelled: false, error: fetched.error };
		}
		const page = fetched.value;

		if (page.ids.length > 0) {
			const attempted = await attempt(deleteBatch(page.ids));
			if (!attempted.ok) {
				return { done, failedIds, cancelled: false, error: attempted.error };
			}
			done += page.ids.length;
			onProgress({ done, total });
		}

		token = page.continuationToken;
	} while (token);

	return { done, failedIds, cancelled: false };
};

export interface CountMatchesResult {
	total: number;
	cancelled: boolean;
	error?: unknown;
}

/**
 * Pages the full predicate result set to find its exact total — the only way,
 * short of a server-side total (out of scope, see issue #92), since search has
 * no total-count field beyond a small capped-window estimate. Reports a
 * running count via `onProgress` so a long count reads as progressing rather
 * than hung, and checks `isCancelled` between pages so Stop takes effect
 * within one page's latency.
 */
export const countMatches = async (
	fetchIdsPage: FetchIdsPage,
	onProgress: (countSoFar: number) => void,
	isCancelled: () => boolean,
): Promise<CountMatchesResult> => {
	let total = 0;
	let token: string | undefined;

	do {
		if (isCancelled()) {
			return { total, cancelled: true };
		}
		const fetched = await attempt(fetchIdsPage(token));
		if (!fetched.ok) {
			return { total, cancelled: false, error: fetched.error };
		}
		const page = fetched.value;
		total += page.ids.length;
		onProgress(total);
		token = page.continuationToken;
	} while (token);

	return { total, cancelled: false };
};

export interface DeleteRunOutcome {
	done: number;
	failedIds: string[];
	cancelled: boolean;
	error?: unknown;
}

export interface SelectionAfterDelete {
	/** Everything targeted was confirmed deleted — selection mode should exit. */
	exit: boolean;
	/** The bounded selection to leave in place, empty when exiting. */
	retryIds: string[];
}

/**
 * What a caller does with selection once a run ends, for any reason. Every id
 * not confirmed deleted — a chunk the bounded run never reached because it was
 * stopped or errored — belongs in `retryIds`: it is exactly what Retry should
 * resend, and it is what stays selected so the count on screen never claims
 * more was deleted than actually was (#92 requirement 8).
 */
export const resolveSelectionAfterDelete = (
	outcome: DeleteRunOutcome,
): SelectionAfterDelete => {
	if (outcome.failedIds.length > 0) {
		return { exit: false, retryIds: outcome.failedIds };
	}
	if (outcome.cancelled || outcome.error) {
		return { exit: false, retryIds: [] };
	}
	return { exit: true, retryIds: [] };
};
