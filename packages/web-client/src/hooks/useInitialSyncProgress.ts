import { syncOperationsGetSyncStatusOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapSyncPhase } from "@remit/api-http-client/types.gen.ts";
import { useQueries } from "@tanstack/react-query";

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

const POLL_MS = 3000;

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
 */
export function useInitialSyncProgress(
	accountIds: string[],
	enabled: boolean,
): InitialSyncProgress {
	const queries = useQueries({
		queries: accountIds.map((accountId) => ({
			...syncOperationsGetSyncStatusOptions({ path: { accountId } }),
			enabled,
			refetchInterval: POLL_MS,
			// A failed sync-status read is not the account failing — it must not
			// raise the global fatal overlay over a question about an empty list.
			meta: { softError: true },
		})),
	});

	if (!enabled) return UNKNOWN;
	if (queries.length === 0) {
		return { syncing: false, resolved: true, synced: 0, total: 0 };
	}
	// A query that errored still counts as answered: the caller's fallback is the
	// same either way, and one unreachable account must not hold the whole list
	// in limbo.
	if (!queries.every((q) => q.isSuccess || q.isError)) return UNKNOWN;

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
	return { syncing, resolved: true, synced, total };
}
