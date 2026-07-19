import type {
	MessageCategory,
	SenderTrust,
	ThreadSearchResponse,
} from "@remit/api-openapi-types";
import type { ResultList, ThreadMessageItem } from "@remit/data-ports";
import { NotFoundError } from "@remit/data-ports/errors";
import type { APIGatewayProxyEvent } from "aws-lambda";
import type { Context } from "openapi-backend";
import { getAccountConfigIdFromEvent } from "../auth.js";
import {
	type EnrichClient,
	enrichThreadRows,
} from "../derive/enrichThreadRows.js";
import {
	filterByOffRowCriteria,
	hasOffRowCriteria,
} from "../derive/filterThreadCriteria.js";
import { getClient } from "../service/dynamodb.js";
import type {
	OperationHandler,
	ThreadDetailOperationIds,
	ThreadOperationIds,
} from "../types.js";

const DEFAULT_THREADS_PAGE_SIZE = 50;

// Project to fields used by ListThreadsResponse — keep in sync with handler mapping.
// Includes ThreadMessage table key fields (accountConfigId, threadMessageId) and
// the lsi2 index components (mailboxId, sentDate) so ElectroDB can materialize
// entities and pagination cursors from projected reads. accountConfigId +
// fromEmail are required at read time to derive the From Address row for
// senderTrust enrichment (see enrichThreadRows).
const THREAD_LIST_ATTRIBUTES: ReadonlyArray<keyof ThreadMessageItem> = [
	"threadMessageId",
	"threadId",
	"messageId",
	"accountConfigId",
	"mailboxId",
	"fromEmail",
	"fromName",
	"subject",
	"sentDate",
	"isRead",
	"hasAttachment",
	"star",
	"hasStars",
	"isDeleted",
	"snippet",
	"createdAt",
	"updatedAt",
];

/**
 * Build the `listByMailbox` options for the thread list handler.
 *
 * Exposed as a pure helper so the `excludeDeleted: true` default — which is
 * the entire point of the #212 fix on the handler side — is testable without
 * standing up DynamoDB. The defaults must stay opt-out from the user (a
 * future Trash / All-Mail view can flip the flag) and opt-in at the
 * service layer.
 */
export const buildListThreadsOptions = (query: {
	continuationToken?: string;
	order?: "asc" | "desc";
}) => ({
	order: query.order ?? ("desc" as const),
	continuationToken: query.continuationToken,
	limit: DEFAULT_THREADS_PAGE_SIZE,
	attributes: [...THREAD_LIST_ATTRIBUTES],
	excludeDeleted: true,
});

/**
 * Build the `searchByMailboxWindow` options for the thread search handler.
 * Same #212 `excludeDeleted` default as `buildListThreadsOptions`. The caller's
 * `limit` is forwarded raw and clamped server-side (THREAD_SEARCH_MAX_LIMIT).
 */
export const buildSearchThreadsOptions = (query: {
	continuationToken?: string;
	order?: "asc" | "desc";
	limit?: number;
}) => ({
	order: query.order ?? ("desc" as const),
	continuationToken: query.continuationToken,
	limit: query.limit,
	attributes: [...THREAD_LIST_ATTRIBUTES],
	excludeDeleted: true,
});

const toArray = <T>(value: T | T[] | undefined): T[] | undefined => {
	if (value === undefined) return undefined;
	return Array.isArray(value) ? value : [value];
};

type WindowOptions = {
	order?: "asc" | "desc";
	limit?: number;
	continuationToken?: string;
	attributes?: Array<keyof ThreadMessageItem>;
	excludeDeleted?: boolean;
};

type ThreadSearch = {
	query?: string;
	subject?: string;
	from?: string;
	unread?: boolean;
	starred?: boolean;
	attachments?: boolean;
};

/**
 * Minimal client surface `executeThreadSearch` needs. Declared structurally
 * (like `EnrichClient`) so the orchestration — index/window read, count, and
 * the off-row enrich/filter — is testable with an in-memory fake.
 */
export interface ThreadSearchClient extends EnrichClient {
	threadMessage: {
		searchByMailboxWindow(
			accountConfigId: string,
			mailboxId: string,
			search: ThreadSearch,
			options?: WindowOptions,
		): Promise<ResultList<ThreadMessageItem>>;
		countByMailbox(
			accountConfigId: string,
			mailboxId: string,
			search: ThreadSearch,
			options?: {
				limit?: number;
				excludeDeleted?: boolean;
				order?: "asc" | "desc";
			},
		): Promise<number>;
	};
}

export type ThreadSearchParams = {
	continuationToken?: string;
	order?: "asc" | "desc";
	query?: string;
	subject?: string;
	from?: string;
	unread?: boolean;
	starred?: boolean;
	attachments?: boolean;
	senderTrust?: SenderTrust[];
	category?: MessageCategory[];
	dkimMismatch?: boolean;
	count?: boolean;
	results?: boolean;
	limit?: number;
};

/**
 * Run a per-mailbox thread search: select the index/window read, optionally
 * count, and resolve off-row criteria by enriching+filtering the window. The
 * `results` toggle omits `items` (count-only) and `count` adds the match count.
 * Off-row criteria force a window read+enrich even in count-only mode, since no
 * Select:COUNT can see fields that aren't on the row.
 */
