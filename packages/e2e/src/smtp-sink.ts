/**
 * The SMTP sink the deployment submits to, read back over Mailpit's HTTP API.
 *
 * This is the only place in the suite that sees what a recipient would get.
 * Everything else about a send — the outbox row, the Sent copy — is the
 * application's own account of what it did; the bytes here are the ones that
 * left it.
 */
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

/** The subjects the sink currently holds, newest first. */
export const acceptedSubjects = (): Promise<string[]> =>
	listAccepted().then((messages) => messages.map((message) => message.Subject));

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
