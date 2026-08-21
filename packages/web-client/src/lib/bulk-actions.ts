/**
 * Chunked bulk-action orchestration (issues #92, #114).
 *
 * The bulk endpoints cap a call at 100 ids (`BulkMessageInput.messageIds`,
 * `@maxItems(100)`); an action over a search result can run to thousands. These
 * helpers sequence the calls and tally which ids the run actually reached, so a
 * caller can always ask "what's still not done" instead of trusting the request
 * it sent. Delete, move and mark-read all take this path — the action itself is
 * the `ApplyBatch` the caller supplies.
 *
 * The endpoints enqueue the IMAP write and return; they do not apply it. So a
 * returned call means every id in it was accepted, not that the mail server
 * applied it — there is no per-id success/failure in the response to read. The
 * only failure this layer can observe is a thrown call: an infrastructure
 * failure (auth, the write, or the enqueue) that takes out the whole batch and
 * stops the run.
 *
 * Pure, framework-agnostic, and independently testable — no React, no fetch.
 * `useEscalatedActions.ts` supplies the real `ApplyBatch`/`FetchIdsPage`
 * implementations (the generated SDK client) and owns the React state.
 */

export const BULK_ACTION_CHUNK_SIZE = 100;

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
	size = BULK_ACTION_CHUNK_SIZE,
): string[][] => {
	if (ids.length === 0) return [];
	const chunks: string[][] = [];
	for (let i = 0; i < ids.length; i += size) {
		chunks.push(ids.slice(i, i + size));
	}
	return chunks;
};

/** One message a run covers, as the surface that selected it knows it. */
export interface BulkActionTarget {
	id: string;
	/**
	 * Owning IMAP account — the `accountId` of the account API, never the
	 * caller's `accountConfigId` (#456). Undefined on a row from a per-mailbox
	 * listing, which does not carry one because every row in it shares the same
	 * account.
	 */
	accountId: string | undefined;
}

/**
 * Split `targets` into chunks of at most `size` that each carry exactly one
 * account (#872).
 *
 * The bulk endpoints reject a batch spanning accounts outright, before applying
 * any of it, and the daily brief and Flagged are both cross-account lists — so
 * a selection ticked across two accounts sent as one batch deleted nothing.
 * Account is a property of the batch, not of the verb: delete and mark-read
 * cover whatever was ticked, and this is where that becomes one call per
 * account.
 *
 * Targets with no account form a group of their own, which keeps the id in the
 * run rather than dropping a message the user asked to be acted on. A surface
 * that carries no account is single-account by construction; one that carries
 * it for some rows and not others sends the unattributed ones together, and if
 * the server refuses that batch the run reports it like any other failure.
 *
 * Accounts and ids keep the order they were selected in.
 */
export const chunkTargets = (
	targets: readonly BulkActionTarget[],
	size = BULK_ACTION_CHUNK_SIZE,
): string[][] => {
	const byAccount = new Map<string | undefined, string[]>();
	for (const target of targets) {
		const held = byAccount.get(target.accountId);
		if (held) {
			held.push(target.id);
			continue;
		}
		byAccount.set(target.accountId, [target.id]);
	}
	return [...byAccount.values()].flatMap((ids) => chunkIds(ids, size));
};

export interface BatchResult {
	successCount: number;
	failureCount: number;
}

/** Applies the action to one batch of ids (≤100) with a single bulk call. */
export type ApplyBatch = (ids: string[]) => Promise<BatchResult>;

export interface BulkActionProgress {
	/** Ids the action has been applied to so far. */
	done: number;
	/** The total the run was started against (may be an estimate for the
	 *  predicate case — see `runPredicateAction`). */
	total: number;
}

