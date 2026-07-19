import type {
	AccountItem,
	IAccountSettingRepository,
	MailboxItem,
} from "@remit/data-ports";
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
 * Build the read scope for the unified listing: a mailboxId→accountId map over
 * every non-muted mailbox of every non-muted account in a given
 * accountConfigId, plus two id sets — `inboxMailboxIds` (top-level INBOX only,
 * the unified inbox scope) and `activeMailboxIds` (all of them, the starred
 * scope). The map covers all mailboxes so a starred row from any folder still
 * resolves its accountId.
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
	activeMailboxIds: Set<string>;
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
	const activeMailboxIds = new Set<string>();

	const activeMailboxes = mailboxLists
		.flat()
		.filter((mailbox) => !isMailboxMuted(mailbox.mailboxId));

	for (const mailbox of activeMailboxes) {
		mailboxIdToAccountId.set(mailbox.mailboxId, mailbox.accountId);
		activeMailboxIds.add(mailbox.mailboxId);
		if (mailbox.fullPath.toUpperCase() === "INBOX") {
			inboxMailboxIds.add(mailbox.mailboxId);
		}
	}

	return { mailboxIdToAccountId, inboxMailboxIds, activeMailboxIds };
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
 * apply: the scope is every non-muted mailbox in the config. Same defaults as
 * the unified listing otherwise.
 */
export const buildListStarredThreadsOptions = (
	query: {
		continuationToken?: string;
		order?: "asc" | "desc";
		limit?: number;
	},
	activeMailboxIds: Set<string>,
) => ({
	order: query.order ?? ("desc" as const),
	continuationToken: query.continuationToken,
	limit: query.limit ?? DEFAULT_UNIFIED_THREADS_PAGE_SIZE,
	mailboxIds: activeMailboxIds,
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
		const { continuationToken, order, limit, starred } = context.request
			.query as {
			continuationToken?: string;
			order?: "asc" | "desc";
			limit?: number;
			starred?: boolean | string;
		};
		const starredOnly = starred === true || starred === "true";

		const client = await getClient();

		const { mailboxIdToAccountId, inboxMailboxIds, activeMailboxIds } =
			await buildInboxMailboxMap(accountConfigId, client);

		const scope = starredOnly ? activeMailboxIds : inboxMailboxIds;
		if (scope.size === 0) {
			return { items: [], continuationToken: undefined };
		}

		const result = starredOnly
			? await client.threadMessage.listByStarred(
					accountConfigId,
					buildListStarredThreadsOptions(
						{ continuationToken, order, limit },
						activeMailboxIds,
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
