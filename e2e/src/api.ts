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
	hasStars?: boolean;
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

export interface Address {
	addressId: string;
	normalizedEmail: string;
	displayName?: string;
}

export interface Filter {
	filterId: string;
	name: string;
	scope: "Standing" | "Temporary";
	state: "Active" | "Expired";
	expiresAt?: string;
	actionMailboxId: string;
}

export interface CreateFilterInput {
	name: string;
	scope: "Standing" | "Temporary";
	expiresAt?: string;
	matchOperator?: "And" | "Or";
	literalClauses?: { field: "From" | "Subject" | "HasWords"; value: string }[];
	actionLabelId?: string;
	actionMailboxId?: string;
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

	/**
	 * The same bulk move the reading pane's move picker issues. Specs use it to
	 * put a message back where they found it: the suite runs serially over one
	 * shared mailbox, and several specs assert the inbox holds exactly the
	 * seeded set.
	 */
	moveMessages(
		messageIds: string[],
		destinationMailboxId: string,
	): Promise<{ successCount: number; failureCount: number }> {
		return this.json("POST", "/messages/move", {
			messageIds,
			destinationMailboxId,
		});
	}

	/**
	 * Delete messages the same way the bulk-delete toolbar does. Specs use it to
	 * clean up scratch fixtures a UI-driven delete didn't reach.
	 */
	deleteMessages(messageIds: string[]): Promise<{
		successCount: number;
		failureCount: number;
	}> {
		return this.json("POST", "/messages/delete", { messageIds });
	}

	/**
	 * Every message id currently matching a free-text query in one mailbox,
	 * paged to exhaustion at the write side's own 100-id cap — the same page
	 * size `useEscalatedActions` uses, so a spec can compute "how many actually
	 * match right now" independently of whatever the UI claims.
	 */
	async searchMatchingMessageIds(
		mailboxId: string,
		query: string,
	): Promise<string[]> {
		const ids: string[] = [];
		let continuationToken: string | undefined;
		do {
			const params = new URLSearchParams({
				order: "desc",
				query,
				limit: "100",
			});
			if (continuationToken) params.set("continuationToken", continuationToken);
			const result = await this.json<ResultList<{ messageId: string }>>(
				"GET",
				`/mailboxes/${mailboxId}/threads/search?${params.toString()}`,
			);
			ids.push(...(result.items ?? []).map((item) => item.messageId));
			continuationToken = result.continuationToken;
		} while (continuationToken);
		return ids;
	}

	async listMailboxes(accountId: string): Promise<Mailbox[]> {
		const result = await this.json<ResultList<Mailbox>>(
			"GET",
			`/accounts/${accountId}/mailboxes`,
		);
		return result.items ?? [];
	}

	/**
	 * The lookup every per-sender action depends on: given a sender's address,
	 * find that sender's address record. Quick actions PATCH the row this
	 * returns, so a miss here disables them (issue #51).
	 */
	async searchAddresses(query: string): Promise<Address[]> {
		const result = await this.json<ResultList<Address>>(
			"GET",
			`/addresses/search?q=${encodeURIComponent(query)}&limit=10`,
		);
		return result.items ?? [];
	}

	/**
	 * Seed a standing or temporary filter directly against the filter endpoint.
	 * The organize sheet that creates one in the app widens the selection with a
	 * semantic preview first; that vector index is deliberately not built on the
	 * e2e lane, so the filter surface is exercised by seeding the same
	 * `POST /accounts/{id}/filters` the sheet ultimately calls and driving the
	 * Settings › Filters UI over the result. A purely-literal filter needs no
	 * anchor, so no vectors.
	 */
	createFilter(accountId: string, input: CreateFilterInput): Promise<Filter> {
		return this.json("POST", `/accounts/${accountId}/filters`, {
			matchOperator: "And",
			literalClauses: [],
			actionLabelId: "None",
			actionMailboxId: "None",
			...input,
		});
	}

	async listFilters(accountId: string): Promise<Filter[]> {
		const result = await this.json<ResultList<Filter>>(
			"GET",
			`/accounts/${accountId}/filters`,
		);
		return result.items ?? [];
	}

	deleteFilter(accountId: string, filterId: string): Promise<Response> {
		return this.request("DELETE", `/accounts/${accountId}/filters/${filterId}`);
	}

	async listThreads(mailboxId: string): Promise<Thread[]> {
		const result = await this.json<ResultList<Thread>>(
			"GET",
			`/mailboxes/${mailboxId}/threads`,
		);
		return result.items ?? [];
	}

	/**
	 * A whole conversation. The endpoint is deliberately not given a mailbox: a
	 * thread spans every folder the account holds a message in. No `order` is
	 * sent either — oldest first is what the endpoint promises (#81), and the
	 * suite asserts the promise rather than a parameter it passed itself.
	 */
	async listThreadMessages(threadId: string): Promise<ThreadMessage[]> {
		const result = await this.json<ResultList<ThreadMessage>>(
			"GET",
			`/threads/${threadId}/messages`,
		);
		return result.items ?? [];
	}

	/**
	 * The cross-account unified listing. `starred: true` switches it to the
	 * starred scope, which spans every non-muted mailbox rather than the INBOX
	 * narrowing the default listing applies.
	 *
	 * Pages are followed to exhaustion: a page may come back short while still
	 * carrying a continuation token, so "not on the first page" is not an answer
	 * to whether a thread is listed.
	 */
	async listAllThreads(
		query: { starred?: boolean; limit?: number } = {},
	): Promise<Thread[]> {
		const items: Thread[] = [];
		let continuationToken: string | undefined;
		do {
			const params = new URLSearchParams();
			if (query.starred !== undefined)
				params.set("starred", String(query.starred));
			if (query.limit !== undefined) params.set("limit", String(query.limit));
			if (continuationToken) params.set("continuationToken", continuationToken);
			const result = await this.json<ResultList<Thread>>(
				"GET",
				`/threads?${params.toString()}`,
			);
			items.push(...(result.items ?? []));
			continuationToken = result.continuationToken;
		} while (continuationToken);
		return items;
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