export const executeThreadSearch = async (
	client: ThreadSearchClient,
	accountConfigId: string,
	mailboxId: string,
	params: ThreadSearchParams,
): Promise<ThreadSearchResponse> => {
	const search = {
		query: params.query,
		subject: params.subject,
		from: params.from,
		unread: params.unread,
		starred: params.starred,
		attachments: params.attachments,
	};
	const offRow = {
		senderTrust: params.senderTrust,
		category: params.category,
		dkimMismatch: params.dkimMismatch,
	};
	const wantCount = params.count === true;
	const wantResults = params.results !== false;
	const options = buildSearchThreadsOptions({
		continuationToken: params.continuationToken,
		order: params.order,
		limit: params.limit,
	});

	if (hasOffRowCriteria(offRow)) {
		const window = await client.threadMessage.searchByMailboxWindow(
			accountConfigId,
			mailboxId,
			search,
			options,
		);
		const enriched = await enrichThreadRows(
			window.items,
			client,
			accountConfigId,
		);
		const filtered = filterByOffRowCriteria(enriched, offRow);
		return {
			...(wantResults
				? { items: filtered, continuationToken: window.continuationToken }
				: {}),
			...(wantCount ? { count: filtered.length } : {}),
		};
	}

	const response: ThreadSearchResponse = {};

	if (wantResults) {
		const window = await client.threadMessage.searchByMailboxWindow(
			accountConfigId,
			mailboxId,
			search,
			options,
		);
		response.items = await enrichThreadRows(
			window.items,
			client,
			accountConfigId,
		);
		response.continuationToken = window.continuationToken;
		// The window read already yielded the exact match set, so the count is
		// its length — no separate Select:COUNT, and count == items.length by
		// construction.
		if (wantCount) response.count = response.items.length;
		return response;
	}

	if (wantCount) {
		response.count = await client.threadMessage.countByMailbox(
			accountConfigId,
			mailboxId,
			search,
			{ limit: params.limit, excludeDeleted: true, order: params.order },
		);
	}

	return response;
};

/**
 * Build the `listByThread` options for the thread-messages handler. Same
 * #212 default as the listing handlers — a soft-deleted message inside a
 * conversation should not surface in the conversation pane either.
 *
 * A conversation is never scoped to one mailbox: the user's own replies live
 * in Sent, filed messages live in their folder, and all of them belong to the
 * same thread (#46).
 */
export const buildListThreadMessagesOptions = (query: {
	order?: "asc" | "desc";
}) => ({
	order: query.order ?? ("desc" as const),
	excludeDeleted: true,
});

export const ThreadOperations: Record<
	ThreadOperationIds,
	OperationHandler<ThreadOperationIds>
> = {
	ThreadOperations_listThreads: async (
		context: Context,
		...args: unknown[]
	) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { mailboxId } = context.request.params as { mailboxId: string };
		const { continuationToken, order } = context.request.query as {
			continuationToken?: string;
			order?: "asc" | "desc";
		};

		const client = await getClient();
		const result = await client.threadMessage.listByMailbox(
			accountConfigId,
			mailboxId,
			buildListThreadsOptions({ continuationToken, order }),
		);

		const items = await enrichThreadRows(result.items, client, accountConfigId);

		return {
			items,
			continuationToken: result.continuationToken,
		};
	},

	ThreadOperations_searchThreads: async (
		context: Context,
		...args: unknown[]
	) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { mailboxId } = context.request.params as { mailboxId: string };
		const raw = context.request.query as {
			continuationToken?: string;
			order?: "asc" | "desc";
			query?: string;
			subject?: string;
			from?: string;
			unread?: boolean;
			starred?: boolean;
			attachments?: boolean;
			senderTrust?: SenderTrust | SenderTrust[];
			category?: MessageCategory | MessageCategory[];
			dkimMismatch?: boolean;
			count?: boolean;
			results?: boolean;
			limit?: number;
		};

		return executeThreadSearch(await getClient(), accountConfigId, mailboxId, {
			...raw,
			senderTrust: toArray(raw.senderTrust),
			category: toArray(raw.category),
		});
	},
};

export const ThreadDetailOperations: Record<
	ThreadDetailOperationIds,
	OperationHandler<ThreadDetailOperationIds>
> = {
	ThreadDetailOperations_listThreadMessages: async (
		context,
		...args: unknown[]
	) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { threadId } = context.request.params as { threadId: string };
		const { order } = context.request.query as {
			order?: "asc" | "desc";
		};

		const client = await getClient();
		const result = await client.threadMessage.listByThread(
			threadId,
			accountConfigId,
			buildListThreadMessagesOptions({ order }),
		);

		// Defense-in-depth: the query is already scoped to accountConfigId; assert
		// no foreign row slips into the response. `read`-class → 404, no existence
		// leak, consistent with the mailbox/message guards.
		for (const row of result.items) {
			if (row.accountConfigId !== accountConfigId) {
				throw new NotFoundError(`Thread not found: ${threadId}`);
			}
		}

		const items = await enrichThreadRows(result.items, client, accountConfigId);

		return {
			items,
			continuationToken: result.continuationToken,
		};
	},
};
