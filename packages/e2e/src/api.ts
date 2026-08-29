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
	/** The RFC 6154 designations the server advertises, e.g. `["\\Sent"]`. */
	specialUse?: string[];
	messageCount?: number;
	/** `pending` until the imap-worker confirms the folder on the server, then `synced`. */
	syncStatus?: "synced" | "pending" | "failed" | "deleting";
}

/**
 * One mailbox's entry in the account's sync status. This is the deployment's
 * own account of a folder: how far its message sync got, and when it last ran.
 * `lastSyncedAt` is stamped on every message-sync round, empty round included,
 * so it is a cursor a spec can wait for an advance of rather than guessing how
 * long a round takes.
 */
export interface MailboxSyncProgress {
	mailboxId: string;
	fullPath: string;
	phase: string;
	messagesTotal: number;
	messagesSynced: number;
	lastSyncedAt?: number;
}

export interface AccountSyncStatus {
	accountId: string;
	syncPhase?: string;
	mailboxCountTotal?: number;
	mailboxCountSynced?: number;
	mailboxes: MailboxSyncProgress[];
}

/**
 * One canonical role and the folder the deployment resolves it to. `mailboxId`
 * is absent when the account holds no folder for the role at all.
 */
export interface FolderAppointment {
	role: string;
	mailboxId?: string;
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
	flags?: {
		blocked?: { value: boolean };
	};
}

/**
 * One outbox entry as the server holds it. This is the message that goes on the
 * wire — compose has already serialized its document into the two body fields —
 * so it is what a spec about the body asserts against, rather than anything the
 * editor says about itself.
 *
 * `lastError` is the sentence a send that ended badly left behind, and the only
 * account of it the user is given; a status that settled without one is a
 * failure the app never explained.
 */
export interface OutboxRow {
	outboxMessageId: string;
	subject?: string;
	status: string;
	lastError?: string;
	htmlBody?: string;
	textBody?: string;
}

export interface MessageSummary {
	messageId: string;
	mailboxId: string;
	spamReport?: { reportedAt: number };
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

export interface UpdateFilterInput {
	name?: string;
	scope?: "Standing" | "Temporary";
	expiresAt?: string;
	matchOperator?: "And" | "Or";
	literalClauses?: { field: "From" | "Subject" | "HasWords"; value: string }[];
	actionLabelId?: string;
	actionMailboxId?: string;
}

export interface Label {
	labelId: string;
	name: string;
	color: string;
}

export interface ConfigAccount {
	accountId: string;
	email: string;
	authType: string;
	isActive: boolean;
	connectionState: string;
	imapHost: string;
	imapPort: number;
}

export interface ConfigDescription {
	accounts: ConfigAccount[];
	pendingImport?: { importId: string; folderPaths: string[] };
}

export interface ConfigExport {
	schemaVersion: number;
	document: Record<string, unknown>;
}

export interface ConfigImportItem {
	section: string;
	key: string;
	verdict: string;
	reason?: string;
}

export interface ConfigImportReport {
	importId?: string;
	valid: boolean;
	schemaVersion: number;
	applied: boolean;
	items: ConfigImportItem[];
	errors: ApiErrorBody[];
	warnings: ApiErrorBody[];
	accountsNeedingCredentials: string[];
}

interface ResultList<T> {
	items: T[];
	continuationToken?: string;
}

/**
 * The flat error body the API emits: `message` for a human, and — only where
 * the endpoint promised one — a stable `code` a client branches on with
 * `details` it words its own copy from. A spec asserting a refusal reads the
 * code and the details, never the message.
 */
export interface ApiErrorBody {
	message?: string;
	code?: string;
	details?: Record<string, string>;
}

/**
 * The outbox statuses the API will delete — the same ones the queue accepts.
 * An account with no SMTP configured leaves its entries `blocked`, which is
 * exactly what a spec that opened compose against one produces.
 */
const REMOVABLE_OUTBOX_STATUSES = new Set([
	"draft",
	"failed",
	"blocked",
	"unfiled",
]);

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

/**
 * Mint a fresh bearer from stored credentials: sign in for a session cookie,
 * then exchange it for the token — the same two-step global setup ran once. The
 * client calls this to recover after its bearer expires mid-run.
 */
export const login = (
	credentials: Pick<Credentials, "email" | "password">,
): Promise<string> => signIn(credentials).then(fetchBearerToken);

/**
 * What the client needs to keep talking to the gateway for a whole run: the
 * bearer it starts with, and the credentials to mint a new one when that bearer
 * expires. Both the shared `RunState` and an isolated run satisfy this shape.
 */
export interface ApiSession {
	email: string;
	password: string;
	token: string;
}

export class ApiClient {
	private token: string;
	private reminting?: Promise<string>;

