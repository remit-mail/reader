import type {
	MessageCategory,
	ThreadSearchResponse,
} from "@remit/api-openapi-types";
import type {
	AccountItem,
	IAccountSettingRepository,
	MailboxItem,
	ResultList,
	SearchOptions,
	ThreadMessageItem,
} from "@remit/data-ports";
import { isVirtualCopyMailbox } from "@remit/data-ports/virtual-copy";
import { MailboxSpecialUse } from "@remit/domain-enums";
import type { APIGatewayProxyEvent } from "aws-lambda";
import type { Context } from "openapi-backend";
import pMap from "p-map";
import { getAccountConfigIdFromEvent } from "../auth.js";
import {
	type EnrichClient,
	enrichThreadRows,
} from "../derive/enrichThreadRows.js";
import { getClient } from "../service/data-client.js";
import type { OperationHandler, UnifiedThreadOperationIds } from "../types.js";
import {
	groupAccountOverrides,
	groupMailboxOverrides,
} from "./account-overrides.js";

const DEFAULT_UNIFIED_THREADS_PAGE_SIZE = 50;
const MAILBOX_LIST_CONCURRENCY = 5;

/**
 * Minimal client surface for inbox discovery. Structurally satisfied by
 * RemitClient; narrowed so unit tests can pass an in-memory fake without
 * standing up DynamoDB.
 */
export interface InboxMapClient {
	account: {
		listAllByAccountConfig(accountConfigId: string): Promise<AccountItem[]>;
	};
	mailbox: {
		listAllByAccount(accountId: string): Promise<MailboxItem[]>;
	};
	accountSetting: Pick<IAccountSettingRepository, "listByAccountConfig">;
}

/**
 * Special-use folders a star never surfaces from.
 *
 * `Junk` and `Trash` match what Gmail and Fastmail do — a star on mail the user
 * already threw away or that was classed as spam is not something the starred
 * view should resurface. `All` is Gmail's All Mail: a second copy of everything
 * already reachable through its own folder, and on a backend that keys a row by
 * its mailbox the copy is a distinct row carrying the same server-side
 * \Flagged, so including it would render every starred Gmail message twice.
 */
const STARRED_EXCLUDED_SPECIAL_USE: readonly string[] = [
	MailboxSpecialUse.All,
	MailboxSpecialUse.Junk,
	MailboxSpecialUse.Trash,
];

const isExcludedFromStarred = (mailbox: MailboxItem): boolean =>
	mailbox.specialUse?.some((use) =>
		STARRED_EXCLUDED_SPECIAL_USE.includes(use),
	) === true;

/**
 * The only folder the unscoped search never reaches: `Trash` holds mail the
 * user discarded, the same judgement `excludeDeleted` already applies to
 * soft-deleted rows.
 *
 * Everything else is in scope, and the rule is stated as a complement on
 * purpose — enumerating the folders a search DOES reach is what left Drafts out
 * of every description of it while it was in scope all along. `Junk` is in:
 * an unscoped search exists to reach the folders the user did not think to look
 * in, and misfiled mail in Spam is the case that matters most.
 *
 * Gmail's virtual folders (All Mail, Starred, Important) are in scope too, and
 * deliberately so. They hold a second copy of mail that also lives in a real
 * folder, which on a per-mailbox-row backend multiplies results — but a row
 * here is keyed by `(threadId, messageId)`, both mailbox-independent, so the
 * copies collapse into ONE row whose `mailboxId` is whichever mailbox synced it
 * first (message-sync calls this a "residual cross-mailbox collision"). Barring
 * those mailboxes therefore does not remove a duplicate, it removes the only
 * row a message has whenever a virtual folder won that race — mail that exists
 * and cannot be found. Duplicates are handled where they are safe to handle,
 * by `dedupeByMessageId` below.
 */
const SEARCH_EXCLUDED_SPECIAL_USE: readonly string[] = [
	MailboxSpecialUse.Trash,
];

const isExcludedFromSearch = (mailbox: MailboxItem): boolean =>
	mailbox.specialUse?.some((use) =>
		SEARCH_EXCLUDED_SPECIAL_USE.includes(use),
	) === true ||
	// `specialUse` is absent on servers that do not advertise it and on accounts
	// synced before it was recorded, so the well-known path is matched too.
	// Whole path, never a prefix — a user's own `Trash talk` folder is real mail.
	mailbox.fullPath.toLowerCase() === "[gmail]/trash";

