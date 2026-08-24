/**
 * The SMTP sink the deployment submits to, read back over Mailpit's HTTP API.
 *
 * This is the only place in the suite that sees what a recipient would get.
 * Everything else about a send — the outbox row, the Sent copy — is the
 * application's own account of what it did; the bytes here are the ones that
 * left it.
 */
import { expect } from "@playwright/test";
import { waitFor } from "./api.js";
import { smtpSinkApi } from "./env.js";

interface SinkListEntry {
	ID: string;
	Subject: string;
}

interface SinkListResponse {
	messages: SinkListEntry[];
}

export interface AcceptedMessage {
	id: string;
	subject: string;
	/** The bytes the sink accepted, headers included. */
	raw: string;
}

const sinkJson = async <T>(path: string): Promise<T> => {
	const response = await fetch(`${smtpSinkApi}${path}`);
	if (!response.ok) {
		throw new Error(
			`GET ${path} on the SMTP sink failed: ${response.status} ${await response.text()}`,
		);
	}
	return (await response.json()) as T;
};

const listAccepted = (): Promise<SinkListEntry[]> =>
	sinkJson<SinkListResponse>("/api/v1/messages?limit=200").then(
		(page) => page.messages,
	);

/**
 * Poll the sink until it has accepted a message with this subject, then return
 * its raw source.
 *
 * A send is asynchronous end to end — the API queues an outbox row, the worker
 * picks it up, the submission follows — so the arrival is always waited for.
 * Subjects are unique per spec, which is what makes matching on one safe: the
 * sink is shared by every spec in the run and is never emptied between them.
 */
export const waitForAcceptedMessage = async (
	subject: string,
	{ timeoutMs = 90_000 }: { timeoutMs?: number } = {},
): Promise<AcceptedMessage> => {
	const messages = await waitFor(
		listAccepted,
		(items) => items.some((item) => item.Subject === subject),
		{ timeoutMs, what: `"${subject}" to reach the SMTP sink` },
	);
	const match = messages.find((item) => item.Subject === subject);
	if (!match) {
		throw new Error("unreachable: the subject was matched but not found");
	}

	const response = await fetch(`${smtpSinkApi}/api/v1/message/${match.ID}/raw`);
	if (!response.ok) {
		throw new Error(
			`raw source for ${match.ID} failed: ${response.status} ${await response.text()}`,
		);
	}
	return { id: match.ID, subject: match.Subject, raw: await response.text() };
};

/**
 * How many messages the sink has accepted under this subject.
 *
 * The sink is shared by the whole run and is never emptied, so its own totals
 * belong to every spec at once and mean nothing to any of them. A subject
 * stamped with the moment the spec started is the only thing a count can be
 * taken over — which is what makes "exactly once" a claim about this send and
 * not about the sink.
 */
export const countAcceptedMessages = async (
	subject: string,
): Promise<number> => {
	const messages = await listAccepted();
	return messages.filter((item) => item.Subject === subject).length;
};

/**
 * Assert the sink accepted nothing under this subject, having given it a
 * window to.
 *
 * A send is asynchronous end to end, so an absence read the instant an action
 * is refused is an absence that had no chance to be anything else. The sink
 * only ever grows, so one count at the end of the window covers all of it.
 */
export const expectNothingAccepted = async (
	subject: string,
	quietWindowMs: number,
): Promise<void> => {
	await new Promise((resolve) => setTimeout(resolve, quietWindowMs));
	expect(await countAcceptedMessages(subject)).toBe(0);
};
