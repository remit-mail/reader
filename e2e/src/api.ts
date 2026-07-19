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
}

/**
 * Poll `read` until `accept` holds. Sync is asynchronous end to end — the API
 * accepts a trigger and workers do the work — so every assertion about synced
 * state is a poll, never a sleep.
 */
export const waitFor = async <T>(
	read: () => Promise<T>,
	accept: (value: T) => boolean,
	{ timeoutMs = 60_000, intervalMs = 1_000, what = "condition" } = {},
): Promise<T> => {
	const deadline = Date.now() + timeoutMs;
	let last: T | undefined;
	while (Date.now() < deadline) {
		last = await read();
		if (accept(last)) return last;
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
	}
	throw new Error(
		`timed out after ${timeoutMs}ms waiting for ${what}; last value: ${JSON.stringify(last)}`,
	);
};