/**
 * Build the read scope for the unified listing: a mailboxId→accountId map over
 * every non-muted mailbox of every non-muted account in a given
 * accountConfigId, plus three id sets — `inboxMailboxIds` (top-level INBOX
 * only, the unified inbox scope), `starredMailboxIds` (every folder a star may
 * surface from, see `STARRED_EXCLUDED_SPECIAL_USE`) and `searchMailboxIds`
 * (every folder the unscoped search reaches, see
 * `SEARCH_EXCLUDED_SPECIAL_USE`). The map covers all mailboxes, excluded ones
 * included, so any row still resolves its accountId.
 *
 * INBOX is identified by exact match `fullPath.toUpperCase() === "INBOX"` —
 * MailboxSpecialUse has no Inbox value per RFC 6154. This is the same rule
 * sync-mailboxes.ts uses for INBOX-first sync ordering. By design this matches
 * only the top-level INBOX per account: namespaced sub-paths (`INBOX/Receipts`)
 * and non-English server primaries are excluded from the unified view, so the
 * product contract is "unified inbox = each account's primary INBOX, not
 * sub-folders" — consistent with sync-mailboxes.
 *
 * Muted accounts and muted mailboxes are excluded so the unified thread
 * listing respects the mute flags from #437 (#433). The mute flags now live in
 * per-target AccountSetting rows (RFC 032), loaded once for the whole config and
 * keyed by accountId/mailboxId; a target counts as muted only when its MutedFlag
 * exists AND `value === true`.
 *
 * NOTE (read cost / mute drift): this fan-out (one listAllByAccountConfig + N
 * per-account mailbox listings) runs on *every* page request and is not cached
 * across a pagination session. Acceptable for v1 — mailbox lists are small —
 * but it means the inbox/mute filter set is rebuilt per page from live state,
 * so muting/unmuting a mailbox mid-pagination changes which rows match on
 * subsequent pages (the cursor is an opaque byDate position; mute changes take
 * effect on the next page, never retroactively). Memoizing the map within a
 * session (or threading it through the continuationToken) is a natural
 * follow-up — tracked alongside the stored-isInbox index work in issue #443.
 */
export const buildInboxMailboxMap = async (
	accountConfigId: string,
	client: InboxMapClient,
): Promise<{
	mailboxIdToAccountId: Map<string, string>;
	inboxMailboxIds: Set<string>;
	starredMailboxIds: Set<string>;
	searchMailboxIds: Set<string>;
	virtualCopyMailboxIds: Set<string>;
}> => {
	const [accounts, settings] = await Promise.all([
		client.account.listAllByAccountConfig(accountConfigId),
		client.accountSetting.listByAccountConfig(accountConfigId),
	]);

	// Mute flags live in per-target AccountSetting rows (RFC 032). A target is
	// muted only when its MutedFlag exists and `value === true`.
	const accountOverrides = groupAccountOverrides(settings);
	const mailboxOverrides = groupMailboxOverrides(settings);
	const isAccountMuted = (accountId: string): boolean =>
		accountOverrides.get(accountId)?.muted?.value === true;
	const isMailboxMuted = (mailboxId: string): boolean =>
		mailboxOverrides.get(mailboxId)?.muted?.value === true;

	const activeAccounts = accounts.filter(
		(account) => !isAccountMuted(account.accountId),
	);

	const mailboxLists = await pMap(
		activeAccounts,
		(account) => client.mailbox.listAllByAccount(account.accountId),
		{ concurrency: MAILBOX_LIST_CONCURRENCY },
	);

	const mailboxIdToAccountId = new Map<string, string>();
	const inboxMailboxIds = new Set<string>();
	const starredMailboxIds = new Set<string>();
	const searchMailboxIds = new Set<string>();
	const virtualCopyMailboxIds = new Set<string>();

	const activeMailboxes = mailboxLists
		.flat()
		.filter((mailbox) => !isMailboxMuted(mailbox.mailboxId));

	for (const mailbox of activeMailboxes) {
		mailboxIdToAccountId.set(mailbox.mailboxId, mailbox.accountId);
		if (!isExcludedFromStarred(mailbox)) {
			starredMailboxIds.add(mailbox.mailboxId);
		}
		if (!isExcludedFromSearch(mailbox)) {
			searchMailboxIds.add(mailbox.mailboxId);
		}
		if (isVirtualCopyMailbox(mailbox)) {
			virtualCopyMailboxIds.add(mailbox.mailboxId);
		}
		if (mailbox.fullPath.toUpperCase() === "INBOX") {
			inboxMailboxIds.add(mailbox.mailboxId);
		}
	}

	return {
		mailboxIdToAccountId,
		inboxMailboxIds,
		starredMailboxIds,
		searchMailboxIds,
		virtualCopyMailboxIds,
	};
};

