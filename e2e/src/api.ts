/**
 * A client for the deployment's public HTTP surface, written against the
 * documented contract rather than the repo's generated client — the suite has
 * to fail when the contract changes, which a shared client would hide.
 */
import { baseUrl } from "./env.js";

export interface Credentials {
	email: string;
	password: string;
	name: string;
}

export interface Mailbox {
	mailboxId: string;
	fullPath: string;
	specialUse?: string;
	messageCount?: number;
}

export interface Thread {
	threadId: string;
	messageId: string;
	mailboxId: string;
	subject?: string;
	fromEmail?: string;
	isRead?: boolean;
	/**
	 * Header-derived category. Carries `uncategorized` until the message is
	 * body-classified; omitted only when the underlying message row cannot be
	 * resolved, which is why it stays optional here.
	 */
	category?: string;
}

export interface ThreadMessage {
	threadMessageId: string;
	messageId: string;
	mailboxId: string;
	subject?: string;
	fromEmail?: string;
	fromName?: string;
	sentDate?: number;
}

interface ResultList<T> {
	items: T[];
	continuationToken?: string;
}

const cookieHeader = (response: Response): string =>
	response.headers
		.getSetCookie()
		.map((cookie) => cookie.split(";")[0])
		.join("; ");

/**
 * Sign up a brand-new user. Every run gets its own, so a run never inherits
 * another run's accounts, mail, or read state.
 */
export const signUp = async (credentials: Credentials): Promise<string> => {
	const response = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
		method: "POST",
		headers: { "content-type": "application/json", origin: baseUrl },
		body: JSON.stringify(credentials),
	});
	if (!response.ok) {
		throw new Error(
			`sign-up failed: ${response.status} ${await response.text()}`,
		);
	}
	return cookieHeader(response);
};

export const signIn = async (
	credentials: Pick<Credentials, "email" | "password">,
): Promise<string> => {
	const response = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
		method: "POST",
		headers: { "content-type": "application/json", origin: baseUrl },
		body: JSON.stringify(credentials),
	});
	if (!response.ok) {
		throw new Error(
			`sign-in failed: ${response.status} ${await response.text()}`,
		);
	}
	return cookieHeader(response);
};

/**
 * Exchange the session cookie for the RS256 bearer token the gateway verifies.
 * This is the same two-step the browser client performs.
 */
export const fetchBearerToken = async (cookie: string): Promise<string> => {
	const response = await fetch(`${baseUrl}/api/auth/token`, {
		headers: { cookie },
	});
	if (!response.ok) {
		throw new Error(
			`token exchange failed: ${response.status} ${await response.text()}`,
		);
	}
	const body = (await response.json()) as { token?: string };
	if (!body.token) throw new Error("token exchange returned no token");
	return body.token;
};

export class ApiClient {
	constructor(private readonly token: string) {}

	async request(
		method: string,
		path: string,
		body?: unknown,
	): Promise<Response> {
		return fetch(`${baseUrl}/api${path}`, {
			method,
			headers: {
				authorization: `Bearer ${this.token}`,
				origin: baseUrl,
				...(body === undefined ? {} : { "content-type": "application/json" }),
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
	}

	private async json<T>(
		method: string,
		path: string,
		body?: unknown,
	): Promise<T> {
		const response = await this.request(method, path, body);
		if (!response.ok) {
			throw new Error(
				`${method} ${path} failed: ${response.status} ${await response.text()}`,
			);
		}
		return (await response.json()) as T;
	}

	createAccount(
		input: Record<string, unknown>,
	): Promise<{ accountId: string }> {
		return this.json("POST", "/accounts", input);
	}

	testConnection(
		input: Record<string, unknown>,
	): Promise<{ imapSuccess: boolean; imapError?: string }> {
		return this.json("POST", "/accounts/test-connection", input);
	}

	triggerSync(accountId: string): Promise<unknown> {
		return this.json("POST", `/accounts/${accountId}/sync`);
	}

	async listMailboxes(accountId: string): Promise<Mailbox[]> {
		const result = await this.json<ResultList<Mailbox>>(
			"GET",
			`/accounts/${accountId}/mailboxes`,
		);
		return result.items ?? [];
	}

	async listThreads(mailboxId: string): Promise<Thread[]> {
		const result = await this.json<ResultList<Thread>>(
			"GET",
			`/mailboxes/${mailboxId}/threads`,
		);
		return result.items ?? [];
	}

	/**
	 * A whole conversation, oldest first. The endpoint is deliberately not given
	 * a mailbox: a thread spans every folder the account holds a message in.
	 */
	async listThreadMessages(threadId: string): Promise<ThreadMessage[]> {
		const result = await this.json<ResultList<ThreadMessage>>(
			"GET",
			`/threads/${threadId}/messages?order=asc`,
		);
		return result.items ?? [];
	}
}

/**
 * Poll `read` until `accept` holds. Sync is asynchronous end to end — the API
 * accepts a trigger and workers do the work — so every assertion about synced
 * state is a poll, never a sleep.
 *
 * A failing read is a poll that did not succeed yet, not a verdict: a worker
 * restarting mid-run makes the gateway answer 502 for a moment, and giving up on
 * the first one would report that as the feature being broken. The last failure
 * is kept and reported if the deadline passes.
 *
 * The default deadline stays under Playwright's per-test timeout so the message
 * below — which names what was being waited for and what was last seen — is what
 * a reader gets, instead of a bare "test timeout exceeded".
 */
export const waitFor = async <T>(
	read: () => Promise<T>,
	accept: (value: T) => boolean,
	{ timeoutMs = 30_000, intervalMs = 1_000, what = "condition" } = {},
): Promise<T> => {
	const deadline = Date.now() + timeoutMs;
	let last: T | undefined;
	let lastError: unknown;
	while (Date.now() < deadline) {
		const attempt = await read().then(
			(value) => ({ ok: true as const, value }),
			(error: unknown) => ({ ok: false as const, error }),
		);
		if (attempt.ok) {
			last = attempt.value;
			lastError = undefined;
			if (accept(last)) return last;
		} else {
			lastError = attempt.error;
		}
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
	}
	const seen = lastError
		? `last read failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`
		: `last value: ${JSON.stringify(last)}`;
	throw new Error(
		`timed out after ${timeoutMs}ms waiting for ${what}; ${seen}`,
	);
};
