/**
 * Removing a run's scratch mail once the mutations the run made have settled.
 *
 * A spec that moved its fixtures cannot delete them the moment they show up in
 * the destination. `updateForMove` points the row at the destination and leaves
 * `status: moving` until the IMAP copy confirms and `updateUid` writes the
 * destination's COPYUID, and the search answers off that row — so the matches
 * are readable in the destination while the pair is still the source folder's
 * uid under the destination's mailbox. The write side refuses a delete against
 * such a row with a 409 `message_placement_unsettled` (#1155).
 *
 * These sweeps take the wait half of docs/architecture/imap-mutations.md R2:
 * block on the move settling, then delete against the confirmed row. Only a
 * move is waited for. `deleting` is the other unsettled status and is never
 * waited on — it is what this sweep's own deletes leave behind, and the write
 * side does not refuse over it.
 */
import { type ApiClient, type MatchingMessage, waitFor } from "./api.js";

/** The write side's own cap on one delete request's id list. */
const DELETE_PAGE_SIZE = 100;

/**
 * How long a whole sweep may spend waiting. The hook it runs in gets 60s
 * (`playwright.config.ts`) and usually spends most of that on the IMAP wait
 * after it, so this is a slice of that budget rather than another full one: a
 * move that has not settled in this long is the stranded row of #1005, not a
 * slow one, and saying so beats holding the hook until Playwright kills it.
 */
const DEFAULT_SWEEP_TIMEOUT_MS = 20_000;

/** `waitFor`'s own polling interval — the smallest budget that still buys a
 *  read rather than an immediate timeout. */
const POLL_MS = 1_000;

export interface SweepOptions {
	timeoutMs?: number;
}

/**
 * What is still under a move, counted by its `status`/`syncStatus` pair, so a
 * wait that runs out names the state it ran out on.
 *
 * `moving`/`failed` is deliberately waited on rather than given up as lost: a
 * mover writes `failed` on an ordinary dropped connection before a redelivery
 * that usually succeeds, and nothing persisted tells that apart from a mover
 * that gave up for good. The pair in the timeout message is what separates the
 * two for a reader.
 */
const unsettledPairs = (
	messages: MatchingMessage[],
): Record<string, number> => {
	const counts: Record<string, number> = {};
	for (const message of messages) {
		if (!message.status || !message.syncStatus) {
			throw new Error(
				`the search answered for ${message.messageId} with no status/syncStatus pair — the read model has stopped carrying the one signal a sweep can settle on`,
			);
		}
		if (message.status !== "moving") continue;
		const pair = `${message.status}/${message.syncStatus}`;
		counts[pair] = (counts[pair] ?? 0) + 1;
	}
	return counts;
};

const settledMatchIds = async (
	api: ApiClient,
	mailboxId: string,
	query: string,
	timeoutMs: number,
): Promise<string[]> => {
	const settled = await waitFor(
		async () => {
			const matches = await api.searchMatchingMessages(mailboxId, query);
			return {
				ids: matches.map((match) => match.messageId),
				unsettled: unsettledPairs(matches),
			};
		},
		({ unsettled }) => Object.keys(unsettled).length === 0,
		{
			timeoutMs,
			what: `every "${query}" match in ${mailboxId} to settle its placement`,
		},
	);
	return settled.ids;
};

/**
 * Delete every match of `query` in one mailbox once no match is under a move
 * the mail server has not confirmed, paged at the write side's cap. Answers
 * with the ids it removed.
 */
export const deleteSettledMatches = async (
	api: ApiClient,
	mailboxId: string,
	query: string,
	{ timeoutMs = DEFAULT_SWEEP_TIMEOUT_MS }: SweepOptions = {},
): Promise<string[]> => {
	const ids = await settledMatchIds(api, mailboxId, query, timeoutMs);
	for (let i = 0; i < ids.length; i += DELETE_PAGE_SIZE) {
		await api.deleteMessages(ids.slice(i, i + DELETE_PAGE_SIZE));
	}
	return ids;
};

/**
 * The same sweep over every mailbox of one account — what a spec whose move
 * relocated its own fixtures needs, since it no longer knows which folder holds
 * them. The budget is the whole sweep's, not each mailbox's: the account has as
 * many folders as the fixture account happens to hold, and one wait per folder
 * would outlast the hook.
 */
export const deleteSettledMatchesEverywhere = async (
	api: ApiClient,
	accountId: string,
	query: string,
	{ timeoutMs = DEFAULT_SWEEP_TIMEOUT_MS }: SweepOptions = {},
): Promise<string[]> => {
	const deadline = Date.now() + timeoutMs;
	const removed: string[] = [];
	for (const mailbox of await api.listMailboxes(accountId)) {
		removed.push(
			...(await deleteSettledMatches(api, mailbox.mailboxId, query, {
				// Floored at one poll, so a folder reached after the budget is gone
				// is still read once: an empty one costs nothing and a busy one
				// fails naming itself rather than naming an expired budget.
				timeoutMs: Math.max(deadline - Date.now(), POLL_MS),
			})),
		);
	}
	return removed;
};
