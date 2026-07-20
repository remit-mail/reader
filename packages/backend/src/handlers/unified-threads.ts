import type {
	AccountItem,
	IAccountSettingRepository,
	MailboxItem,
} from "@remit/data-ports";
import { MailboxSpecialUse } from "@remit/domain-enums";
import type { APIGatewayProxyEvent } from "aws-lambda";
import type { Context } from "openapi-backend";
import pMap from "p-map";
import { getAccountConfigIdFromEvent } from "../auth.js";
import { enrichThreadRows } from "../derive/enrichThreadRows.js";
import { getClient } from "../service/dynamodb.js";
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
 * already reachable through its own folder, and because a message's identity
 * includes its mailbox, the copy is a distinct row carrying the same
 * server-side \Flagged. Including it would render every starred Gmail message
 * twice.
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
 * Special-use folders the unscoped search never reaches.
 *
 * `Trash` holds mail the user discarded — the same judgement `excludeDeleted`
 * already applies to soft-deleted rows. `All` is Gmail's All Mail: a second
 * copy of everything already reachable through its own folder, so including it
 * would return every Gmail match twice.
 *
 * `Junk` is deliberately absent. An unscoped search exists to reach the folders
 * the user did not think to look in, and misfiled mail in Spam is the case that
 * matters most.
 */
const SEARCH_EXCLUDED_SPECIAL_USE: readonly string[] = [
	MailboxSpecialUse.All,
	MailboxSpecialUse.Trash,
];

const isExcludedFromSearch = (mailbox: MailboxItem): boolean =>
	mailbox.specialUse?.some((use) =>
		SEARCH_EXCLUDED_SPECIAL_USE.includes(use),
	) === true;

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
		if (mailbox.fullPath.toUpperCase() === "INBOX") {
			inboxMailboxIds.add(mailbox.mailboxId);
		}
	}

	return {
		mailboxIdToAccountId,
		inboxMailboxIds,
		starredMailboxIds,
		searchMailboxIds,
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
) => ({
	order: query.order ?? ("desc" as const),
	continuationToken: query.continuationToken,
	limit: query.limit ?? DEFAULT_UNIFIED_THREADS_PAGE_SIZE,
	inboxMailboxIds,
	excludeDeleted: true,
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
) => ({
	order: query.order ?? ("desc" as const),
	continuationToken: query.continuationToken,
	limit: query.limit ?? DEFAULT_UNIFIED_THREADS_PAGE_SIZE,
	mailboxIds: starredMailboxIds,
	excludeDeleted: true,
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
 * Attach accountId to each enriched ThreadMessageResponse row using the
 * mailboxId→accountId map built from inbox discovery. Same read-time-attach
 * pattern as senderTrust/category in enrichThreadRows.
 */
export const attachAccountIds = (
	rows: Awaited<ReturnType<typeof enrichThreadRows>>,
	mailboxIdToAccountId: Map<string, string>,
): typeof rows =>
	rows.map((row) => ({
		...row,
		accountId: mailboxIdToAccountId.get(row.mailboxId),
	}));

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
		const { continuationToken, order, limit, starred, query } = context.request
			.query as {
			continuationToken?: string;
			order?: "asc" | "desc";
			limit?: number;
			starred?: boolean | string;
			query?: string;
		};
		const starredOnly = starred === true || starred === "true";
		// Whitespace-only text is not a search: it would widen the scope to every
		// folder while matching nothing in particular.
		const searchText = query?.trim();
		const searching = searchText !== undefined && searchText.length > 0;

		const client = await getClient();

		const {
			mailboxIdToAccountId,
			inboxMailboxIds,
			starredMailboxIds,
			searchMailboxIds,
		} = await buildInboxMailboxMap(accountConfigId, client);

		// Search widens past INBOX to every folder it may reach; `starred=true`
		// still narrows it to the starred scope, so the two compose.
		const searchScope = starredOnly ? starredMailboxIds : searchMailboxIds;
		const scope = searching
			? searchScope
			: starredOnly
				? starredMailboxIds
				: inboxMailboxIds;
		if (scope.size === 0) {
			return { items: [], continuationToken: undefined };
		}

		const result = searching
			? await client.threadMessage.searchByDate(
					accountConfigId,
					{ query: searchText, starred: starredOnly ? true : undefined },
					buildSearchAllThreadsOptions(
						{ continuationToken, order, limit },
						searchScope,
					),
				)
			: starredOnly
				? await client.threadMessage.listByStarred(
						accountConfigId,
						buildListStarredThreadsOptions(
							{ continuationToken, order, limit },
							starredMailboxIds,
						),
					)
				: await client.threadMessage.listByDate(
						accountConfigId,
						buildListAllThreadsOptions(
							{ continuationToken, order, limit },
							inboxMailboxIds,
						),
					);

		const enriched = await enrichThreadRows(
			result.items,
			client,
			accountConfigId,
		);
		const items = attachAccountIds(enriched, mailboxIdToAccountId);

		return {
			items,
			continuationToken: result.continuationToken,
		};
	},
};
