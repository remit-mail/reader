/**
 * The outbox row a send is carried by, read as the client's watch reads it.
 */
import { type ApiClient, type OutboxRow, waitFor } from "./api.js";

/**
 * Poll one outbox row until the API answers with this HTTP status.
 *
 * A send ends with the row deleted, so 404 is the settled state and the answer
 * the client's own watch has to survive; 200 is the row still in the process.
 * The status is what is waited on rather than the body, because the row a send
 * has finished with no longer has one.
 */
export const waitForOutboxStatus = async (
	api: ApiClient,
	outboxMessageId: string,
	status: number,
	{ timeoutMs = 120_000 }: { timeoutMs?: number } = {},
): Promise<void> => {
	const read = async (): Promise<number> => {
		const response = await api.request("GET", `/outbox/${outboxMessageId}`);
		await response.text();
		return response.status;
	};
	await waitFor(read, (seen) => seen === status, {
		timeoutMs,
		what: `the outbox row to answer ${status}`,
	});
};

/**
 * Poll one outbox row until it settles on this status, and answer with the row.
 *
 * The row's own status, not the HTTP one: a send that ends badly leaves the row
 * where it was, and what it settled on — with whatever reason it carries — is
 * the whole of what the user is left holding.
 *
 * Never waited on for `sent`. That one lives for well under a second before the
 * filing deletes the row, so a poll that catches it does so by luck and a poll
 * that misses it fails a spec about something else entirely.
 */
export const waitForSettledOutboxRow = (
	api: ApiClient,
	outboxMessageId: string,
	status: string,
	{ timeoutMs = 120_000 }: { timeoutMs?: number } = {},
): Promise<OutboxRow> =>
	waitFor(
		() => api.getOutboxMessage(outboxMessageId),
		(row) => row.status === status,
		{ timeoutMs, what: `the outbox row to settle ${status}` },
	);