	constructor(private readonly session: ApiSession) {
		this.token = session.token;
	}

	/**
	 * The gateway-verified bearer lives 15 minutes; a saturated run outlasts it,
	 * after which every request comes back 401. Re-mint once and replay — only a
	 * 401 triggers this, so any other failure still surfaces on the first try.
	 */
	async request(
		method: string,
		path: string,
		body?: unknown,
	): Promise<Response> {
		const response = await this.send(method, path, body);
		if (response.status !== 401) return response;
		await this.reauthenticate();
		return this.send(method, path, body);
	}

	private send(
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

	/**
	 * Concurrent pollers all see the same expired bearer at once; the in-flight
	 * promise is a latch so they share one re-mint instead of stampeding the
	 * sign-in endpoint. The latch clears when the re-mint settles, so a later
	 * expiry mints again.
	 */
	private reauthenticate(): Promise<string> {
		if (!this.reminting) {
			this.reminting = login(this.session)
				.then((token) => {
					this.token = token;
					return token;
				})
				.finally(() => {
					this.reminting = undefined;
				});
		}
		return this.reminting;
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
	 * The same PATCH the settings panel makes. A spec that needs an account
	 * configured a particular way — writing languages, a signature — sets it
	 * here rather than clicking through settings on the way to its own subject.
	 */
	updateAccount(
		accountId: string,
		body: Record<string, unknown>,
	): Promise<{ accountId: string }> {
		return this.json("PATCH", `/accounts/${accountId}`, body);
	}

	/**
	 * What the deployment believes about its own sync. A spec waiting on synced
	 * state reads this rather than only the thing it wants to see appear: it
	 * carries whether the sync ran at all, so a wait that does not settle can say
	 * which of the two happened.
	 */
	getSyncStatus(accountId: string): Promise<AccountSyncStatus> {
		return this.json("GET", `/accounts/${accountId}/sync/status`);
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
	 * Block the sender and move to Junk in one call — the unified report-spam
	 * action (replacing the old separate Block + Mark spam).
	 */
	reportSpam(
		messageIds: string[],
	): Promise<{ successCount: number; failureCount: number }> {
		return this.json("POST", "/messages/report-spam", { messageIds });
	}

	/** Undo a report-spam: clear the sender block and restore the original mailbox. */
	notSpam(
		messageIds: string[],
	): Promise<{ successCount: number; failureCount: number }> {
		return this.json("POST", "/messages/not-spam", { messageIds });
	}

	async describeMessage(messageId: string): Promise<MessageSummary> {
		const result = await this.json<{ message: MessageSummary }>(
			"GET",
			`/messages/${messageId}`,
		);
		return result.message;
	}

	/** The same read/star PATCH the reading pane issues — proves outbound flag push works at all. */
	updateMessageFlags(
		messageId: string,
		input: { isRead?: boolean; isStarred?: boolean },
	): Promise<{ messageId: string; isRead: boolean; isStarred: boolean }> {
		return this.json("PATCH", `/messages/${messageId}/flags`, input);
	}

	/**
	 * The first account's outbox, paged to exhaustion the way
	 * `searchMatchingMessageIds` pages, narrowed to what a spec may take back:
	 * compose autosaves, so a spec that opens it leaves an entry behind and the
	 * shared account carries it into every later spec. A queued or sent message
	 * is not a spec's to remove, and the server refuses to delete one.
	 */
	async listRemovableOutboxMessages(): Promise<
		Array<{ outboxMessageId: string; subject: string }>
	> {
		const drafts: Array<{ outboxMessageId: string; subject: string }> = [];
		let continuationToken: string | undefined;
		do {
			const query = continuationToken
				? `?continuationToken=${encodeURIComponent(continuationToken)}`
				: "";
			const page = await this.json<{
				items: Array<{
					outboxMessageId: string;
					subject?: string;
					status: string;
				}>;
				continuationToken?: string;
			}>("GET", `/outbox${query}`);
			for (const item of page.items) {
				if (!REMOVABLE_OUTBOX_STATUSES.has(item.status)) continue;
				drafts.push({
					outboxMessageId: item.outboxMessageId,
					subject: item.subject ?? "",
				});
			}
			continuationToken = page.continuationToken;
		} while (continuationToken);
		return drafts;
	}

	getOutboxMessage(outboxMessageId: string): Promise<OutboxRow> {
		return this.json("GET", `/outbox/${outboxMessageId}`);
	}

	/**
	 * Queue a message for sending, the same call compose makes when the user
	 * hits Send. The response is the outbox row as the server accepted it; the
	 * submission happens behind it, on the SMTP queue.
	 */
	sendMessage(input: {
		accountId: string;
		toAddresses: string[];
		subject: string;
		textBody?: string;
		htmlBody?: string;
	}): Promise<{ outboxMessageId: string; status: string }> {
		return this.json("POST", "/outbox", { ...input, sendImmediately: true });
	}

	/**
	 * A draft already gone is the outcome this asks for, so a 404 is a pass: the
	 * app's own discard races this sweep and usually wins.
	 */
	async deleteOutboxMessage(outboxMessageId: string): Promise<void> {
		const response = await this.request("DELETE", `/outbox/${outboxMessageId}`);
		if (response.ok || response.status === 404) return;
		throw new Error(
			`DELETE /outbox/${outboxMessageId} failed: ${response.status} ${await response.text()}`,
		);
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
	 * The same call, answered rather than thrown. A delete may be refused with a
	 * coded 409 whose body is the contract under test, and `deleteMessages`
	 * flattens that into a message string a spec cannot branch on.
	 */
	attemptDeleteMessages(messageIds: string[]): Promise<Response> {
		return this.request("POST", "/messages/delete", { messageIds });
	}

	/**
	 * Permanently delete everything in the account's Trash — the call the Empty
	 * Trash strip makes. `deletedCount` is the service's own count, taken off the
	 * same read that marked the rows.
	 */
	emptyTrash(accountId: string): Promise<{ deletedCount: number }> {
		return this.json("POST", `/accounts/${accountId}/trash/empty`);
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

	/**
	 * The account's role-to-folder map as the deployment resolves it: the user's
	 * appointment, else the server's SPECIAL-USE flag, else a conventional name
	 * matched on the folder's own leaf segment. Read through GET /config, the
	 * one surface that serves the map without writing an appointment first.
	 */
	async listFolderAppointments(
		accountId: string,
	): Promise<FolderAppointment[]> {
		const config = await this.json<{
			accounts?: Array<{
				accountId: string;
				folderAppointments?: FolderAppointment[];
			}>;
		}>("GET", "/config");
		const account = (config.accounts ?? []).find(
			(entry) => entry.accountId === accountId,
		);
		if (!account) {
			throw new Error(`GET /config carried no account ${accountId}`);
		}
		// The map is total — one entry per canonical role — so an absent or empty
		// one is the deployment having stopped serving it, not an account with no
		// special folders.
		if (!account.folderAppointments?.length) {
			throw new Error(`GET /config carried no folder roles for ${accountId}`);
		}
		return account.folderAppointments;
	}

	async listMailboxes(accountId: string): Promise<Mailbox[]> {
		const result = await this.json<ResultList<Mailbox>>(
			"GET",
			`/accounts/${accountId}/mailboxes`,
		);
		return result.items ?? [];
	}

	/**
	 * Create a folder the same way the Settings form and the pickers do. Specs
	 * use it to stand up a move destination without driving the create UI a
	 * second time — the create surface itself is proven in the folder-lifecycle
	 * spec.
	 */
	createMailbox(accountId: string, fullPath: string): Promise<Mailbox> {
		return this.json("POST", `/accounts/${accountId}/mailboxes`, {
			fullPath,
			namespaceType: "personal",
		});
	}

	/**
	 * Create a folder and hold until the mail server confirms it, which is what
	 * the create surface itself does. A role cannot be appointed to a folder
	 * that is still `pending` (#887), so a spec that appoints one waits here.
	 */
	async createSettledMailbox(
		accountId: string,
		fullPath: string,
	): Promise<Mailbox> {
		const created = await this.createMailbox(accountId, fullPath);
		const mailboxes = await waitFor(
			() => this.listMailboxes(accountId),
			(list) =>
				list.some(
					(box) =>
						box.mailboxId === created.mailboxId && box.syncStatus === "synced",
				),
			{ timeoutMs: 60_000, what: `"${fullPath}" to settle on the mail server` },
		);
		const settled = mailboxes.find(
			(box) => box.mailboxId === created.mailboxId,
		);
		if (!settled) throw new Error("unreachable: matched but not found");
		return settled;
	}

	/**
	 * Appoint a canonical role to a folder — the endpoint Settings › Folder
	 * roles calls. Every special-folder lookup reads what this writes, so a spec
	 * uses it to say which folder an operation must land in rather than relying
	 * on the server flag or the folder name.
	 */
	appointFolderRole(
		accountId: string,
		role: string,
		mailboxId: string | null,
	): Promise<unknown> {
		return this.json("PUT", `/accounts/${accountId}/folder-roles/${role}`, {
			mailboxId,
		});
	}

	/** Delete a folder by id — the same endpoint the delete wizard calls. Specs use it to sweep scratch folders in cleanup. */
	deleteMailbox(accountId: string, mailboxId: string): Promise<Response> {
		return this.request(
			"DELETE",
			`/accounts/${accountId}/mailboxes/${mailboxId}`,
		);
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

	/**
	 * Patch a filter's mutable fields (reader #266: scope and expiresAt joined
	 * name/predicate/action as updatable; the anchor stayed out of the update
	 * surface entirely).
	 */
	updateFilter(
		accountId: string,
		filterId: string,
		input: UpdateFilterInput,
	): Promise<Filter> {
		return this.json(
			"PATCH",
			`/accounts/${accountId}/filters/${filterId}`,
			input,
		);
	}

	deleteFilter(accountId: string, filterId: string): Promise<Response> {
		return this.request("DELETE", `/accounts/${accountId}/filters/${filterId}`);
	}

	createLabel(accountId: string, name: string, color: string): Promise<Label> {
		return this.json("POST", `/accounts/${accountId}/labels`, { name, color });
	}

	async listLabels(accountId: string): Promise<Label[]> {
		const result = await this.json<ResultList<Label>>(
			"GET",
			`/accounts/${accountId}/labels`,
		);
		return result.items ?? [];
	}

	getConfig(): Promise<ConfigDescription> {
		return this.json("GET", "/config");
	}

	/**
	 * The whole configuration as one versioned document — what the Advanced
	 * settings card downloads and what `remit config save` writes.
	 */
	exportConfig(): Promise<ConfigExport> {
		return this.json("GET", "/config/export");
	}

	importConfig(input: {
		document: unknown;
		mode?: "validate" | "apply";
		onExisting?: "abort" | "merge";
	}): Promise<ConfigImportReport> {
		return this.json("POST", "/config/import", input);
	}

	/** The raw response, for a spec asserting the 409 a non-empty instance answers with. */
	attemptImportConfig(input: {
		document: unknown;
		mode?: "validate" | "apply";
		onExisting?: "abort" | "merge";
	}): Promise<Response> {
		return this.request("POST", "/config/import", input);
	}

	async listThreads(mailboxId: string): Promise<Thread[]> {
		const result = await this.json<ResultList<Thread>>(
			"GET",
			`/mailboxes/${mailboxId}/threads`,
		);
		return result.items ?? [];
	}

	/**
	 * The id of the message carrying one subject in a mailbox, once it has
	 * synced. Every spec that seeds mail on the server and then acts on it
	 * through the API starts here, because the sync that picks the append up is
	 * asynchronous: reading the listing once answers about a mailbox the
	 * deployment has not looked at yet.
	 */
	async messageIdForSubject(
		mailboxId: string,
		subject: string,
	): Promise<string> {
		const threads = await waitFor(
			() => this.listThreads(mailboxId),
			(items) => items.some((thread) => thread.subject === subject),
			{ timeoutMs: 90_000, what: `"${subject}" to sync into the read model` },
		);
		const match = threads.find((thread) => thread.subject === subject);
		if (!match) throw new Error("unreachable: matched but not found");
		return match.messageId;
	}

	/**
	 * The filtered per-mailbox listing the inbox chips issue, paged to
	 * exhaustion so a spec reads the whole match set rather than whatever fits
	 * in one page — which is the distinction the filter itself is about (#306).
	 */
	async searchThreads(
		mailboxId: string,
		query: { category?: string; limit?: number } = {},
	): Promise<Thread[]> {
		const items: Thread[] = [];
		let continuationToken: string | undefined;
		do {
			const params = new URLSearchParams({ order: "desc" });
			if (query.category) params.set("category", query.category);
			if (query.limit !== undefined) params.set("limit", String(query.limit));
			if (continuationToken) params.set("continuationToken", continuationToken);
			const result = await this.json<ResultList<Thread>>(
				"GET",
				`/mailboxes/${mailboxId}/threads/search?${params.toString()}`,
			);
			items.push(...(result.items ?? []));
			continuationToken = result.continuationToken;
		} while (continuationToken);
		return items;
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