/**
 * Build listByDate options for the unified thread listing.
 *
 * Exposed as a pure helper (same pattern as `buildListThreadsOptions` in
 * thread.ts) so the defaults — `order: "desc"`, default page size, and the
 * non-negotiable `excludeDeleted: true` (#212) — are testable without
 * standing up DynamoDB.
 */
export const buildListAllThreadsOptions = (
	query: {
		continuationToken?: string;
		order?: "asc" | "desc";
		limit?: number;
	},
	inboxMailboxIds: Set<string>,
	search?: SearchOptions,
) => ({
	order: query.order ?? ("desc" as const),
	continuationToken: query.continuationToken,
	limit: query.limit ?? DEFAULT_UNIFIED_THREADS_PAGE_SIZE,
	inboxMailboxIds,
	excludeDeleted: true,
	search,
});

/**
 * Build listByStarred options for the starred (`starred=true`) listing.
 *
 * A star marks the mail, not its placement, so the INBOX narrowing does not
 * apply: the scope is every non-muted mailbox except the ones a star never
 * surfaces from. Same defaults as the unified listing otherwise.
 */
export const buildListStarredThreadsOptions = (
	query: {
		continuationToken?: string;
		order?: "asc" | "desc";
		limit?: number;
	},
	starredMailboxIds: Set<string>,
	search?: SearchOptions,
) => ({
	order: query.order ?? ("desc" as const),
	continuationToken: query.continuationToken,
	limit: query.limit ?? DEFAULT_UNIFIED_THREADS_PAGE_SIZE,
	mailboxIds: starredMailboxIds,
	excludeDeleted: true,
	search,
});

/**
 * Build searchByDate options for the search mode (`query=<text>`).
 *
 * The scope is the caller-built set: every non-muted mailbox minus the folders
 * a search never reaches, or the starred scope when `starred=true` narrows it
 * further. Same defaults as the unified listing; `limit` is a page size over
 * matches and is clamped by the repository.
 */
export const buildSearchAllThreadsOptions = (
	query: {
		continuationToken?: string;
		order?: "asc" | "desc";
		limit?: number;
	},
	mailboxIds: Set<string>,
) => ({
	order: query.order ?? ("desc" as const),
	continuationToken: query.continuationToken,
	limit: query.limit ?? DEFAULT_UNIFIED_THREADS_PAGE_SIZE,
	mailboxIds,
	excludeDeleted: true,
});

/**
 * Collapse rows that are the same piece of mail seen through more than one
 * folder, keeping the copy in a real folder over the one in a virtual folder.
 *
 * A backend that keys a row by its mailbox returns one row per copy, so a
 * starred, Important Gmail inbox message arrives four times and crowds genuine
 * matches off the page. Dropping the extras here rather than barring the
 * virtual folders from the scope is what keeps the message reachable when the
 * ONLY row it has sits in one of them.
 *
 * Preference matters: a real folder is where the user filed the mail, so its
 * row is the one whose `mailboxId` should open. Ties keep the first row seen,
 * which is the newest given the caller's ordering.
 *
 * Scope: within a page. A duplicate split across a page boundary survives, the
 * same caveat the endpoint already documents for collapsing by `threadId`.
 */
export const dedupeByMessageId = <T extends { messageId: string }>(
	rows: readonly T[],
	isVirtualCopy: (row: T) => boolean,
): T[] => {
	const chosen = new Map<string, T>();
	for (const row of rows) {
		const existing = chosen.get(row.messageId);
		if (!existing) {
			chosen.set(row.messageId, row);
			continue;
		}
		if (isVirtualCopy(existing) && !isVirtualCopy(row)) {
			chosen.set(row.messageId, row);
		}
	}
	return [...chosen.values()];
};

