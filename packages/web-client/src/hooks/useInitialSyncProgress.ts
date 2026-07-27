import { syncOperationsGetSyncStatusOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapSyncPhase } from "@remit/api-http-client/types.gen.ts";
import { useQueries } from "@tanstack/react-query";
import { useEffect, useState } from "react";

/**
 * The phases the server writes while a sync round is actually running.
 *
 * A set of the in-progress values rather than "not complete": an account row
 * written before the phase existed reads back `undefined`, and `idle` means no
 * sync is running. Both would otherwise pin a list to "still syncing" forever,
 * which is the same dishonesty as the bug in the other direction.
 */
const IN_PROGRESS: ReadonlySet<RemitImapSyncPhase> = new Set([
	"discovering_mailboxes",
	"syncing_inbox",
	"syncing_others",
]);

/** Whether a phase reading means the server is mid-sync right now. */
export function isSyncingPhase(phase: RemitImapSyncPhase | undefined): boolean {
	return !!phase && IN_PROGRESS.has(phase);
}

export const POLL_MS = 3000;

/**
 * How long an account may stay silent before the answer is given without it.
 *
 * An account that errors counts as answered; one that never responds does not,
 * and without a bound a single hung account holds the brief on its skeleton for
 * as long as the tab is open — it would never say "You're caught up". Two poll
 * rounds is long enough that a slow-but-alive account still gets to speak.
 */
export const ANSWER_DEADLINE_MS = POLL_MS * 2;

export interface InitialSyncProgress {
	/** At least one account reports an in-progress sync phase. */
	syncing: boolean;
	/** Every enabled sync-status query has answered; until then nothing is known. */
	resolved: boolean;
	/** Messages downloaded so far, summed over the accounts still syncing. */
	synced: number;
	/** What those accounts hold in total; 0 while the server has not counted. */
	total: number;
}

const UNKNOWN: InitialSyncProgress = {
	syncing: false,
	resolved: false,
	synced: 0,
	total: 0,
};

/**
 * Whether any of these accounts is mid-sync, read from the account sync-status
 * endpoint (`syncPhase`) — a real server-side state the IMAP worker writes, not
 * a guess from message counts. The per-mailbox message numbers alongside it are
 * approximate by the API's own definition (a UID-range estimate), so they are
 * only ever shown as progress, never as a total the UI reasons about.
 *
 * `enabled` exists because the answer only matters when something is about to
 * be claimed about an empty result; polling every account continuously to
 * answer a question nobody asked is not worth the requests.
 *
 * The poll is a question with a last answer. Once every account has spoken and
 * none is mid-sync, nothing further can change the reading, so the polling
 * stops there rather than re-asking every three seconds for the rest of the
 * session — the caught-up user was paying about 1,200 requests an hour per
 * account for an answer that was already final. A new account set asks again.
 */
export function useInitialSyncProgress(
	accountIds: string[],
	enabled: boolean,
): InitialSyncProgress {
	const accountKey = accountIds.join(",");
	const [settled, setSettled] = useState(false);
	const [deadlinePassed, setDeadlinePassed] = useState(false);

	// A different account set is a different question: it gets its own answer,
	// its own deadline, and a poll that runs again until it has one.
	// biome-ignore lint/correctness/useExhaustiveDependencies: accountKey/enabled are trigger-only — the reset is unconditional, not a value read from either.
	useEffect(() => {
		setSettled(false);
		setDeadlinePassed(false);
	}, [accountKey, enabled]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: accountKey restarts the deadline for a new question rather than being read inside it.
	useEffect(() => {
		if (!enabled) return;
		const timer = setTimeout(() => setDeadlinePassed(true), ANSWER_DEADLINE_MS);
		return () => clearTimeout(timer);
	}, [accountKey, enabled]);

	const queries = useQueries({
		queries: accountIds.map((accountId) => ({
			...syncOperationsGetSyncStatusOptions({ path: { accountId } }),
			// Disabling keeps the cached answer and its success/error status; it
			// only stops the interval.
			enabled: enabled && !settled,
			refetchInterval: POLL_MS,
			// A failed sync-status read is not the account failing — it must not
			// raise the global fatal overlay over a question about an empty list.
			meta: { softError: true },
		})),
	});

	// A query that errored still counts as answered: the caller's fallback is the
	// same either way, and one unreachable account must not hold the whole list
	// in limbo. One that never answers at all is covered by the deadline instead.
	const answered = queries.every((q) => q.isSuccess || q.isError);
	const resolved = queries.length === 0 || answered || deadlinePassed;

	let syncing = false;
	let synced = 0;
	let total = 0;
	for (const query of queries) {
		if (!isSyncingPhase(query.data?.syncPhase)) continue;
		syncing = true;
		for (const mailbox of query.data?.mailboxes ?? []) {
			synced += mailbox.messagesSynced;
			total += mailbox.messagesTotal;
		}
	}

	const final = enabled && resolved && !syncing;
	useEffect(() => {
		if (final) setSettled(true);
	}, [final]);

	if (!enabled) return UNKNOWN;
	if (!resolved) return UNKNOWN;
	return { syncing, resolved: true, synced, total };
}