export interface BulkActionOutcome {
	/** Ids the action was applied to (server-accepted, not merely "sent"). */
	done: number;
	/**
	 * Ids the run did not reach, so the action was never applied to them: on
	 * cancellation or a thrown error, the chunks the bounded run never attempted
	 * (see `runChunkedAction`). Empty in the predicate case, which re-resolves on
	 * every run rather than handing back a remainder (see `runPredicateAction`).
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
 * caller always gets back exactly the ids the action never reached, ready to
 * retry as-is: every action here is idempotent (re-trashing, re-moving or
 * re-marking a message it already applied to is a no-op).
 *
 * Chunks never mix accounts (see `chunkTargets`), and the run walks them as one
 * sequence: cancellation lands at whichever boundary comes next, whether or not
 * that is an account boundary, and progress counts toward the whole selection
 * rather than restarting per account.
 */
export const runChunkedAction = async (
	targets: readonly BulkActionTarget[],
	applyBatch: ApplyBatch,
	onProgress: (progress: BulkActionProgress) => void,
	isCancelled: () => boolean,
): Promise<BulkActionOutcome> => {
	const chunks = chunkTargets(targets);
	const total = targets.length;
	let done = 0;
	const failedIds: string[] = [];

	for (let i = 0; i < chunks.length; i++) {
		if (isCancelled()) {
			failedIds.push(...chunks.slice(i).flat());
			return { done, failedIds, cancelled: true };
		}
		const chunk = chunks[i];
		const attempted = await attempt(applyBatch(chunk));
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

/**
 * The same bounded run, adapted to the optimistic mutation hooks (#453).
 *
 * A selection is not always assembled by a surface that owns a progress bar —
 * the daily brief's toolbar and sheet hand a raw id list to `useDeleteMessages`,
 * `useMoveMessages`, `useToggleReadFor` and `useApplyLabel`, and select-all over
 * a 200-row search would send all 200 in one call, which the endpoint rejects
 * outright. Splitting the send inside those hooks puts the cap where the call is
 * made, so every caller is covered by construction rather than by remembering.
 *
 * Each chunk is a full mutation of its own, so it keeps that hook's optimistic
 * patch, rollback and error banner. The run stops at the first rejected chunk
 * and reports nothing itself: the hook that owns the call has already raised it.
 *
 * Every call site on this path hands over ids from a single account — a
 * focused row, or a selection the surface already scoped — so nothing here
 * carries an account to split by. A caller with a cross-account selection
 * belongs on `runChunkedAction`, whose targets name one (#872).
 */
export const runChunkedMutation = async (
	ids: readonly string[],
	send: (chunk: string[]) => Promise<unknown>,
): Promise<void> => {
	await runChunkedAction(
		ids.map((id) => ({ id, accountId: undefined })),
		async (chunk) => {
			await send(chunk);
			return { successCount: chunk.length, failureCount: 0 };
		},
		() => {},
		() => false,
	);
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
 * Each page is fetched immediately before the chunk it feeds is acted on — a
 * page IS a chunk, sized to the same 100-id cap the write side enforces — so
 * ids are never held in memory beyond the batch in flight.
 *
 * Cancelling or a thrown error simply stops paging: nothing is added to
 * `failedIds` for the unreached remainder, because those ids were never
 * fetched — there is nothing to hand back. A predicate resolves fresh on
 * every run (D2), so resuming is re-invoking this same function with the same
 * predicate.
 */
export const runPredicateAction = async (
	fetchIdsPage: FetchIdsPage,
	total: number,
	applyBatch: ApplyBatch,
	onProgress: (progress: BulkActionProgress) => void,
	isCancelled: () => boolean,
): Promise<BulkActionOutcome> => {
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
			const attempted = await attempt(applyBatch(page.ids));
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

/**
 * Corrects a progress reading so its `total` can never read as less than
 * `done` (#109). `runPredicateAction`'s `total` is the count the server gave
 * before the run resolved the same predicate a second, independent time; if
 * more matches arrived in between, `done` can overtake it mid-run and a raw
 * "Deleting 1,340 of 1,284" would follow. Widening the denominator to match
 * keeps the bar's ratio sane (never past 100%) without claiming the original
 * count was exact — the honest fix is admitting the reading grew, not taking a
 * second count to reconcile it (the result set is live; a count taken any
 * later is no less stale than the first).
 */
export const honestProgress = (
	progress: BulkActionProgress,
): BulkActionProgress => ({
	done: progress.done,
	total: Math.max(progress.total, progress.done),
});

export interface BulkRunOutcome {
	done: number;
	failedIds: string[];
	cancelled: boolean;
	error?: unknown;
}