/**
 * Attach accountId to each enriched ThreadMessageResponse row using the
 * mailboxId→accountId map built from inbox discovery. Same read-time-attach
 * pattern as senderTrust in enrichThreadRows.
 */
export const attachAccountIds = (
	rows: Awaited<ReturnType<typeof enrichThreadRows>>,
	mailboxIdToAccountId: Map<string, string>,
): typeof rows =>
	rows.map((row) => ({
		...row,
		accountId: mailboxIdToAccountId.get(row.mailboxId),
	}));

/**
 * The row criteria the listing carries, whichever mode answers it.
 *
 * `category`, `unread` and `attachments` are columns on the ThreadMessage row,
 * so each is a predicate inside the query. Filtering the rows a page returned
 * instead is the defect this replaces: a category whose mail sits below the
 * newest page rendered an empty list however much of it the collection held
 * (#308). `starred` and `query` are in here too so one `SearchOptions` says
 * what the whole request narrows by, which is what lets the count run the same
 * predicate as the listing.
 */
export const buildUnifiedThreadSearch = (params: {
	starredOnly: boolean;
	searchText?: string;
	category?: MessageCategory[];
	unread?: boolean;
	attachments?: boolean;
}): SearchOptions => ({
	...(params.searchText ? { query: params.searchText } : {}),
	...(params.starredOnly ? { starred: true } : {}),
	...(params.category?.length ? { category: params.category } : {}),
	...(params.unread !== undefined ? { unread: params.unread } : {}),
	...(params.attachments !== undefined
		? { attachments: params.attachments }
		: {}),
});

/**
 * Minimal client surface `executeUnifiedThreadListing` needs, declared
 * structurally (like `ThreadSearchClient`) so the mode selection, the row
 * filters and the count are testable with an in-memory fake.
 */
export interface UnifiedThreadClient extends EnrichClient, InboxMapClient {
	threadMessage: {
		listByDate(
			accountConfigId: string,
			options?: ReturnType<typeof buildListAllThreadsOptions>,
		): Promise<ResultList<ThreadMessageItem>>;
		listByStarred(
			accountConfigId: string,
			options?: ReturnType<typeof buildListStarredThreadsOptions>,
		): Promise<ResultList<ThreadMessageItem>>;
		searchByDate(
			accountConfigId: string,
			search: SearchOptions,
			options?: ReturnType<typeof buildSearchAllThreadsOptions>,
		): Promise<ResultList<ThreadMessageItem>>;
		countThreadsInScope(
			accountConfigId: string,
			search: SearchOptions,
			options?: { mailboxIds?: Set<string>; excludeDeleted?: boolean },
		): Promise<number>;
	};
}

export type UnifiedThreadParams = {
	continuationToken?: string;
	order?: "asc" | "desc";
	limit?: number;
	starredOnly: boolean;
	searchText?: string;
	category?: MessageCategory[];
	unread?: boolean;
	attachments?: boolean;
	count: boolean;
	results: boolean;
};

/**
 * Run the cross-account listing: pick the mode, apply the row criteria inside
 * the query, and optionally count the matches.
 *
 * `count` names the whole match, never the page: a page size bounds the rows a
 * response carries and has no bearing on how much matches, so pressing "load
 * more" cannot move it. It counts conversations, the unit the listing renders
 * once its per-mailbox rows are collapsed by `threadId`. `results: false` reads
 * the count alone, which is how a header total is fetched without also paying
 * for a page of mail.
 */
