import type { AccountItem, MailboxItem } from "@remit/remit-electrodb-service";
import type { APIGatewayProxyEvent } from "aws-lambda";
import type { Context } from "openapi-backend";
import pMap from "p-map";
import { getAccountConfigIdFromEvent } from "../auth.js";
import { enrichThreadRows } from "../derive/enrichThreadRows.js";
import { getClient } from "../service/dynamodb.js";
import type { OperationHandler, UnifiedThreadOperationIds } from "../types.js";

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
}

/**
 * Build a mailboxId→accountId map for all non-muted INBOX mailboxes across
 * all non-muted accounts of a given accountConfigId.
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
 * listing respects the mute flags from #437 (#433).
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
}> => {
	const accounts = await client.account.listAllByAccountConfig(accountConfigId);
	const activeAccounts = accounts.filter((account) => !account.muted);

	const mailboxLists = await pMap(
		activeAccounts,
		(account) => client.mailbox.listAllByAccount(account.accountId),
		{ concurrency: MAILBOX_LIST_CONCURRENCY },
	);

	const mailboxIdToAccountId = new Map<string, string>();
	const inboxMailboxIds = new Set<string>();

	const inboxes = mailboxLists
		.flat()
		.filter(
			(mailbox) => !mailbox.muted && mailbox.fullPath.toUpperCase() === "INBOX",
		);

	for (const mailbox of inboxes) {
		mailboxIdToAccountId.set(mailbox.mailboxId, mailbox.accountId);
		inboxMailboxIds.add(mailbox.mailboxId);
	}

	return { mailboxIdToAccountId, inboxMailboxIds };
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
		const { continuationToken, order, limit } = context.request.query as {
			continuationToken?: string;
			order?: "asc" | "desc";
			limit?: number;
		};

		const client = getClient();

		const { mailboxIdToAccountId, inboxMailboxIds } =
			await buildInboxMailboxMap(accountConfigId, client);

		if (inboxMailboxIds.size === 0) {
			return { items: [], continuationToken: undefined };
		}

		const result = await client.threadMessage.listByDate(
			accountConfigId,
			buildListAllThreadsOptions(
				{ continuationToken, order, limit },
				inboxMailboxIds,
			),
		);

		const enriched = await enrichThreadRows(result.items, client);
		const items = attachAccountIds(enriched, mailboxIdToAccountId);

		return {
			items,
			continuationToken: result.continuationToken,
		};
	},
};
