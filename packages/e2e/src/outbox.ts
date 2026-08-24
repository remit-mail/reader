/**
 * The outbox row a send is carried by, read as the client's watch reads it.
 */
import { type ApiClient, waitFor } from "./api.js";

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
