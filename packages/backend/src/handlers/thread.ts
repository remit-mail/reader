import type { ThreadMessageItem } from "@remit/remit-electrodb-service";
import type { ThreadMessageResponse } from "@remit/api-openapi-types";
import type { APIGatewayProxyEvent } from "aws-lambda";
import type { Context } from "openapi-backend";
import { getAccountConfigIdFromEvent } from "../auth.js";
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
// entities and pagination cursors from projected reads.
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
 * Build the `searchByMailbox` options for the thread search handler.
 * Same #212 default as `buildListThreadsOptions`.
 */
export const buildSearchThreadsOptions = (query: {
	continuationToken?: string;
	order?: "asc" | "desc";
}) => ({
	order: query.order ?? ("desc" as const),
	continuationToken: query.continuationToken,
	excludeDeleted: true,
});

/**
 * Build the `listByThread` options for the thread-messages handler. Same
 * #212 default as the listing handlers — a soft-deleted message inside a
 * conversation should not surface in the conversation pane either.
 */
export const buildListThreadMessagesOptions = (query: {
	order?: "asc" | "desc";
	mailboxId?: string;
}) => ({
	order: query.order ?? ("desc" as const),
	mailboxId: query.mailboxId,
	excludeDeleted: true,
});

const toThreadMessageResponse = (
	item: ThreadMessageItem,
): ThreadMessageResponse => ({
	threadMessageId: item.threadMessageId,
	threadId: item.threadId,
	messageId: item.messageId,
	accountConfigId: item.accountConfigId,
	mailboxId: item.mailboxId,
	fromEmail: item.fromEmail,
	fromName: item.fromName,
	subject: item.subject,
	sentDate: item.sentDate,
	isRead: item.isRead,
	hasAttachment: item.hasAttachment,
	star: item.star,
	hasStars: item.hasStars,
	isDeleted: item.isDeleted,
	snippet: item.snippet,
	createdAt: item.createdAt,
	updatedAt: item.updatedAt,
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

		const result = await getClient().threadMessage.listByMailbox(
			accountConfigId,
			mailboxId,
			buildListThreadsOptions({ continuationToken, order }),
		);

		return {
			items: result.items.map(toThreadMessageResponse).filter(Boolean),
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
		const {
			continuationToken,
			order,
			query,
			subject,
			from,
			unread,
			starred,
			attachments,
		} = context.request.query as {
			continuationToken?: string;
			order?: "asc" | "desc";
			query?: string;
			subject?: string;
			from?: string;
			unread?: boolean;
			starred?: boolean;
			attachments?: boolean;
		};

		const result = await getClient().threadMessage.searchByMailbox(
			accountConfigId,
			mailboxId,
			{
				query,
				subject,
				from,
				unread,
				starred,
				attachments,
			},
			buildSearchThreadsOptions({ continuationToken, order }),
		);

		return {
			items: result.items.map(toThreadMessageResponse).filter(Boolean),
			continuationToken: result.continuationToken,
		};
	},
};

export const ThreadDetailOperations: Record<
	ThreadDetailOperationIds,
	OperationHandler<ThreadDetailOperationIds>
> = {
	ThreadDetailOperations_listThreadMessages: async (context) => {
		const { threadId } = context.request.params as { threadId: string };
		const { order, mailboxId } = context.request.query as {
			order?: "asc" | "desc";
			mailboxId?: string;
		};

		const result = await getClient().threadMessage.listByThread(
			threadId,
			buildListThreadMessagesOptions({ order, mailboxId }),
		);

		return {
			items: result.items.map(toThreadMessageResponse).filter(Boolean),
			continuationToken: result.continuationToken,
		};
	},
};
