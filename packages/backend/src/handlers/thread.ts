import type { ThreadMessageItem } from "@remit/remit-electrodb-service";
import type { ThreadMessageResponse } from "@remit/api-openapi-types";
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
	ThreadOperations_listThreads: async (context) => {
		const { mailboxId } = context.request.params as { mailboxId: string };
		const { continuationToken, order } = context.request.query as {
			continuationToken?: string;
			order?: "asc" | "desc";
		};

		// We need to get the accountConfigId from the mailbox
		const mailbox = await getClient().mailbox.get(mailboxId);
		const account = await getClient().account.get(mailbox.accountId);

		const result = await getClient().threadMessage.listByMailbox(
			account.accountConfigId,
			mailboxId,
			{
				order: order ?? "desc",
				continuationToken,
				limit: DEFAULT_THREADS_PAGE_SIZE,
				attributes: [...THREAD_LIST_ATTRIBUTES],
			},
		);

		return {
			items: result.items.map(toThreadMessageResponse).filter(Boolean),
			continuationToken: result.continuationToken,
		};
	},

	ThreadOperations_searchThreads: async (context) => {
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

		// We need to get the accountConfigId from the mailbox
		const mailbox = await getClient().mailbox.get(mailboxId);
		const account = await getClient().account.get(mailbox.accountId);

		const result = await getClient().threadMessage.searchByMailbox(
			account.accountConfigId,
			mailboxId,
			{
				query,
				subject,
				from,
				unread,
				starred,
				attachments,
			},
			{
				order: order ?? "desc",
				continuationToken,
			},
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

		const result = await getClient().threadMessage.listByThread(threadId, {
			order: order ?? "desc",
			mailboxId,
		});

		return {
			items: result.items.map(toThreadMessageResponse).filter(Boolean),
			continuationToken: result.continuationToken,
		};
	},
};
