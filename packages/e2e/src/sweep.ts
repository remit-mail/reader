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
 * block on the move settling, then delete against the confirmed row. A row that
 * never settles times the wait out and says so, rather than reaching the write
 * side and coming back as a refusal the spec cannot read.
 */
import { type ApiClient, waitFor } from "./api.js";

/** The write side's own cap on one delete request's id list. */
const DELETE_PAGE_SIZE = 100;

export interface SweepOptions {
	timeoutMs?: number;
}

/**
 * Every message id matching `query` in one mailbox, once no match is under a
 * move the mail server has not confirmed.
 */
export const settledMatchingMessageIds = async (
	api: ApiClient,
	mailboxId: string,
	query: string,
	{ timeoutMs = 60_000 }: SweepOptions = {},
): Promise<string[]> => {
	const matches = await waitFor(
		() => api.searchMatchingMessages(mailboxId, query),
		(messages) => messages.every((message) => message.status !== "moving"),
		{
			timeoutMs,
			what: `every "${query}" match in ${mailboxId} to settle its placement`,
		},
	);
	return matches.map((message) => message.messageId);
};

/**
 * Delete every settled match in one mailbox, paged at the write side's cap.
 * Answers with the ids it removed.
 */
export const deleteSettledMatches = async (
	api: ApiClient,
	mailboxId: string,
	query: string,
	options: SweepOptions = {},
): Promise<string[]> => {
	const ids = await settledMatchingMessageIds(api, mailboxId, query, options);
	for (let i = 0; i < ids.length; i += DELETE_PAGE_SIZE) {
		await api.deleteMessages(ids.slice(i, i + DELETE_PAGE_SIZE));
	}
	return ids;
};

/**
 * The same sweep over every mailbox of one account — what a spec whose move
 * relocated its own fixtures needs, since it no longer knows which folder holds
 * them.
 */
export const deleteSettledMatchesEverywhere = async (
	api: ApiClient,
	accountId: string,
	query: string,
	options: SweepOptions = {},
): Promise<string[]> => {
	const removed: string[] = [];
	for (const mailbox of await api.listMailboxes(accountId)) {
		removed.push(
			...(await deleteSettledMatches(api, mailbox.mailboxId, query, options)),
		);
	}
	return removed;
};