export const executeUnifiedThreadListing = async (
	client: UnifiedThreadClient,
	accountConfigId: string,
	params: UnifiedThreadParams,
): Promise<ThreadSearchResponse> => {
	const searching =
		params.searchText !== undefined && params.searchText.length > 0;
	const {
		mailboxIdToAccountId,
		inboxMailboxIds,
		starredMailboxIds,
		searchMailboxIds,
		virtualCopyMailboxIds,
	} = await buildInboxMailboxMap(accountConfigId, client);

	// Search widens past INBOX to every folder it may reach; `starred=true`
	// still narrows it to the starred scope, so the two compose.
	const searchScope = params.starredOnly ? starredMailboxIds : searchMailboxIds;
	const scope = searching
		? searchScope
		: params.starredOnly
			? starredMailboxIds
			: inboxMailboxIds;

	const search = buildUnifiedThreadSearch(params);
	const page = {
		continuationToken: params.continuationToken,
		order: params.order,
		limit: params.limit,
	};

	if (scope.size === 0) {
		return {
			...(params.results ? { items: [] } : {}),
			...(params.count ? { count: 0 } : {}),
		};
	}

	const response: ThreadSearchResponse = {};

	if (params.results) {
		const result = searching
			? await client.threadMessage.searchByDate(
					accountConfigId,
					search,
					buildSearchAllThreadsOptions(page, searchScope),
				)
			: params.starredOnly
				? await client.threadMessage.listByStarred(
						accountConfigId,
						buildListStarredThreadsOptions(page, starredMailboxIds, search),
					)
				: await client.threadMessage.listByDate(
						accountConfigId,
						buildListAllThreadsOptions(page, inboxMailboxIds, search),
					);

		// Search spans folders, so it is the one mode that can see the same mail
		// twice — through its real folder and through a virtual copy of it. The
		// INBOX and starred listings each read a scope that already holds one row
		// per message, so they are left exactly as they were.
		const rows = searching
			? dedupeByMessageId(result.items, (row) =>
					virtualCopyMailboxIds.has(row.mailboxId),
				)
			: result.items;

		const enriched = await enrichThreadRows(rows, client, accountConfigId);
		response.items = attachAccountIds(enriched, mailboxIdToAccountId);
		response.continuationToken = result.continuationToken;
	}

	if (params.count) {
		response.count = await client.threadMessage.countThreadsInScope(
			accountConfigId,
			search,
			{ mailboxIds: scope, excludeDeleted: true },
		);
	}

	return response;
};

const toArray = <T>(value: T | T[] | undefined): T[] | undefined => {
	if (value === undefined) return undefined;
	return Array.isArray(value) ? value : [value];
};

/**
 * A query-string boolean, as three states.
 *
 * Query strings carry text; openapi-backend coerces where the schema says
 * boolean and leaves the raw string where it cannot, so both forms are read.
 * Anything else — absent, or a value that is neither — is `undefined`, and
 * every caller below decides what that means for its own parameter. Folding
 * "not stated" into `false` would turn an absent `unread` into "only read
 * mail": a filter nobody asked for, and the opposite of the one they might
 * have meant.
 */
const toBoolean = (
	value: boolean | string | undefined,
): boolean | undefined => {
	if (value === true || value === "true") return true;
	if (value === false || value === "false") return false;
	return undefined;
};

export const UnifiedThreadOperations: Record<
	UnifiedThreadOperationIds,
	OperationHandler<UnifiedThreadOperationIds>
> = {
	UnifiedThreadOperations_listAllThreads: async (
		context: Context,
		...args: unknown[]
	) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const {
			continuationToken,
			order,
			limit,
			starred,
			query,
			category,
			unread,
			attachments,
			count,
			results,
		} = context.request.query as {
			continuationToken?: string;
			order?: "asc" | "desc";
			limit?: number;
			starred?: boolean | string;
			query?: string;
			category?: MessageCategory | MessageCategory[];
			unread?: boolean | string;
			attachments?: boolean | string;
			count?: boolean | string;
			results?: boolean | string;
		};

		// Whitespace-only text is not a search: it would widen the scope to every
		// folder while matching nothing in particular.
		const searchText = query?.trim();

		return executeUnifiedThreadListing(await getClient(), accountConfigId, {
			continuationToken,
			order,
			limit,
			// Absent means unstated for all five, and each says what it does with
			// that: the three filters drop out of the predicate, `count` is off
			// unless it is asked for, and `results` is on unless it is refused.
			starredOnly: toBoolean(starred) === true,
			searchText: searchText || undefined,
			category: toArray(category),
			unread: toBoolean(unread),
			attachments: toBoolean(attachments),
			count: toBoolean(count) === true,
			results: toBoolean(results) !== false,
		});
	},
};
